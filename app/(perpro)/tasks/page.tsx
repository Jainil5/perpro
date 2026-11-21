import { Suspense } from 'react'
import type { Metadata } from 'next'

import TasksView from './TasksView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Tasks',
  description: 'Every task across projects, with filters, board view and bulk actions.',
}

export default function OsTasksPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading tasks…" />}>
      <TasksView />
    </Suspense>
  )
}
