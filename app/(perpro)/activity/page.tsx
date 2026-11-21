import type { Metadata } from 'next'

import ActivityView from './ActivityView'

export const metadata: Metadata = {
  title: 'Activity',
  description: 'Everything that changed, newest first.',
}

export default function OsActivityPage() {
  return <ActivityView />
}
