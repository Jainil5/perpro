import { Suspense } from 'react'
import type { Metadata } from 'next'

import ProjectsView from './ProjectsView'
import { LoadingCards } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Projects',
  description: 'Every project with progress, next action and deadlines.',
}

export default function OsProjectsPage() {
  return (
    <Suspense fallback={<LoadingCards count={4} />}>
      <ProjectsView />
    </Suspense>
  )
}
