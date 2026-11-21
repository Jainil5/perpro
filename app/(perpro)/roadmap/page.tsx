import type { Metadata } from 'next'

import RoadmapView from './RoadmapView'

export const metadata: Metadata = {
  title: 'Roadmap',
  description: 'What Phase 1 ships and what the later phases will add.',
}

export default function OsRoadmapPage() {
  return <RoadmapView />
}
