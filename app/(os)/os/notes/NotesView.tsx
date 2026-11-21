'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  BookOpen,
  Braces,
  Eye,
  Link2,
  Notebook,
  Plus,
  Save,
  Star,
  Trash2,
  Unlink,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useSearchParams } from 'next/navigation'

import { api, errorMessage, type OsApiError } from '@/lib/os/client'
import { invalidate, useDebounced, useEnums, useResource } from '@/lib/os/hooks'
import { countLabel, enumLabel, formatDate, relativeTime, wordCount } from '@/lib/os/format'
import type {
  Note,
  NoteCategory,
  NoteInput,
  NoteSort,
  NotesListResponse,
  NoteSummary,
  RelationTargetType,
  SearchItem,
  SearchResponse,
} from '@/lib/os/types'
import { Button, IconButton } from '@/components/os/ui/button'
import { Panel } from '@/components/os/ui/card'
import { Input } from '@/components/os/ui/input'
import { CodeArea } from '@/components/os/ui/textarea'
import { Field } from '@/components/os/ui/label'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from '@/components/os/ui/select'
import { SwitchRow } from '@/components/os/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/os/ui/tabs'
import { Badge } from '@/components/os/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/os/ui/popover'
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  LoadingCards,
  ResourceState,
  SoftError,
} from '@/components/os/states'
import { FilterBar, FilterChip, InlineSearch, SortSelect } from '@/components/os/filters'
import { ProjectSelect, TagInput, useTagOptions } from '@/components/os/pickers'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { NoteDialog } from '@/components/os/dialogs/NoteDialog'
import { toastError, toastSuccess } from '@/components/os/ui/toast'

const NOTE_SCOPE = ['/notes', '/dashboard', '/meta', '/activity', '/search']
const SORTS: NoteSort[] = ['updated', 'created', 'title']
const ALL = '__all'
const FAVORITES = '__favorites'

/** `search` groups are plural, relation types are singular. */
const TYPE_BY_GROUP: Record<string, RelationTargetType> = {
  task: 'task',
  tasks: 'task',
  project: 'project',
  projects: 'project',
  note: 'note',
  notes: 'note',
  milestone: 'milestone',
  milestones: 'milestone',
  contact: 'contact',
  contacts: 'contact',
  company: 'company',
  companies: 'company',
}

export default function NotesView() {
  const params = useSearchParams()
  const { enums } = useEnums()
  const [category, setCategory] = useState<string>(params.get('category') ?? ALL)
  const [tag, setTag] = useState<string>(params.get('tag') ?? ALL)
  const [term, setTerm] = useState<string>(params.get('q') ?? '')
  const [sort, setSort] = useState<NoteSort>('updated')
  const [selected, setSelected] = useState<string | null>(params.get('note'))
  const [creating, setCreating] = useState(false)

  const q = useDebounced(term.trim(), 300)
  const favorite = category === FAVORITES
  const list = useResource<NotesListResponse>('/notes', {
    category: category === ALL || favorite ? undefined : category,
    favorite: favorite ? true : undefined,
    tag: tag === ALL ? undefined : tag,
    q: q || undefined,
    sort,
  })
  const tagOptions = useTagOptions()
  const notes = list.data?.items ?? []

  /**
   * A `?note=` deep link is never swapped for the first row: `NoteEditor` loads
   * that id straight from `GET /notes/{id}`, so the right document opens even
   * when the note sits outside the current filters or page.
   */
  const pinned = useRef<string | null>(params.get('note'))
  const noteParam = params.get('note')

  // The same link arriving later — from ⌘K or Activity while already on this
  // page — has to move the selection, because the state initialiser will not.
  useEffect(() => {
    if (!noteParam) return
    pinned.current = noteParam
    setSelected(noteParam)
  }, [noteParam])

  // Keep a sensible selection: deep link or current pick, else the first result.
  useEffect(() => {
    if (!notes.length) return
    if (selected === pinned.current) return
    if (selected && notes.some((note) => note.id === selected)) return
    setSelected(notes[0].id)
  }, [notes, selected])

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="os-eyebrow">Personal</p>
          <h1 className="os-title">Notes</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {list.loading && !list.data
              ? 'Loading…'
              : countLabel(list.data?.total ?? 0, 'note', 'notes')}
            {' · markdown source, saved when you press Save'}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New note
        </Button>
      </header>

      <FilterBar>
        <FilterChip active={category === ALL} onClick={() => setCategory(ALL)}>
          All
        </FilterChip>
        <FilterChip
          active={favorite}
          onClick={() => setCategory(favorite ? ALL : FAVORITES)}
          count={notes.filter((note) => note.is_favorite).length || undefined}
          tone="warning"
        >
          <Star className="size-3" /> Favorites
        </FilterChip>
        <span className="os-scroll-x flex items-center gap-2">
          {(list.data?.categories ?? []).map((row) => (
            <FilterChip
              key={row.category}
              active={category === row.category}
              onClick={() => setCategory(category === row.category ? ALL : row.category)}
              count={row.count}
            >
              {enumLabel(row.category)}
            </FilterChip>
          ))}
        </span>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger size="sm" className="w-[8rem]" aria-label="Tag filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <Option value={ALL}>Any tag</Option>
            {(tagOptions.data ?? []).map((row) => (
              <Option key={row.tag} value={row.tag}>
                {row.tag} · {row.count}
              </Option>
            ))}
          </SelectContent>
        </Select>
        <InlineSearch value={term} onChange={setTerm} placeholder="Search notes…" className="min-w-[10rem]" />
        <SortSelect value={sort} onChange={(next) => setSort(next as NoteSort)} options={SORTS} />
      </FilterBar>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <ResourceState
          resource={list}
          skeleton={<LoadingCards count={2} />}
          empty={
            <EmptyBlock
              title="No notes yet"
              description="Notes are markdown. Write them by hand, paste them from an agent, or keep a running log per project."
              icon={<Notebook className="size-5" />}
            />
          }
        >
          {(data) => (
            <ul className="os-enter max-h-[calc(100dvh-16rem)] space-y-1.5 overflow-y-auto pr-1 xl:max-h-[calc(100dvh-11rem)]">
              {data.items.map((note) => (
                <li key={note.id}>
                  <NoteExcerpt
                    note={note}
                    active={note.id === selected}
                    onOpen={() => setSelected(note.id)}
                  />
                </li>
              ))}
              {!data.items.length ? (
                <li className="px-2 py-6 text-xs text-muted-foreground">
                  Nothing matches these filters.
                </li>
              ) : null}
            </ul>
          )}
        </ResourceState>

        <div className="min-w-0">
          {selected ? (
            <NoteEditor noteId={selected} categories={enums.note_category} onDeleted={() => setSelected(null)} />
          ) : (
            <Panel title="Note">
              <p className="py-6 text-xs text-muted-foreground">
                Pick a note on the left, or create one.
              </p>
            </Panel>
          )}
        </div>
      </div>

      <NoteDialog
        open={creating}
        onOpenChange={setCreating}
        defaults={{ category: (category === ALL || favorite ? 'technical' : category) as NoteCategory }}
        onSaved={(note) => {
          setCreating(false)
          setSelected(note.id)
        }}
      />
    </div>
  )
}

function NoteExcerpt({
  note,
  active,
  onOpen,
}: {
  note: NoteSummary
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active || undefined}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? 'border-primary/50 bg-primary/5' : 'border-line bg-card hover:border-line-strong'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">{note.title}</span>
            {note.is_favorite ? <Star className="size-3 shrink-0 text-warning" aria-label="Favorite" /> : null}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-relaxed text-muted-foreground">
            {note.excerpt || 'Empty note'}
          </span>
        </span>
        <span className="shrink-0 text-[10.5px] text-faint">{relativeTime(note.updated_at)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px]">
        {note.category ? (
          <Badge tone="outline" size="sm">
            {enumLabel(note.category)}
          </Badge>
        ) : null}
        {(note.tags ?? []).slice(0, 3).map((value) => (
          <Badge key={value} tone="neutral" size="sm">
            {value}
          </Badge>
        ))}
        <span className="os-num ml-auto text-faint">{note.word_count} words</span>
      </div>
    </button>
  )
}

/**
 * The note editor. `GET /notes/{id}` supplies the document; the save button is
 * the only thing that writes, and `dirty` is shown before leaving.
 */
function NoteEditor({
  noteId,
  categories,
  onDeleted,
}: {
  noteId: string
  categories: string[]
  onDeleted: () => void
}) {
  const resource = useResource<Note>(`/notes/${noteId}`)
  const tagOptions = useTagOptions()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [tagList, setTagList] = useState<string[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<OsApiError | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [relateOpen, setRelateOpen] = useState(false)

  const note = resource.data

  useEffect(() => {
    if (!note) return
    setTitle(note.title)
    setContent(note.content)
    setCategory(note.category ?? null)
    setTagList(note.tags ?? [])
    setProjectId(note.project_id)
    setFavorite(note.is_favorite)
    setDirty(false)
    setError(null)
  }, [note])

  function save() {
    if (!note || saving) return
    setSaving(true)
    const body: NoteInput = {
      title: title.trim(),
      content,
      category: category as NoteCategory,
      tags: tagList,
      project_id: projectId,
      is_favorite: favorite,
    }
    api<Note>(`/notes/${note.id}`, { method: 'PATCH', body })
      .then((saved) => {
        resource.setData(saved)
        setDirty(false)
        invalidate(...NOTE_SCOPE)
        toastSuccess('Note saved', { description: saved.title })
      })
      .catch((e) => setError(e as OsApiError))
      .finally(() => setSaving(false))
  }

  if (resource.error && !note)
    return <ErrorBlock error={resource.error} onRetry={resource.reload} title="This note could not be loaded" />
  if (!note) return <LoadingBlock rows={5} label="Loading note…" />

  const words = wordCount(content)
  const relations = note.relations ?? []
  const backlinks = note.backlinks ?? []

  return (
    <Panel
      dense
      title={
        <span className="flex items-center gap-2">
          <Link href="/os/notes" className="xl:hidden">
            <ArrowLeft className="size-4" aria-label="Back to the list" />
          </Link>
          <span className="truncate">{note.title}</span>
        </span>
      }
      description={
        <>
          Updated {formatDate(note.updated_at, 'd MMM, HH:mm')} · {words} words
          {dirty ? ' · unsaved changes' : ''}
        </>
      }
      action={
        <>
          {dirty ? <Badge tone="warning">Unsaved</Badge> : null}
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            <Save /> Save
          </Button>
          <IconButton label="Delete note" size="icon-sm" onClick={() => setDeleting(true)}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title" htmlFor={`note-title-${note.id}`} error={title.trim() ? null : 'Title is required'}>
          <Input
            id={`note-title-${note.id}`}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setDirty(true)
            }}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor={`note-category-${note.id}`}>
            <Select
              value={category ?? '__none'}
              onValueChange={(next) => {
                setCategory(next === '__none' ? null : next)
                setDirty(true)
              }}
            >
              <SelectTrigger id={`note-category-${note.id}`}>
                <SelectValue placeholder="Uncategorised" />
              </SelectTrigger>
              <SelectContent>
                <Option value="__none">Uncategorised</Option>
                {categories.map((value) => (
                  <Option key={value} value={value}>
                    {enumLabel(value)}
                  </Option>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Project" htmlFor={`note-project-${note.id}`}>
            <ProjectSelect
              value={projectId}
              onChange={(next) => {
                setProjectId(next)
                setDirty(true)
              }}
            />
          </Field>
        </div>

        <Field label="Tags" hint="Comma or Enter">
          <TagInput
            value={tagList}
            suggestions={(tagOptions.data ?? []).map((row) => row.tag)}
            onChange={(next) => {
              setTagList(next)
              setDirty(true)
            }}
          />
        </Field>

        <SwitchRow
          label="Favourite"
          description="Show this note in the favourites filter"
          checked={favorite}
          onCheckedChange={(next) => {
            setFavorite(next === true)
            setDirty(true)
          }}
        />

        <Tabs defaultValue="write">
          <TabsList>
            <TabsTrigger value="write">
              <Braces /> Source
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye /> Preview
            </TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <CodeArea
              value={content}
              spellCheck
              onChange={(event) => {
                setContent(event.target.value)
                setDirty(true)
              }}
              placeholder={'# Heading\n\nMarkdown lives here.'}
              className="min-h-[16rem] text-[12.5px]"
              aria-label="Note markdown"
            />
          </TabsContent>
          <TabsContent value="preview">
            <div className="markdown-body min-h-[16rem] rounded-lg border border-line bg-input/60 p-3 text-[13px]">
              {content.trim() ? (
                <ReactMarkdown>{content}</ReactMarkdown>
              ) : (
                <p className="text-xs text-faint">Nothing to preview yet.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <SoftError error={error} />

        <div className="space-y-2 rounded-xl border border-line bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="os-eyebrow">
              <Link2 className="mr-1 inline size-3" />
              Related
            </p>
            <Popover open={relateOpen} onOpenChange={setRelateOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline">
                  <Plus /> Relate
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-3">
                <RelateTo
                  note={note}
                  onDone={() => {
                    setRelateOpen(false)
                    resource.reload()
                    invalidate(...NOTE_SCOPE)
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          {relations.length ? (
            <ul className="space-y-1">
              {relations.map((relation) => (
                <li key={relation.id} className="flex items-center gap-2 text-xs">
                  <Badge tone="neutral" size="sm">
                    {relation.target_type}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate" title={relation.target_title ?? relation.target_id}>
                    {relation.target_title ?? 'Unknown record'}
                  </span>
                  <IconButton
                    label={`Remove relation to ${relation.target_title ?? 'record'}`}
                    size="icon-sm"
                    onClick={() =>
                      api(`/notes/${note.id}/relations/${relation.id}`, { method: 'DELETE' })
                        .then(() => {
                          resource.reload()
                          invalidate(...NOTE_SCOPE)
                        })
                        .catch((e) => toastError(errorMessage(e)))
                    }
                  >
                    <Unlink className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-faint">
              Nothing linked. Relations are stored on the note, so a task or project can be reached
              straight from here.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-line bg-muted/30 p-3">
          <p className="os-eyebrow mb-1.5">
            <BookOpen className="mr-1 inline size-3" />
            Backlinks
          </p>
          {backlinks.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {backlinks.map((link) => (
                <li key={link.note_id}>
                  <Link
                    href={`/os/notes?note=${link.note_id}`}
                    className="inline-flex h-7 items-center rounded-lg border border-line bg-card px-2 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {link.note_title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-faint">No other note points here yet.</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${note.title}”`}
        description="Notes are deleted for good; relations go with them."
        confirmLabel="Delete note"
        onConfirm={() =>
          api(`/notes/${note.id}`, { method: 'DELETE' }).then(() => {
            invalidate(...NOTE_SCOPE)
            toastSuccess('Note deleted', { description: note.title })
            onDeleted()
          })
        }
      />
    </Panel>
  )
}

/** Searches the API for a record to point this note at. */
function RelateTo({ note, onDone }: { note: Note; onDone: () => void }) {
  const [term, setTerm] = useState('')
  const q = useDebounced(term.trim(), 250)
  const search = useResource<SearchResponse>(q.length >= 2 ? '/search' : null, { q, limit: 8 })
  const rows = useMemo(() => {
    const out: { item: SearchItem; type: RelationTargetType }[] = []
    for (const group of search.data?.groups ?? []) {
      const type = TYPE_BY_GROUP[group.type]
      if (!type) continue
      for (const item of group.items) out.push({ item, type })
    }
    return out.slice(0, 12)
  }, [search.data])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function link(type: RelationTargetType, id: string) {
    setBusyId(id)
    setError(null)
    api(`/notes/${note.id}/relations`, { method: 'POST', body: { target_type: type, target_id: id } })
      .then(onDone)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusyId(null))
  }

  return (
    <div className="space-y-2">
      <InlineSearch value={term} onChange={setTerm} placeholder="Find a task, project, note…" />
      {q.length < 2 ? (
        <p className="text-[11px] text-faint">Type at least two characters to search.</p>
      ) : search.loading ? (
        <p className="text-[11px] text-faint">Searching…</p>
      ) : rows.length ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {rows.map(({ item, type }) => (
            <li key={`${type}-${item.id}`}>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => link(type, item.id)}
                className="os-tap-none flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11.5px] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <Badge tone="neutral" size="sm">
                  {type}
                </Badge>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-faint">No matches for “{q}”.</p>
      )}
      {error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

