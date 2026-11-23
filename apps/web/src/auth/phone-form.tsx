'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authRequest, type AuthUser } from './api';
import { useAuth } from './auth-provider';

type Props = { mode: 'login' | 'register' };

export function PhoneForm({ mode }: Props) {
  const router = useRouter();
  const { setUser } = useAuth();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [purpose, setPurpose] = useState<'LOGIN' | 'RECOVERY'>('LOGIN');
  const [role, setRole] = useState<'PATIENT' | 'DOCTOR'>('PATIENT');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const devPasswordMode = process.env.NEXT_PUBLIC_DEV_PASSWORD_AUTH_ENABLED === 'true';

  if (devPasswordMode && mode === 'register') {
    return (
      <section className="w-full max-w-md rounded-3xl border border-sky-100 bg-white p-7 shadow-xl shadow-sky-900/5 sm:p-9">
        <Link href="/" className="text-sm font-semibold text-sky-700">
          ← HealthWallet
        </Link>
        <p className="mt-8 text-sm font-bold uppercase tracking-widest text-sky-700">
          Local testing
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">OTP is paused</h1>
        <p className="mt-3 leading-6 text-slate-600">
          Local password testing is available only for the configured synthetic patient account. Doctor sign-in and registration require mobile OTP delivery from a configured SMS provider.
        </p>
        <Link
          href="/login"
          className="mt-6 flex w-full justify-center rounded-xl bg-sky-700 px-5 py-3.5 font-semibold text-white hover:bg-sky-800"
        >
          Continue to password sign-in
        </Link>
      </section>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedInput = mobile.replace(/[\s()-]/g, '');
    if (!/^[6-9]\d{9}$/.test(normalizedInput)) {
      setError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (devPasswordMode) {
        const result = await authRequest<{ user: AuthUser }>('/dev-password-login', {
          method: 'POST',
          body: JSON.stringify({
            countryCode: '+91',
            mobileNumber: normalizedInput,
            password,
          }),
        });
        setUser(result.user);
        router.replace(result.user.role === 'DOCTOR' ? '/doctor/dashboard' : '/dashboard');
        return;
      }
      const result =
        mode === 'register'
          ? await authRequest<{ challengeId: string; resendAfterSeconds?: number }>('/register', {
              method: 'POST',
              body: JSON.stringify({ countryCode: '+91', mobileNumber: normalizedInput, role }),
            })
          : await authRequest<{ challengeId: string; resendAfterSeconds?: number }>('/send-otp', {
              method: 'POST',
              body: JSON.stringify({ countryCode: '+91', mobileNumber: normalizedInput, purpose }),
            });
      sessionStorage.setItem(
        'hv-auth-pending',
        JSON.stringify({
          challengeId: result.challengeId,
          phoneNumber: `+91${normalizedInput}`,
          mobileNumber: normalizedInput,
          flow: mode,
          purpose,
          role,
          requestedAt: Date.now(),
          resendAfterSeconds: result.resendAfterSeconds ?? 45,
        }),
      );
      router.push('/verify-otp');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send a verification code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="w-full max-w-md rounded-3xl border border-sky-100 bg-white p-7 shadow-xl shadow-sky-900/5 sm:p-9">
      <Link href="/" className="text-sm font-semibold text-sky-700">
        ← HealthWallet
      </Link>
      <p className="mt-8 text-sm font-bold uppercase tracking-widest text-sky-700">
        {devPasswordMode
          ? 'Local testing'
          : mode === 'register'
            ? 'Create your account'
            : 'Welcome back'}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        {devPasswordMode
          ? 'Sign in with your password'
          : mode === 'register'
            ? 'Register with your mobile'
            : 'Sign in with your mobile'}
      </h1>
      <p className="mt-3 leading-6 text-slate-600">
        {devPasswordMode
          ? 'Enter credentials for a configured local synthetic test account.'
          : 'We’ll send a one-time verification code to confirm it’s you.'}
      </p>
      <form className="mt-7 space-y-5" onSubmit={submit}>
        <div>
          <label htmlFor="country-code" className="mb-2 block text-sm font-semibold text-slate-700">
            Country code
          </label>
          <select
            id="country-code"
            value="+91"
            disabled
            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-800"
          >
            <option value="+91">India (+91)</option>
          </select>
        </div>
        <div>
          <label
            htmlFor="mobile-number"
            className="mb-2 block text-sm font-semibold text-slate-700"
          >
            Mobile number
          </label>
          <div className="flex rounded-xl border border-slate-300 focus-within:border-sky-600 focus-within:ring-2 focus-within:ring-sky-100">
            <span className="border-r border-slate-200 px-4 py-3 text-slate-500">+91</span>
            <input
              id="mobile-number"
              inputMode="numeric"
              autoComplete="tel-national"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'phone-error' : undefined}
              placeholder="98765 43210"
              maxLength={16}
              className="min-w-0 flex-1 rounded-r-xl px-4 py-3 outline-none"
              required
            />
          </div>
        </div>
        {devPasswordMode ? (
          <div>
            <label
              htmlFor="dev-test-password"
              className="mb-2 block text-sm font-semibold text-slate-700"
            >
              Test password
            </label>
            <input
              id="dev-test-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
              required
            />
          </div>
        ) : (
          mode === 'register' && (
            <div>
              <label
                htmlFor="account-role"
                className="mb-2 block text-sm font-semibold text-slate-700"
              >
                I’m registering as
              </label>
              <select
                id="account-role"
                value={role}
                onChange={(event) => setRole(event.target.value as 'PATIENT' | 'DOCTOR')}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-800"
              >
                <option value="PATIENT">Patient</option>
                <option value="DOCTOR">Doctor (verification pending)</option>
              </select>
            </div>
          )
        )}
        {error && (
          <p
            id="phone-error"
            role="alert"
            className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-5 py-3.5 font-semibold text-white transition hover:bg-sky-800 disabled:cursor-wait disabled:opacity-60"
        >
          {busy && (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          )}
          {busy
            ? devPasswordMode
              ? 'Signing in…'
              : 'Sending code…'
            : devPasswordMode
              ? 'Sign in to test HealthWallet'
              : mode === 'register'
                ? 'Register and send code'
                : 'Send sign-in code'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        {mode === 'register' ? 'Already have an account? ' : 'New to HealthWallet? '}
        <Link
          className="font-semibold text-sky-700 hover:underline"
          href={mode === 'register' ? '/login' : '/register'}
        >
          {mode === 'register' ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
      {mode === 'login' && !devPasswordMode && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setPurpose((value) => (value === 'LOGIN' ? 'RECOVERY' : 'LOGIN'))}
            className="text-sm font-semibold text-sky-700 hover:underline"
          >
            {purpose === 'LOGIN' ? 'Recover access with a mobile code' : 'Back to sign in'}
          </button>
        </div>
      )}
    </section>
  );
}
