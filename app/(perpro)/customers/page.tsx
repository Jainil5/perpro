import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LoadingBlock } from '@/components/os/states'
import CustomersView from './CustomersView'

export const metadata: Metadata = { title: 'Customers' }

// `useSearchParams` inside the view means the route must render under Suspense.
export default function CustomersPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading the accounts…" />}>
      <CustomersView />
    </Suspense>
  )
}
