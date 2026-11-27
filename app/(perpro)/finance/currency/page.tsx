import { Suspense } from 'react'
import type { Metadata } from 'next'

import CurrencyView from './CurrencyView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Currency Converter',
  description: 'Convert at the rates you own, keep the ledger, and see exactly which rate answered.',
}

export default function OsCurrencyPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading currencies…" />}>
      <CurrencyView />
    </Suspense>
  )
}
