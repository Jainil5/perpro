import type { Metadata } from 'next'

import GoalsView from './GoalsView'

export const metadata: Metadata = {
  title: 'Goals',
  description: 'Outcomes with a target date and a progress number.',
}

export default function OsGoalsPage() {
  return <GoalsView />
}
