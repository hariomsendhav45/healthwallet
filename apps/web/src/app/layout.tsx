import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../auth/auth-provider';
import { InstallPromptCapture, PwaRegister } from '../components/pwa-register';
import { ConnectivityStatus } from '../components/connectivity-status';
export const metadata: Metadata = {
  title: 'HealthWallet | Your health, in one place',
  description: 'A secure home for your health records, wherever life takes you.',
  applicationName: 'HealthWallet',
  appleWebApp: { capable: true, title: 'HealthWallet', statusBarStyle: 'default' },
  icons: { apple: '/icons/healthvault-192.png' },
  formatDetection: { telephone: false },
  referrer: 'no-referrer',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        <InstallPromptCapture />
        <AuthProvider>
          <ConnectivityStatus />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
