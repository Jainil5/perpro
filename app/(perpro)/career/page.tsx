import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LoadingBlock } from '@/components/os/states'
import CareerView from './CareerView'

export const metadata: Metadata = { title: 'Career' }

// `useSearchParams` inside the view means the route must render under Suspense.
export default function CareerPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading the pipeline…" />}>
      <CareerView />
    </Suspense>
  )
}
