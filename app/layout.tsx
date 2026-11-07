import type { Metadata, Viewport } from 'next';
import './globals.css';
import Shell from '@/components/Shell';

export const metadata: Metadata = {
  title: 'PerPro — Founder Command Center',
  description: 'Notes, tasks, meetings and AI news for a busy founder.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}