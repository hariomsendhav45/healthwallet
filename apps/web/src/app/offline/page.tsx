'use client';

import Link from 'next/link';
import { clearHealthVaultOfflineCache } from '../../components/pwa-register';

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-sky-50 px-5 py-12">
      <section className="max-w-lg rounded-3xl border border-sky-100 bg-white p-8 text-center shadow-sm sm:p-12">
        <p className="text-sm font-bold uppercase tracking-widest text-sky-700">HealthWallet</p>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">You’re offline</h1>
        <p className="mt-4 leading-7 text-slate-600">
          Connect to the internet to sign in and view your account. Medical records and personal
          health information require an active connection and are not stored offline on this device.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-sky-700 px-5 font-semibold text-white"
        >
          Try again
        </Link>
        <button
          type="button"
          onClick={async () => {
            await clearHealthVaultOfflineCache().catch(() => undefined);
            window.location.replace('/');
          }}
          className="ml-2 mt-6 inline-flex min-h-11 items-center rounded-xl border border-sky-200 px-5 font-semibold text-sky-800"
        >
          Reset offline app and retry
        </button>
      </section>
    </main>
  );
}
