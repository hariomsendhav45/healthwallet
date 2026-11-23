'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import { InstallPwaButton } from './pwa-register';

const links = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/profile', label: 'My profile' },
  { href: '/health-information', label: 'Health information' },
  { href: '/health-tracking', label: 'Health tracking' },
  { href: '/medical-records', label: 'Medical records' },
  { href: '/health-insights', label: 'Health insights' },
  { href: '/reminders', label: 'Reminders' },
  { href: '/ai-assistant', label: 'AI assistant' },
  { href: '/sharing', label: 'Medical sharing' },
  { href: '/family', label: 'Family members' },
];

export function PatientShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const [installAvailable, setInstallAvailable] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    if (!loading && user && user.role !== 'PATIENT')
      router.replace(user.role === 'DOCTOR' ? '/doctor/dashboard' : '/dashboard');
  }, [loading, user, router]);

  useEffect(() => {
    const refresh = () =>
      setInstallAvailable(
        Boolean((window as Window & { deferredInstallPrompt?: Event }).deferredInstallPrompt),
      );
    refresh();
    window.addEventListener('pwa-install-change', refresh);
    return () => window.removeEventListener('pwa-install-change', refresh);
  }, []);

  if (loading || !user || user.role !== 'PATIENT') {
    return (
      <main
        className="grid min-h-screen place-items-center bg-sky-50 text-slate-600"
        aria-live="polite"
      >
        Checking your session…
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f5f3]">
      <div className="mx-auto grid min-h-screen max-w-[1500px] gap-5 p-4 sm:p-6 md:grid-cols-[250px_minmax(0,1fr)] md:items-stretch lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-8 lg:p-8">
        <aside className="flex flex-col rounded-[24px] bg-[#062b25] p-4 text-white sm:p-5 md:sticky md:top-6 md:h-[calc(100vh-3rem)]">
          <Link href="/dashboard" className="mb-7 flex items-center gap-3 px-2 py-1 text-xl font-bold">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f3b536] text-2xl text-[#092d26]" aria-hidden="true">✚</span>
            HealthWallet
          </Link>
        <nav
          aria-label="Patient navigation"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:flex-1 md:flex-col"
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={path === link.href ? 'page' : undefined}
              className={`flex min-h-12 items-center justify-center rounded-xl px-3 py-2 text-center font-semibold md:justify-start md:text-left ${path === link.href ? 'border-l-4 border-[#f3b536] bg-[#10453c] text-white' : 'text-[#cee0da] hover:bg-white/10'}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <details className="mt-3 rounded-xl border border-[#4b8f80] px-3 py-2 text-sm text-[#cee0da]">
          <summary className="min-h-8 cursor-pointer font-semibold text-white">
            Install HealthWallet
          </summary>
          <p className="pb-2 leading-6">
            On supported browsers, use the Install app button or browser menu. On iPhone or iPad,
            open Share and choose Add to Home Screen.
          </p>
        </details>
        {installAvailable && <div className="mt-3"><InstallPwaButton /></div>}
        <button onClick={() => void logout()} className="mt-3 min-h-12 rounded-xl border border-[#4b8f80] px-4 font-semibold text-white hover:bg-white/10">Log out</button>
        </aside>
        <main className="min-w-0 rounded-[24px] bg-[#f2f5f3] p-2 sm:p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
