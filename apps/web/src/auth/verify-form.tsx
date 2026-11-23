'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from './auth-provider';
import { authRequest, AuthUser } from './api';

type Pending = {
  challengeId: string;
  phoneNumber: string;
  mobileNumber: string;
  flow: 'login' | 'register';
  purpose?: 'LOGIN' | 'RECOVERY';
  role?: 'PATIENT' | 'DOCTOR';
  requestedAt?: number;
  resendAfterSeconds?: number;
};

export function VerifyForm() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(45);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const raw = sessionStorage.getItem('hv-auth-pending');
    if (raw) {
      try {
        const saved = JSON.parse(raw) as Pending;
        setPending(saved);
        setSeconds(
          Math.max(
            0,
            (saved.resendAfterSeconds ?? 45) -
              Math.floor((Date.now() - (saved.requestedAt ?? Date.now())) / 1000),
          ),
        );
      } catch {
        sessionStorage.removeItem('hv-auth-pending');
      }
    }
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || !/^\d{6}$/.test(code)) {
      setError('Enter the six-digit verification code.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await authRequest<{ user: AuthUser }>('/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ challengeId: pending.challengeId, code, platform: 'WEB' }),
      });
      sessionStorage.removeItem('hv-auth-pending');
      setUser(result.user);
      router.replace(result.user.role === 'DOCTOR' ? '/doctor/dashboard' : '/dashboard');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to verify this code.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!pending || seconds > 0 || busy) return;
    setBusy(true);
    setError('');
    try {
      const result =
        pending.flow === 'register'
          ? await authRequest<{ challengeId: string; resendAfterSeconds?: number }>('/register', {
              method: 'POST',
              body: JSON.stringify({
                countryCode: '+91',
                mobileNumber: pending.mobileNumber,
                role: pending.role ?? 'PATIENT',
              }),
            })
          : await authRequest<{ challengeId: string; resendAfterSeconds?: number }>('/send-otp', {
              method: 'POST',
              body: JSON.stringify({
                countryCode: '+91',
                mobileNumber: pending.mobileNumber,
                purpose: pending.purpose ?? 'LOGIN',
              }),
            });
      const nextPending = {
        ...pending,
        challengeId: result.challengeId,
        requestedAt: Date.now(),
        resendAfterSeconds: result.resendAfterSeconds ?? 45,
      };
      setPending(nextPending);
      sessionStorage.setItem('hv-auth-pending', JSON.stringify(nextPending));
      setSeconds(nextPending.resendAfterSeconds);
      setCode('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send a new code.');
    } finally {
      setBusy(false);
    }
  }

  function changeNumber() {
    sessionStorage.removeItem('hv-auth-pending');
    router.replace(pending?.flow === 'register' ? '/register' : '/login');
  }

  return (
    <section className="w-full max-w-md rounded-3xl border border-sky-100 bg-white p-7 shadow-xl shadow-sky-900/5 sm:p-9">
      <Link href="/" className="text-sm font-semibold text-sky-700">
        ← HealthWallet
      </Link>
      <p className="mt-8 text-sm font-bold uppercase tracking-widest text-sky-700">
        Mobile verification
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Enter your code</h1>
      <p className="mt-3 leading-6 text-slate-600">
        We sent a six-digit code to{' '}
        <span className="font-semibold text-slate-800">
          {pending?.phoneNumber ?? 'your mobile number'}
        </span>
        .
      </p>
      <form className="mt-7 space-y-5" onSubmit={verify}>
        <div>
          <label htmlFor="otp-code" className="mb-2 block text-sm font-semibold text-slate-700">
            Verification code
          </label>
          <input
            id="otp-code"
            aria-label="Six-digit verification code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••••"
            className="w-full rounded-xl border border-slate-300 px-4 py-4 text-center text-2xl tracking-[0.5em] outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
            required
          />
        </div>
        {error && (
          <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !pending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-5 py-3.5 font-semibold text-white hover:bg-sky-800 disabled:cursor-wait disabled:opacity-60"
        >
          {busy && (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          )}
          {busy ? 'Verifying…' : 'Verify and continue'}
        </button>
      </form>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={changeNumber}
          className="font-semibold text-sky-700 hover:underline"
        >
          Change mobile number
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={!pending || seconds > 0 || busy}
          className="font-semibold text-slate-600 hover:text-sky-700 disabled:text-slate-400"
        >
          {seconds > 0 ? `Resend in ${seconds}s` : 'Resend code'}
        </button>
      </div>
    </section>
  );
}
