import type { Metadata } from 'next'

import OsShell from '@/components/os/OsShell'
import { OsThemeScript } from '@/components/os/os-bootstrap'

import '../os.css'

export const metadata: Metadata = {
  title: {
    default: 'MyOS',
    template: '%s · MyOS',
  },
  description: 'MyOS Phase 1 — projects, tasks, notes, people and system tools over the local API.',
  applicationName: 'MyOS',
  other: { 'robots': 'noindex, nofollow' },
}

/**
 * MyOS console chrome. The theme script runs before the shell markup so the
 * first paint already carries `os-root` / `os-light`; everything data-driven
 * below is client-side and talks to the API through /api/os.
 */
export default function OsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OsThemeScript />
      <OsShell>{children}</OsShell>
    </>
  )
}
