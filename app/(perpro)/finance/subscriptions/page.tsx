import { Suspense } from 'react'
import type { Metadata } from 'next'

import SubscriptionsView from './SubscriptionsView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Subscriptions',
  description: 'Recurring commitments, renewal dates and the normalised monthly cost of each.',
}

export default function OsSubscriptionsPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading subscriptions…" />}>
      <SubscriptionsView />
    </Suspense>
  )
}
