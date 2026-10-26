import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { AmplifyProvider } from '@/components/system/AmplifyProvider';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'ANA Admin | Pernexium',
  description: 'Consola de administración de ANA',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-MX" className={inter.variable}>
      <body className={inter.className}>
        <AmplifyProvider />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
