import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HealthWallet',
    short_name: 'HealthWallet',
    description: 'Your personal health information, securely organized.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#0369a1',
    icons: [
      { src: '/icons/healthvault-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/healthvault-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/healthvault-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/healthvault-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
