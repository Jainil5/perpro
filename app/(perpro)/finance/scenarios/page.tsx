import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LoadingBlock } from '@/components/os/states'
import ScenariosView from './ScenariosView'

export const metadata: Metadata = { title: 'Cost Scenarios' }

// `useSearchParams` inside the view means the route must render under Suspense.
export default function ScenariosPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading the plans…" />}>
      <ScenariosView />
    </Suspense>
  )
}
