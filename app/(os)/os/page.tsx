import type { Metadata } from 'next'

import DashboardView from './DashboardView'

export const metadata: Metadata = {
  title: 'Overview',
  description: 'Your day across tasks, projects, notes and reminders.',
}

export default function OsDashboardPage() {
  return <DashboardView />
}
