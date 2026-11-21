import type { Metadata } from 'next'

import NotificationsView from './NotificationsView'

export const metadata: Metadata = {
  title: 'Notifications',
  description: 'Derived notifications and pending reminders.',
}

export default function OsNotificationsPage() {
  return <NotificationsView />
}
