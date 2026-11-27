import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LoadingBlock } from '@/components/os/states'
import ServicesView from './ServicesView'

export const metadata: Metadata = { title: 'Service Catalogue' }

// `useSearchParams` inside the view means the route must render under Suspense.
export default function ServicesPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading the catalogue…" />}>
      <ServicesView />
    </Suspense>
  )
}
