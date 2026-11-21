import type { Metadata } from 'next'

import ProjectDetailView from './ProjectDetailView'

export const metadata: Metadata = {
  title: 'Project',
  description: 'Tasks, milestones and statistics for one project.',
}

export default async function OsProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ProjectDetailView id={id} />
}
