import { Suspense } from 'react'
import type { Metadata } from 'next'

import FinanceView from './FinanceView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Finance',
  description:
    'Money math on your own numbers: income, spend, subscriptions, rates, runway — offline first.',
}

export default function FinanceOverviewPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Reading the ledger…" />}>
      <FinanceView />
    </Suspense>
  )
}
