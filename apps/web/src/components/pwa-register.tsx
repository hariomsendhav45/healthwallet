'use client';

import { useEffect } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
type PwaWindow = Window & { deferredInstallPrompt?: InstallPromptEvent };

const HEALTHVAULT_CACHE_PREFIX = 'healthvault-static-';

function isHealthVaultWorker(worker: ServiceWorker | null): boolean {
  if (!worker) return false;
  try {
    const script = new URL(worker.scriptURL);
    return script.origin === window.location.origin && script.pathname === '/sw.js';
  } catch {
    return false;
  }
}

export async function clearHealthVaultOfflineCache(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) =>
          [registration.installing, registration.waiting, registration.active].some(
            isHealthVaultWorker,
          ),
        )
        .map((registration) => registration.unregister()),
    );
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(HEALTHVAULT_CACHE_PREFIX))
        .map((name) => caches.delete(name)),
    );
  }
}

export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void clearHealthVaultOfflineCache().catch(() => undefined);
      return;
    }

    void navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => undefined);
  }, []);
  return null;
}

export function InstallPromptCapture() {
  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      (window as PwaWindow).deferredInstallPrompt = event as InstallPromptEvent;
      window.dispatchEvent(new Event('pwa-install-change'));
    };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);
  return null;
}

export function InstallPwaButton() {
  const install = async () => {
    const host = window as PwaWindow;
    if (!host.deferredInstallPrompt) return;
    await host.deferredInstallPrompt.prompt();
    await host.deferredInstallPrompt.userChoice;
    delete host.deferredInstallPrompt;
    window.dispatchEvent(new Event('pwa-install-change'));
  };
  return (
    <button
      onClick={() => void install()}
      className="min-h-11 rounded-xl border border-sky-200 bg-white px-3 text-sm font-semibold text-sky-800 hover:bg-sky-50 sm:px-4"
    >
      Install app
    </button>
  );
}
