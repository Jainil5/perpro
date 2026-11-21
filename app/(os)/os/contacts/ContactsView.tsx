'use client'

import Link from 'next/link'
import {
  Building2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { api } from '@/lib/os/client'
import { invalidate, useDebounced, useResource } from '@/lib/os/hooks'
import { countLabel, relativeTime } from '@/lib/os/format'
import type { Company, Contact, ListResponse } from '@/lib/os/types'
import { cn } from '@/lib/os/cn'
import { Button, IconButton } from '@/components/os/ui/button'
import { Panel } from '@/components/os/ui/card'
import { Badge } from '@/components/os/ui/badge'
import { Avatar } from '@/components/os/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/os/ui/table'
import { Option, Select, SelectContent, SelectTrigger, SelectValue } from '@/components/os/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/os/ui/tabs'
import { EmptyBlock, ErrorBlock, LoadingBlock, ResourceState } from '@/components/os/states'
import { FilterBar, InlineSearch, LoadMore } from '@/components/os/filters'
import { CompanySelect, useTagOptions } from '@/components/os/pickers'
import { CompanyDialog, ContactDialog } from '@/components/os/dialogs/ContactDialog'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { toastSuccess } from '@/components/os/ui/toast'

const PEOPLE_SCOPE = ['/contacts', '/companies', '/dashboard', '/meta', '/activity', '/search']
const PAGE = 50
const ALL = '__all'

export default function ContactsView() {
  const params = useSearchParams()
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [companyId, setCompanyId] = useState<string | null>(params.get('company'))
  const [tag, setTag] = useState<string>(ALL)
  const [pages, setPages] = useState(1)
  const [selected, setSelected] = useState<string | null>(params.get('contact'))
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<Contact | null>(null)
  const [deleting, setDeleting] = useState<Contact | null>(null)
  const [companyDialog, setCompanyDialog] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [deletingCompany, setDeletingCompany] = useState<Company | null>(null)

  const q = useDebounced(term.trim(), 300)
  const contacts = useResource<ListResponse<Contact>>('/contacts', {
    q: q || undefined,
    company_id: companyId ?? undefined,
    limit: PAGE * pages,
    offset: 0,
  })
  const companies = useResource<ListResponse<Company>>('/companies')
  const tagOptions = useTagOptions()

  useEffect(() => {
    setPages(1)
  }, [q, companyId, tag])

  // The API has no tag filter for contacts, so tags narrow what is loaded.
  const rows = useMemo(() => {
    const items = contacts.data?.items ?? []
    return tag === ALL ? items : items.filter((contact) => (contact.tags ?? []).includes(tag))
  }, [contacts.data, tag])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const company of companies.data?.items ?? []) map[company.id] = company
    return map
  }, [companies.data])

  const listed = rows.find((contact) => contact.id === selected) ?? null
  /**
   * A `?contact=` deep link from Activity or Search may point at somebody off
   * the loaded page, so the record is fetched on its own rather than silently
   * showing the unfiltered first page.
   */
  const offPage = Boolean(selected) && !listed
  const fetched = useResource<Contact | null>(offPage ? `/contacts/${selected}` : null)
  const current = listed ?? fetched.data ?? null

  /**
   * `?contact=` also arrives while this page is already mounted (⌘K, an
   * activity row), so the param — not the initial state — drives the
   * selection. The editor then opens once the record is in hand, whether that
   * is this render or the one after the fetch above resolves.
   */
  const contactParam = params.get('contact')
  const opened = useRef<string | null>(null)

  useEffect(() => {
    if (!contactParam) return
    setSelected(contactParam)
    if (current?.id !== contactParam || opened.current === contactParam) return
    opened.current = contactParam
    setEditing(current)
    setDialog(true)
  }, [contactParam, current])

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="os-eyebrow">Personal</p>
          <h1 className="os-title">People</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {contacts.loading && !contacts.data
              ? 'Loading…'
              : `${countLabel(contacts.data?.total ?? 0, 'contact', 'contacts')} · ${countLabel(
                  companies.data?.total ?? 0,
                  'company',
                  'companies'
                )}`}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialog(true)
          }}
        >
          <Plus /> New contact
        </Button>
      </header>

      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">
            <Users /> Contacts
          </TabsTrigger>
          <TabsTrigger value="companies">
            <Building2 /> Companies
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="space-y-3">
          <FilterBar>
            <InlineSearch value={term} onChange={setTerm} placeholder="Search people…" className="min-w-[10rem]" />
            <CompanySelect
              value={companyId}
              onChange={setCompanyId}
              placeholder="Any company"
              className="w-[9rem]"
            />
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger size="sm" className="w-[8.5rem]" aria-label="Tag filter">
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
            {tag !== ALL ? (
              <span className="text-[11px] text-faint">
                Tags narrow the loaded page — the API filters contacts by company and text only.
              </span>
            ) : null}
          </FilterBar>

          <ResourceState
            resource={contacts}
            skeleton={<LoadingBlock rows={5} label="Loading contacts…" />}
            empty={
              <EmptyBlock
                title="No contacts yet"
                description="Phase 2 turns this table into a CRM pipeline. For now it is a plain, searchable address book that notes and tasks can point at."
                icon={<Users className="size-5" />}
                action={
                  <Button size="sm" onClick={() => { setEditing(null); setDialog(true) }}>
                    <Plus /> New contact
                  </Button>
                }
              />
            }
          >
            {(data) => (
              <Panel
                dense
                title={countLabel(rows.length, 'contact', 'contacts')}
                description="Company comes from the API join, not from typing it twice"
                bodyClassName="pt-1"
              >
                {rows.length ? (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[44rem]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Company</TableHead>
                          <TableHead>Kind</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Tags</TableHead>
                          <TableHead className="text-right">Updated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((contact) => (
                          <TableRow
                            key={contact.id}
                            className={cn(selected === contact.id && 'bg-accent')}
                          >
                            <TableCell>
                              <div className="flex min-w-0 items-center gap-2">
                                <Avatar name={contact.name} size="sm" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelected(contact.id)
                                    setEditing(contact)
                                    setDialog(true)
                                  }}
                                  className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <span className="block truncate text-[12.5px] font-medium text-foreground">
                                    {contact.name}
                                  </span>
                                  {contact.title ? (
                                    <span className="block truncate text-[11px] text-muted-foreground">
                                      {contact.title}
                                    </span>
                                  ) : null}
                                </button>
                              </div>
                            </TableCell>
                            <TableCell>
                              {contact.company_id ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCompanyId(contact.company_id)
                                    setTag(ALL)
                                  }}
                                  className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                                >
                                  {contact.company ?? companyById[contact.company_id]?.name ?? '—'}
                                </button>
                              ) : (
                                <span className="text-[11.5px] text-faint">
                                  {contact.company ?? 'no company'}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {contact.kind ? (
                                <Badge tone="outline" size="sm">
                                  {contact.kind}
                                </Badge>
                              ) : (
                                <span className="text-[11px] text-faint">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                                {contact.email ? (
                                  <a
                                    href={`mailto:${contact.email}`}
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                  >
                                    <Mail className="size-3" /> {contact.email}
                                  </a>
                                ) : null}
                                {contact.phone ? (
                                  <a
                                    href={`tel:${contact.phone}`}
                                    className="inline-flex items-center gap-1 hover:text-foreground"
                                  >
                                    <Phone className="size-3" /> {contact.phone}
                                  </a>
                                ) : null}
                                {!contact.email && !contact.phone ? (
                                  <span className="text-faint">no details</span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {(contact.tags ?? []).slice(0, 3).map((value) => (
                                  <Badge key={value} tone="neutral" size="sm">
                                    {value}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-[11px] text-faint">
                                  {relativeTime(contact.updated_at)}
                                </span>
                                <IconButton
                                  label={`Edit ${contact.name}`}
                                  size="icon-sm"
                                  onClick={() => {
                                    setSelected(contact.id)
                                    setEditing(contact)
                                    setDialog(true)
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                </IconButton>
                                <IconButton
                                  label={`Delete ${contact.name}`}
                                  size="icon-sm"
                                  onClick={() => setDeleting(contact)}
                                >
                                  <Trash2 className="size-3.5" />
                                </IconButton>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="px-2 py-4 text-xs text-muted-foreground">
                    Nobody matches these filters.
                  </p>
                )}
                <div className="pt-2">
                  <LoadMore
                    loaded={data.items.length}
                    total={data.total}
                    loading={contacts.loading}
                    size={PAGE}
                    onMore={() => setPages((prev) => prev + 1)}
                    onReset={() => {
                      setPages(1)
                      contacts.reload()
                    }}
                  />
                </div>
              </Panel>
            )}
          </ResourceState>

          {current ? (
            <ContactDetail contact={current} onClose={() => setSelected(null)} />
          ) : offPage ? (
            fetched.error ? (
              <ErrorBlock
                error={fetched.error}
                onRetry={fetched.reload}
                title="That contact is no longer in this workspace"
              />
            ) : (
              <LoadingBlock rows={2} label="Loading contact…" />
            )
          ) : null}
        </TabsContent>

        <TabsContent value="companies" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Companies are shared by contacts; deleting one leaves its people without a company.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingCompany(null)
                setCompanyDialog(true)
              }}
            >
              <Plus /> New company
            </Button>
          </div>

          {companies.error && !companies.data ? (
            <ErrorBlock error={companies.error} onRetry={companies.reload} />
          ) : !companies.data ? (
            <LoadingBlock rows={4} label="Loading companies…" />
          ) : companies.data.items.length ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {companies.data.items.map((company) => (
                <Panel key={company.id} dense title={company.name}>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {company.industry ? <Badge tone="outline" size="sm">{company.industry}</Badge> : null}
                      {company.location ? (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" /> {company.location}
                        </span>
                      ) : null}
                      <span className="os-num ml-auto">{countLabel(company.contact_count, 'contact', 'contacts')}</span>
                    </div>
                    {company.notes ? (
                      <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                        {company.notes}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {company.website ? (
                        <a
                          href={company.website}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[11px] text-muted-foreground hover:border-line-strong hover:text-foreground"
                        >
                          Website
                        </a>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCompanyId(company.id)
                          setTerm('')
                        }}
                      >
                        Show people
                      </Button>
                      <IconButton
                        label={`Edit ${company.name}`}
                        size="icon-sm"
                        onClick={() => {
                          setEditingCompany(company)
                          setCompanyDialog(true)
                        }}
                      >
                        <Pencil className="size-3.5" />
                      </IconButton>
                      <IconButton
                        label={`Delete ${company.name}`}
                        size="icon-sm"
                        onClick={() => setDeletingCompany(company)}
                      >
                        <Trash2 className="size-3.5" />
                      </IconButton>
                    </div>
                  </div>
                </Panel>
              ))}
            </div>
          ) : (
            <EmptyBlock
              title="No companies yet"
              description="Add a company, then attach contacts to it instead of retyping the name."
              icon={<Building2 className="size-5" />}
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingCompany(null)
                    setCompanyDialog(true)
                  }}
                >
                  <Plus /> New company
                </Button>
              }
            />
          )}
        </TabsContent>
      </Tabs>

      <p className="text-[11px] text-faint">
        Leads, proposals and invoices are Phase 2 — see{' '}
        <Link href="/os/roadmap#crm" className="text-primary underline-offset-2 hover:underline">
          the roadmap
        </Link>
        . Notes can already be related to a person from the note editor.
      </p>

      <ContactDialog
        open={dialog}
        onOpenChange={(next) => {
          setDialog(next)
          if (!next) setEditing(null)
        }}
        contact={editing}
        defaults={editing ? undefined : { company_id: companyId }}
        onSaved={(contact, created) =>
          toastSuccess(created ? 'Contact created' : 'Contact saved', { description: contact.name })
        }
      />

      <CompanyDialog
        open={companyDialog}
        onOpenChange={(next) => {
          setCompanyDialog(next)
          if (!next) setEditingCompany(null)
        }}
        company={editingCompany}
        onSaved={(company, created) => {
          companies.reload()
          toastSuccess(created ? 'Company created' : 'Company saved', { description: company.name })
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete ${deleting?.name ?? 'contact'}`}
        description="Notes and tasks that pointed at this person keep their text but lose the link."
        confirmLabel="Delete contact"
        onConfirm={() =>
          api(`/contacts/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            if (selected === deleting?.id) setSelected(null)
            invalidate(...PEOPLE_SCOPE)
            toastSuccess('Contact deleted')
          })
        }
      />

      <ConfirmDialog
        open={!!deletingCompany}
        onOpenChange={(next) => (next ? undefined : setDeletingCompany(null))}
        title={`Delete ${deletingCompany?.name ?? 'company'}`}
        description={
          deletingCompany?.contact_count
            ? `${deletingCompany.contact_count} contact${deletingCompany.contact_count === 1 ? '' : 's'} will lose their company.`
            : 'This company has no contacts attached.'
        }
        confirmLabel="Delete company"
        onConfirm={() =>
          api(`/companies/${deletingCompany?.id}`, { method: 'DELETE' }).then(() => {
            if (companyId === deletingCompany?.id) setCompanyId(null)
            invalidate(...PEOPLE_SCOPE)
            toastSuccess('Company deleted')
          })
        }
      />
    </div>
  )
}

/** Small read-through of one contact so the table has a detail view. */
function ContactDetail({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  return (
    <Panel
      dense
      title={contact.name}
      description={contact.title ?? undefined}
      action={
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-2 text-[11.5px] sm:grid-cols-2">
        <Field label="Email" value={contact.email} />
        <Field label="Phone" value={contact.phone} />
        <Field label="Company" value={contact.company} />
        <Field label="Location" value={contact.location} />
        <Field label="Kind" value={contact.kind} />
        <Field label="Updated" value={relativeTime(contact.updated_at)} />
      </div>
      {contact.notes ? (
        <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
          {contact.notes}
        </p>
      ) : null}
    </Panel>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="os-eyebrow">{label}</p>
      <p className="mt-0.5 truncate text-foreground" title={value ?? undefined}>
        {value || '—'}
      </p>
    </div>
  )
}
