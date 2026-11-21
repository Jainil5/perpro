import { Suspense } from 'react'
import type { Metadata } from 'next'

import NotesView from './NotesView'
import { LoadingBlock } from '@/components/os/states'

export const metadata: Metadata = {
  title: 'Notes',
  description: 'Markdown notes with categories, tags, relations and backlinks.',
}

export default function OsNotesPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} label="Loading notes…" />}>
      <NotesView />
    </Suspense>
  )
}
