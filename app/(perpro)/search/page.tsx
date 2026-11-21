import { Suspense } from 'react'
import type { Metadata } from 'next'

import SearchView from './SearchView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Search',
  description: 'Full-text results across every MyOS record.',
}

export default function OsSearchPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} label="Loading search…" />}>
      <SearchView />
    </Suspense>
  )
}
