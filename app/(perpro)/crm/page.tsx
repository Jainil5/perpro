import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LoadingBlock } from '@/components/os/states'
import CrmView from './CrmView'

export const metadata: Metadata = { title: 'Freelance CRM' }

// `useSearchParams` inside the view means the route must render under Suspense.
export default function CrmPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading the pipeline…" />}>
      <CrmView />
    </Suspense>
  )
}
