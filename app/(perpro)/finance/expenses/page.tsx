import { Suspense } from 'react'
import type { Metadata } from 'next'

import ExpensesView from './ExpensesView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Expenses',
  description: 'Logged spend by month, category and vendor, with recurring share and CSV export.',
}

export default function OsExpensesPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} label="Loading expenses…" />}>
      <ExpensesView />
    </Suspense>
  )
}
