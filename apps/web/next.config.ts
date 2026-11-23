import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const isProduction = process.env.NODE_ENV === 'production';
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').origin;
const isLoopbackApi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(apiOrigin);
if (isProduction && !apiOrigin.startsWith('https://') && !isLoopbackApi) {
  throw new Error('Production NEXT_PUBLIC_API_BASE_URL must use HTTPS.');
}
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}${isProduction ? '' : ' ws:'}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(repoRoot),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};
export default nextConfig;
