import { Suspense } from 'react'
import type { Metadata } from 'next'

import ContactsView from './ContactsView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'People',
  description: 'Contacts and companies, ready for the Phase 2 CRM.',
}

export default function OsContactsPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={5} label="Loading people…" />}>
      <ContactsView />
    </Suspense>
  )
}
