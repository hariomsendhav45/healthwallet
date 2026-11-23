import { API_BASE } from './api';

export async function patientRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/api/patient${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
  });
  const body = (await response.json().catch(() => ({}))) as {
    message?: string | string[];
  } & T;
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    throw new Error(message || 'Unable to load your information. Please try again.');
  }
  return body;
}
