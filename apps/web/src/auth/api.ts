import type { AuthUser } from '@healthvault/shared';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/api/auth${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as { message?: string | string[] } & T;
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    throw new Error(message || 'Unable to complete the request. Please try again.');
  }
  return body;
}

export type { AuthUser };
