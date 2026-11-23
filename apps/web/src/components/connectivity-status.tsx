'use client';

import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../auth/api';

type Connectivity = 'checking' | 'online' | 'offline' | 'service-unavailable';

export function ConnectivityStatus() {
  const [status, setStatus] = useState<Connectivity>('checking');

  const checkService = useCallback(async () => {
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/health`, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      });
      setStatus(response.ok ? 'online' : 'service-unavailable');
    } catch {
      setStatus(navigator.onLine ? 'service-unavailable' : 'offline');
    }
  }, []);

  useEffect(() => {
    const handleOffline = () => setStatus('offline');
    const handleOnline = () => void checkService();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    void checkService();
    const interval = window.setInterval(() => void checkService(), 30000);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.clearInterval(interval);
    };
  }, [checkService]);

  if (status === 'checking' || status === 'online') return null;
  const message =
    status === 'offline'
      ? 'You appear to be offline. Your saved health information is not available offline.'
      : 'HealthWallet services are temporarily unavailable. Your information is safe; try again shortly.';

  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950"
      role="status"
      aria-live="polite"
    >
      <span>{message}</span>
      <button
        type="button"
        className="shrink-0 rounded-lg px-3 py-1 font-semibold underline underline-offset-2"
        onClick={() => void checkService()}
      >
        Retry
      </button>
    </div>
  );
}
