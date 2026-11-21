import type { Metadata, Viewport } from 'next';
import Shell from '@/components/Shell';
import MotionProvider from '@/components/MotionProvider';
import { OsThemeScript } from '@/components/os/os-bootstrap';

import '../os.css';

export const metadata: Metadata = {
  title: {
    default: 'PerPro—OS',
    template: '%s · PerPro—OS',
  },
  description: 'Notes, tasks, meetings and AI news for a busy founder.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // the canvas itself (docs/DESIGN.md §1): --os-canvas-deep, not zinc-950.
  themeColor: '#0F1012',
};

/**
 * One app, one shell. The theme script runs before the shell markup so the
 * first paint already carries `os-root` / `os-light` on <html> — that is the
 * token contract `app/os.css` expects for both the MyOS screens and the
 * Supabase ones (docs/MYOS/ARCHITECTURE.md §4).
 */
export default function PerProLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OsThemeScript />
      <MotionProvider>
        <Shell>{children}</Shell>
      </MotionProvider>
    </>
  );
}
