import type { Metadata } from 'next'

import SettingsView from './SettingsView'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Workspace, theme, API health, demo data and export.',
}

export default function OsSettingsPage() {
  return <SettingsView />
}
