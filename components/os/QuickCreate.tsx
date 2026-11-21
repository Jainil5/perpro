'use client'

import { useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import type {
  ContactInput,
  NoteInput,
  ProjectInput,
  ReminderInput,
  TaskInput,
} from '@/lib/os/types'
import { ContactDialog } from './dialogs/ContactDialog'
import { NoteDialog } from './dialogs/NoteDialog'
import { ProjectDialog } from './dialogs/ProjectDialog'
import { ReminderDialog } from './dialogs/ReminderDialog'
import { TaskDialog } from './dialogs/TaskDialog'

export type QuickKind = 'task' | 'project' | 'note' | 'contact' | 'reminder' | 'import'

type QuickDefaultsFor<K extends QuickKind> = K extends 'task'
  ? Partial<TaskInput>
  : K extends 'project'
    ? Partial<ProjectInput>
    : K extends 'note'
      ? Partial<NoteInput>
      : K extends 'contact'
        ? Partial<ContactInput>
        : K extends 'reminder'
          ? Partial<ReminderInput>
          : K extends 'import'
            ? { project_id?: string | null }
            : never

interface QuickEntry {
  kind: QuickKind
  defaults?: Record<string, unknown>
}

interface QuickCreateValue {
  open: <K extends QuickKind>(kind: K, defaults?: QuickDefaultsFor<K>) => void
  close: () => void
}

const QuickCreateContext = createContext<QuickCreateValue | null>(null)

/**
 * Hosts the five create dialogs and the JSON import entry point so ⌘K, the top
 * bar and the dashboard can all raise the same form. Nothing here stores data:
 * every dialog POSTs through the API proxy.
 */
export function QuickCreateProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [entry, setEntry] = useState<QuickEntry | null>(null)

  const close = useCallback(() => setEntry(null), [])

  const open = useCallback(
    <K extends QuickKind>(kind: K, defaults?: QuickDefaultsFor<K>) => {
      // Import lives on the tasks screen so its result can refresh that list.
      if (kind === 'import') {
        const projectId = (defaults as { project_id?: string | null } | undefined)?.project_id
        router.push(projectId ? `/tasks?import=1&project=${projectId}` : '/tasks?import=1')
        setEntry(null)
        return
      }
      setEntry({ kind, defaults: defaults as Record<string, unknown> | undefined })
    },
    [router]
  )

  const value = useMemo<QuickCreateValue>(() => ({ open, close }), [open, close])

  return (
    <QuickCreateContext.Provider value={value}>
      {children}

      <TaskDialog
        open={entry?.kind === 'task'}
        onOpenChange={(next) => (next ? undefined : close())}
        defaults={entry?.kind === 'task' ? (entry.defaults as Partial<TaskInput>) : undefined}
      />
      <ProjectDialog
        open={entry?.kind === 'project'}
        onOpenChange={(next) => (next ? undefined : close())}
        defaults={entry?.kind === 'project' ? (entry.defaults as Partial<ProjectInput>) : undefined}
      />
      <NoteDialog
        open={entry?.kind === 'note'}
        onOpenChange={(next) => (next ? undefined : close())}
        defaults={
          entry?.kind === 'note'
            ? {
                title: (entry.defaults as Partial<NoteInput> | undefined)?.title ?? '',
                content: (entry.defaults as Partial<NoteInput> | undefined)?.content ?? '',
                category: (entry.defaults as Partial<NoteInput> | undefined)?.category ?? 'technical',
                tags: (entry.defaults as Partial<NoteInput> | undefined)?.tags ?? [],
                project_id: (entry.defaults as Partial<NoteInput> | undefined)?.project_id ?? null,
                is_favorite: false,
              }
            : undefined
        }
        onSaved={(note) => router.push(`/notes?note=${note.id}`)}
      />
      <ContactDialog
        open={entry?.kind === 'contact'}
        onOpenChange={(next) => (next ? undefined : close())}
        defaults={
          entry?.kind === 'contact'
            ? {
                name: (entry.defaults as Partial<ContactInput> | undefined)?.name ?? '',
                kind: (entry.defaults as Partial<ContactInput> | undefined)?.kind ?? 'client',
                company_id: (entry.defaults as Partial<ContactInput> | undefined)?.company_id ?? null,
                email: (entry.defaults as Partial<ContactInput> | undefined)?.email ?? '',
                phone: (entry.defaults as Partial<ContactInput> | undefined)?.phone ?? '',
                title: (entry.defaults as Partial<ContactInput> | undefined)?.title ?? '',
                location: (entry.defaults as Partial<ContactInput> | undefined)?.location ?? '',
                tags: (entry.defaults as Partial<ContactInput> | undefined)?.tags ?? [],
                notes: (entry.defaults as Partial<ContactInput> | undefined)?.notes ?? '',
              }
            : undefined
        }
        onSaved={(contact) => router.push(`/contacts?contact=${contact.id}`)}
      />
      <ReminderDialog
        open={entry?.kind === 'reminder'}
        onOpenChange={(next) => (next ? undefined : close())}
        onSaved={() => router.push('/notifications')}
      />
    </QuickCreateContext.Provider>
  )
}

export function useQuickCreate(): QuickCreateValue {
  const ctx = useContext(QuickCreateContext)
  if (!ctx) {
    return { open: () => undefined, close: () => undefined }
  }
  return ctx
}
