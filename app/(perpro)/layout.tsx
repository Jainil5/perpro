import type { Metadata, Viewport } from 'next';
import Shell from '@/components/Shell';
import MotionProvider from '@/components/MotionProvider';

export const metadata: Metadata = {
  title: 'PerPro — Founder Command Center',
  description: 'Notes, tasks, meetings and AI news for a busy founder.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
};

export default function PerProLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionProvider>
      <Shell>{children}</Shell>
    </MotionProvider>
  );
}
