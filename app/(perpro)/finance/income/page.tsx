import { Suspense } from 'react'
import type { Metadata } from 'next'

import IncomeView from './IncomeView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Income Calculator',
  description: 'Gross to take-home by slab, flat or presumptive — and the money actually received.',
}

export default function OsIncomePage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading income…" />}>
      <IncomeView />
    </Suspense>
  )
}
