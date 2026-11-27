'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Pencil, Trash2 } from 'lucide-react'

import { cn } from '@/lib/os/cn'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useResource } from '@/lib/os/hooks'
import {
  CLIENT_HEALTH,
  CLIENT_STAGES,
  CRM_SCOPE,
  clientPath,
  type ClientDetail as ClientRow,
  type ClientHealth,
  type ClientIncome,
  type ClientStage,
} from '@/lib/os/crm'
import { formatMoney } from '@/lib/os/currency'
import {
  countLabel,
  enumLabel,
  formatDate,
  plural,
} from '@/lib/os/format'
import { LoadingBlock, ResourceState, SoftError } from '@/components/os/states'
import { Button } from '@/components/os/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/os/ui/dialog'
import { HairlineBar, MicroData } from '@/components/os/marks'
import { TallyFigures } from '@/components/os/pipeline'
import { MeetingLine, MeetingDialog } from '@/components/os/meetings'
import { toastError, toastSuccess } from '@/components/os/ui/toast'

/**
 * One account, opened: what it pays, what it owes, when the contract moves, who is next to talk to.
 *
 * The three embeds are the API's windows, not a scroll — `subscriptions` are everything live as of
 * today, `income` is the 12 most recent ledger rows while lifetime value and receivables cover the
 * whole ledger, and `meetings` is the next 10. Each section says which window it is reading, so a
 * short list is never mistaken for the whole account.
 */
export function ClientDetail({
  id,
  currency,
  open,
  onOpenChange,
  onEdit,
  onRequestDelete,
}: {
  id: string | null
  currency: string
  open: boolean
  onOpenChange: (next: boolean) => void
  onEdit: (row: ClientRow) => void
  onRequestDelete: (row: ClientRow) => void
}) {
  const detail = useResource<ClientRow>(id ? clientPath(id) : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [meetingForm, setMeetingForm] = useState(false)

  useEffect(() => {
    if (!open) return
    setBusy(null)
    setMeetingForm(false)
    detail.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id])

  async function patch(body: { stage?: ClientStage; health?: ClientHealth }, label: string) {
    if (!id) return
    const key = `${Object.keys(body)[0]}:${Object.values(body)[0]}`
    setBusy(key)
    try {
      await patchClient(id, body)
      invalidate(...CRM_SCOPE)
      toastSuccess(label)
      detail.reload()
    } catch (error) {
      toastError('The API refused that', { description: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  const row = detail.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={row ? row.name || 'Untitled account' : 'Account'}
          description={
            row
              ? `${enumLabel(row.stage)} · ${plural(row.subscriptions?.length ?? 0, 'live subscription')}${
                  row.contract_end ? ` · contract ${formatDate(row.contract_end)}` : ' · no contract dates'
                }`
              : 'Reading the row…'
          }
        />
        <DialogBody className="space-y-4">
          {id === null ? null : (
            <ResourceState
              resource={detail}
              skeleton={<LoadingBlock rows={6} label="Loading this account…" />}
            >
              {(data) => {
                const mrrCurrency = data.currency ?? currency
                return (
                  <div className="space-y-4">
                    {/* ---- the two states an account is judged by ---- */}
                    <section className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <div className="min-w-0">
                          <p className="os-label">Stage</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {CLIENT_STAGES.map((stage) => (
                              <Chip
                                key={stage}
                                active={data.stage === stage}
                                busy={busy === `stage:${stage}`}
                                onClick={() =>
                                  void patch({ stage }, `${data.name || 'Account'} → ${enumLabel(stage)}`)
                                }
                              >
                                {enumLabel(stage)}
                              </Chip>
                            ))}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="os-label">Health</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {CLIENT_HEALTH.map((health) => (
                              <Chip
                                key={health}
                                active={data.health === health}
                                busy={busy === `health:${health}`}
                                tone={health}
                                onClick={() =>
                                  void patch({ health }, `Health: ${enumLabel(health)}`)
                                }
                              >
                                {enumLabel(health)}
                              </Chip>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="os-micro text-faint">
                        both are plain fields, not a state machine — changing one is a PATCH, and it
                        is written down as activity
                      </p>
                    </section>

                    {/* ---- the money ---- */}
                    <section className="min-w-0 space-y-3 border-t border-line pt-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="os-label">Revenue</p>
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/finance/subscriptions?client_id=${data.id}`}
                            className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                          >
                            subscriptions <ArrowUpRight className="size-3" />
                          </Link>
                          <Link
                            href={`/finance/income?client_id=${data.id}`}
                            className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                          >
                            income <ArrowUpRight className="size-3" />
                          </Link>
                        </div>
                      </div>
                      <div className="grid min-w-0 gap-x-8 gap-y-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <p className="os-label">Monthly, derived from live subscriptions</p>
                          {data.mrr !== null && data.mrr !== undefined ? (
                            <p className="os-mono mt-1 text-[20px] leading-none tabular-nums text-foreground">
                              {formatMoney(data.mrr, mrrCurrency)}
                              <span className="os-micro ml-1 text-faint">/mo</span>
                            </p>
                          ) : data.mrr_by_currency?.length ? (
                            <TallyFigures entries={data.mrr_by_currency} />
                          ) : (
                            <p className="os-micro mt-1">
                              No live subscription to derive it from — add one under Money.
                            </p>
                          )}
                          {data.mrr_recorded !== null &&
                          data.mrr_recorded !== undefined &&
                          data.mrr_recorded !== data.mrr ? (
                            <p className="os-micro mt-1 text-warning">
                              the column says {formatMoney(data.mrr_recorded, mrrCurrency)} — recorded
                              by hand, never written by the API; the derived figure above is what
                              every screen uses
                            </p>
                          ) : null}
                        </div>
                        <div className="min-w-0 space-y-2">
                          <div>
                            <p className="os-label">Lifetime, by currency</p>
                            <TallyFigures
                              entries={data.lifetime_value}
                              emptyLabel="Nothing received yet."
                            />
                          </div>
                          <div className="border-t border-line-faint pt-1.5">
                            <p className="os-label">Open receivables</p>
                            <TallyFigures
                              entries={data.open_receivables}
                              emptyLabel="Nothing outstanding."
                            />
                          </div>
                        </div>
                      </div>
                      <SoftError error={detail.error} />
                    </section>

                    {/* ---- the contract clock ---- */}
                    <section className="min-w-0 space-y-2 border-t border-line pt-3">
                      <p className="os-label">Contract</p>
                      <MicroData
                        items={[
                          data.contract_start ? `from ${formatDate(data.contract_start)}` : null,
                          data.contract_end ? `to ${formatDate(data.contract_end)}` : 'no end date',
                          data.renewal_reminder_days === null || data.renewal_reminder_days === undefined
                            ? 'no reminder set'
                            : `warns ${data.renewal_reminder_days} days ahead`,
                          data.days_to_contract_end !== null && data.days_to_contract_end !== undefined
                            ? `${data.days_to_contract_end} days left`
                            : null,
                        ]}
                      />
                      {data.contract_end ? (
                        <RenewalBar row={data} />
                      ) : (
                        <p className="os-micro text-faint">
                          An undated contract never renews and never warns you. Set the end date when
                          you know it.
                        </p>
                      )}
                    </section>

                    {/* ---- what is actually running ---- */}
                    <section className="min-w-0 space-y-2 border-t border-line pt-3">
                      <p className="os-label">
                        Subscriptions live as of today{' '}
                        {data.subscriptions?.length ? `(${countLabel(data.subscriptions.length, 'row')})` : ''}
                      </p>
                      {data.subscriptions?.length ? (
                        <ul className="min-w-0 divide-y divide-line">
                          {data.subscriptions.map((sub) => (
                            <li key={sub.id} className="min-w-0 py-1.5">
                              <div className="flex items-baseline justify-between gap-3">
                                <span className="min-w-0 truncate text-[13px] text-foreground">
                                  {sub.label ?? sub.invoice_number ?? 'Subscription'}
                                </span>
                                <span className="os-mono shrink-0 text-[12px] tabular-nums text-muted-foreground">
                                  {formatMoney(sub.price, sub.currency ?? mrrCurrency)}
                                  <span className="os-micro ml-1">{sub.interval ?? ''}</span>
                                </span>
                              </div>
                              <MicroData
                                items={[
                                  enumLabel(sub.status),
                                  sub.monthly_cost !== null && sub.monthly_cost !== undefined
                                    ? `${formatMoney(sub.monthly_cost, sub.currency ?? mrrCurrency)}/mo`
                                    : null,
                                  sub.renews_on ? `renews ${formatDate(sub.renews_on)}` : null,
                                ]}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="os-micro text-faint">
                          Nothing running. This account's revenue is one-off income, or none yet.
                        </p>
                      )}
                    </section>

                    {/* ---- the last 12 rows the ledger has for it ---- */}
                    <section className="min-w-0 space-y-2 border-t border-line pt-3">
                      <p className="os-label">
                        Recent income{' '}
                        <span className="text-faint">
                          · the 12 newest rows, any status; lifetime value covers the whole ledger
                        </span>
                      </p>
                      {data.income?.length ? (
                        <ul className="os-scroll-x min-w-0 divide-y divide-line">
                          {data.income.map((item: ClientIncome) => (
                            <li key={item.id} className="flex items-baseline justify-between gap-3 py-1.5">
                              <span className="min-w-0 truncate text-[13px] text-foreground">
                                {item.label}
                              </span>
                              <span className="os-mono shrink-0 text-[12px] tabular-nums text-muted-foreground">
                                {formatMoney(item.amount, item.currency)}
                              </span>
                              <span className="os-micro w-[6.5rem] shrink-0 text-right">
                                {formatDate(item.received_on)} · {enumLabel(item.status)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="os-micro text-faint">
                          No income rows named this account yet — the ledger's account field is what
                          puts them here.
                        </p>
                      )}
                    </section>

                    {/* ---- the diary ---- */}
                    <section className="min-w-0 space-y-2 border-t border-line pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="os-label">
                          Meetings ahead{' '}
                          {data.meetings?.length ? `(${data.meetings.length})` : ''}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => setMeetingForm(true)}>
                          Book a meeting
                        </Button>
                      </div>
                      {data.meetings?.length ? (
                        <ul className="min-w-0 divide-y divide-line">
                          {data.meetings.map((meeting) => (
                            <MeetingLine
                              key={meeting.id}
                              meeting={meeting}
                              onChanged={() => detail.reload()}
                            />
                          ))}
                        </ul>
                      ) : (
                        <p className="os-micro text-faint">
                          Nothing booked. The next 10 upcoming meetings show here once they are.
                        </p>
                      )}
                    </section>

                    {/* ---- the people and the paper ---- */}
                    <section className="min-w-0 space-y-2 border-t border-line pt-3">
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        {data.contact ? (
                          <Link
                            href={`/contacts?contact=${data.contact.id}`}
                            className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                          >
                            person: {data.contact.name}
                            <ArrowUpRight className="size-3" />
                          </Link>
                        ) : null}
                        {data.company ? (
                          <Link
                            href={`/contacts?company=${data.company.id}`}
                            className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                          >
                            company: {data.company.name}
                            <ArrowUpRight className="size-3" />
                          </Link>
                        ) : null}
                        <Link
                          href="/crm"
                          className="os-micro inline-flex items-center gap-1 underline underline-offset-2"
                        >
                          the lead this came from
                          <ArrowUpRight className="size-3" />
                        </Link>
                      </div>
                      {data.tags?.length ? (
                        <p className="os-micro">
                          {data.tags.map((tag) => (
                            <Link
                              key={tag}
                              href={`/customers?tag=${encodeURIComponent(tag)}`}
                              className="mr-1.5 inline-block rounded-os border border-line px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-line-strong hover:text-foreground"
                            >
                              {tag}
                            </Link>
                          ))}
                        </p>
                      ) : null}
                      {data.notes ? (
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                          {data.notes}
                        </p>
                      ) : null}
                    </section>
                  </div>
                )
              }}
            </ResourceState>
          )}
        </DialogBody>
        <DialogFooter>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => row && onEdit(row)} disabled={!row}>
              <Pencil /> Edit
            </Button>
            <Button variant="ghost" onClick={() => row && onRequestDelete(row)} disabled={!row}>
              <Trash2 /> Delete
            </Button>
          </div>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>

      {row ? (
        <MeetingDialog
          open={meetingForm}
          onOpenChange={setMeetingForm}
          entity={{ type: 'client', id: row.id, label: row.name || 'the account' }}
          defaultTitle={`Review with ${row.name || 'the account'}`}
          onSaved={() => detail.reload()}
        />
      ) : null}
    </Dialog>
  )
}

/**
 * `PATCH /clients/{id}` — stage and health are ordinary fields, so there is no action endpoint
 * behind them and no state machine to refuse the move.
 */
function patchClient(id: string, body: { stage?: ClientStage; health?: ClientHealth }) {
  return api<ClientRow>(clientPath(id), { method: 'PATCH', body })
}

/* -------------------------------------------------------------------- pieces -- */

/** A client state, clicked. Colour appears only on health, which is a judgement, not a category. */
function Chip({
  active,
  busy,
  tone,
  onClick,
  children,
}: {
  active: boolean
  busy?: boolean
  tone?: string
  onClick: () => void
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'red' ? 'hover:border-danger' : tone === 'amber' ? 'hover:border-warning' : tone === 'green' ? 'hover:border-success' : ''
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={active}
      className={cn(
        'os-tap-none inline-flex min-h-[28px] items-center rounded-os border px-2 text-[12px] transition-colors',
        active
          ? 'border-foreground text-foreground'
          : cn('border-line text-muted-foreground', toneClass || 'hover:border-line-strong'),
        busy && 'opacity-60'
      )}
    >
      {children}
    </button>
  )
}

/**
 * The renewal countdown, drawn as one hairline: the track is the contract, the ink is what has
 * elapsed, and the warning window is the part that has to be readable before it is too late.
 */
function RenewalBar({ row }: { row: ClientRow }) {
  const end = row.contract_end ? new Date(row.contract_end).getTime() : null
  const start = row.contract_start ? new Date(row.contract_start).getTime() : null
  const today = new Date().getTime()
  if (!end) return null
  const span = start ? Math.max(1, end - start) : 180 * 86_400_000
  const elapsed = start ? Math.min(100, Math.max(0, ((today - start) / span) * 100)) : null
  const reminder = row.renewal_reminder_days ?? 30
  const warnFrom = Math.max(0, 100 - (reminder / span) * 100)
  const inWindow =
    row.renewal_in_days !== null && row.renewal_in_days !== undefined && row.renewal_in_days <= 0
  const past = (row.days_to_contract_end ?? 1) <= 0
  return (
    <div className="min-w-0 space-y-1">
      <HairlineBar
        value={elapsed ?? 100}
        label="Contract elapsed"
        title={
          elapsed === null
            ? 'No start date, so the bar shows the warning window only'
            : `${Math.round(elapsed)}% of the contract elapsed`
        }
      />
      <p
        className={cn(
          'os-micro',
          past ? 'text-danger' : inWindow ? 'text-warning' : 'text-faint'
        )}
      >
        {past
          ? `ran out ${Math.abs(row.days_to_contract_end ?? 0)} days ago — renew it or mark it churned`
          : inWindow
            ? `inside the ${reminder}-day warning window · ${row.days_to_contract_end} days left`
            : `${row.days_to_contract_end} days left · warns at ${warnFrom.toFixed(0)}% of the term`}
      </p>
    </div>
  )
}


