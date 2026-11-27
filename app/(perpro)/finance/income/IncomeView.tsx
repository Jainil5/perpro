'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Calculator as CalculatorIcon, Plus, Save, Trash2 } from 'lucide-react'

import { AmountField, CurrencySelect, MoneyCell, MoneyHero } from '@/components/os/finance'
import { Panel } from '@/components/os/ui/card'
import { Button, IconButton, buttonVariants } from '@/components/os/ui/button'
import { Field } from '@/components/os/ui/label'
import { Input } from '@/components/os/ui/input'
import { Checkbox } from '@/components/os/ui/checkbox'
import { EnumSelect } from '@/components/os/pickers'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/os/ui/tabs'
import { HairlineBar } from '@/components/os/marks'
import { EmptyBlock, LoadingBlock, ResourceState } from '@/components/os/states'
import { ConfirmDialog } from '@/components/os/dialogs/ConfirmDialog'
import { toastSuccess } from '@/components/os/ui/toast'
import { api, errorMessage } from '@/lib/os/client'
import { invalidate, useDebounced, useEnums, useResource, useWorkspace } from '@/lib/os/hooks'
import {
  FINANCE_PATHS,
  FINANCE_SCOPE,
  type IncomeProfile,
  type IncomeProfileInput,
  type IncomeProfileKind,
  type TakeHomeInput,
  type TakeHomeResult,
  type TaxRegime,
} from '@/lib/os/finance'
import type { ListResponse } from '@/lib/os/types'
import { countLabel, enumLabel, formatDate } from '@/lib/os/format'
import { formatMoney, moneyInputError, parseMoney } from '@/lib/os/currency'
import { cn } from '@/lib/os/cn'
import IncomeLedger from './IncomeLedger'

/**
 * Income — three jobs on one screen: the calculator (gross → tax → take-home, previewed on
 * the API and never guessed in the browser), the profiles it reads its rules from, and the
 * money that actually arrived. `POST /income-profiles/preview` is side-effect free, so the
 * numbers below recompute as you type without writing anything.
 */
export default function IncomeView() {
  const params = useSearchParams()
  const pathname = usePathname()
  const workspace = useWorkspace()
  const profiles = useResource<ListResponse<IncomeProfile>>(FINANCE_PATHS.profiles)

  const focusIncome = params.get('income')
  const startingProfile = params.get('profile')
  const [tab, setTab] = useState<'calculator' | 'money-in' | 'profiles'>(
    focusIncome ? 'money-in' : startingProfile ? 'calculator' : 'calculator'
  )
  const [calcProfileId, setCalcProfileId] = useState<string | null>(startingProfile)

  const defaultCurrency = workspace.data?.currency ?? 'INR'

  function useInCalculator(id: string) {
    setCalcProfileId(id)
    setTab('calculator')
    // Re-key the calculator so it re-reads the chosen profile rather than keeping the old form.
    window.history.replaceState({}, '', `${pathname}?profile=${id}`)
  }

  return (
    <div className="os-enter space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="os-label">Finance</p>
          <h1 className="os-title">Income Calculator</h1>
          <p className="os-micro mt-2">
            Slab, flat and presumptive regimes on the numbers you keep. Tax is computed by the API in
            decimals and rounded once — this page only formats what comes back.
          </p>
        </div>
        <div className="os-micro flex shrink-0 items-center gap-3">
          <span className="text-faint">
            {profiles.data ? `${countLabel(profiles.data.total, 'profile')} saved` : 'loading…'}
          </span>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)}>
        <TabsList>
          <TabsTrigger value="calculator">
            <CalculatorIcon /> Calculator
          </TabsTrigger>
          <TabsTrigger value="money-in">Money in</TabsTrigger>
          <TabsTrigger value="profiles">
            Profiles
            {profiles.data?.total ? (
              <span className="os-mono text-[11px] text-faint">{profiles.data.total}</span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calculator">
          <CalculatorTab
            profileId={calcProfileId}
            profiles={profiles.data?.items ?? []}
            defaultCurrency={defaultCurrency}
            onSaved={() => {
              invalidate(...FINANCE_SCOPE)
              profiles.reload()
            }}
          />
        </TabsContent>

        <TabsContent value="money-in">
          <IncomeLedger
            focusId={focusIncome}
            defaultCurrency={defaultCurrency}
            onChanged={() => {
              invalidate(...FINANCE_SCOPE)
              profiles.reload()
            }}
          />
        </TabsContent>

        <TabsContent value="profiles">
          <ProfileTab
            resource={profiles}
            onUse={useInCalculator}
            onChanged={() => {
              invalidate(...FINANCE_SCOPE)
              profiles.reload()
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ----------------------------------------------------------------- tabs ----- */

interface CalcForm {
  name: string
  kind: IncomeProfileKind
  gross: string
  period: 'monthly' | 'annual'
  currency: string
  regime: TaxRegime
  rate: string
  other: string
  slabs: Array<{ up_to: string; rate: string }>
  deductions: Array<{ label: string; amount: string; pre_tax: boolean }>
  notes: string
}

const EMPTY_CALC: CalcForm = {
  name: '',
  kind: 'salary',
  gross: '',
  period: 'monthly',
  currency: 'INR',
  regime: 'slab',
  rate: '',
  other: '',
  slabs: [
    { up_to: '', rate: '0' },
    { up_to: '', rate: '20' },
  ],
  deductions: [],
  notes: '',
}

function fromProfile(profile: IncomeProfile): CalcForm {
  return {
    name: profile.name,
    kind: profile.kind,
    gross: profile.gross_monthly === null ? '' : String(profile.gross_monthly),
    period: 'monthly',
    currency: profile.currency,
    regime: profile.tax_regime,
    rate: profile.tax_rate === null ? '' : String(profile.tax_rate),
    other: '',
    slabs: (profile.slabs ?? []).map((slab) => ({
      up_to: slab.up_to === null ? '' : String(slab.up_to),
      rate: String(slab.rate),
    })),
    deductions: [],
    notes: profile.notes ?? '',
  }
}

function CalculatorTab({
  profileId,
  profiles,
  defaultCurrency,
  onSaved,
}: {
  profileId: string | null
  profiles: IncomeProfile[]
  defaultCurrency: string
  onSaved: () => void
}) {
  const { enums } = useEnums()
  const regimes = enums.tax_regime ?? ['none', 'flat', 'slab', 'presumptive']
  const kinds = enums.income_kind ?? ['salary', 'freelance', 'contract', 'business', 'mixed']

  const [form, setForm] = useState<CalcForm>(() => {
    const chosen = profiles.find((profile) => profile.id === profileId)
    return chosen
      ? fromProfile(chosen)
      : { ...EMPTY_CALC, currency: defaultCurrency, slabs: [{ up_to: '', rate: '0' }] }
  })
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [result, setResult] = useState<TakeHomeResult | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(profileId)

  // Loading a profile into the form is deliberate, not automatic: the URL is the only
  // external signal, and it is read once per `profileId`.
  useEffect(() => {
    if (!profileId) return
    const chosen = profiles.find((profile) => profile.id === profileId)
    if (!chosen) return
    setForm(fromProfile(chosen))
    setSavedId(chosen.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, profiles.length])

  const patch = (next: Partial<CalcForm>) => setForm((prev) => ({ ...prev, ...next }))

  const errors = useMemo(() => {
    const next: Record<string, string> = {}
    const gross = moneyInputError(form.gross, { required: true, min: 0 })
    if (gross) next.gross = gross
    if (!form.currency) next.currency = 'Pick the currency you are paid in'
    if (form.regime === 'slab') {
      if (!form.slabs.length) next.slabs = 'A slab regime needs at least one slab'
      form.slabs.forEach((slab, index) => {
        if (moneyInputError(slab.rate, { required: true, min: 0, max: 100 }))
          next[`slab-${index}`] = 'Rate must be a percent between 0 and 100'
      })
    }
    if (form.regime === 'flat' || form.regime === 'presumptive') {
      const rate = moneyInputError(form.rate, { required: true, min: 0, max: 100 })
      if (rate) next.rate = 'Rate must be a percent between 0 and 100'
    }
    form.deductions.forEach((deduction, index) => {
      if (!deduction.label.trim()) next[`deduction-${index}`] = 'Name the deduction'
      else if (moneyInputError(deduction.amount, { required: true, min: 0 }))
        next[`deduction-${index}`] = 'Deductions are amounts, not text'
    })
    return next
  }, [form])

  useEffect(() => setIssues(errors), [errors])

  const body: TakeHomeInput | null = useMemo(() => {
    if (Object.keys(errors).length) return null
    const gross = parseMoney(form.gross) ?? 0
    const other = form.other.trim() ? parseMoney(form.other) : null
    return {
      currency: form.currency,
      period: form.period,
      gross_monthly: form.period === 'monthly' ? gross : null,
      gross_annual: form.period === 'annual' ? gross : null,
      tax_regime: form.regime,
      tax_rate:
        form.regime === 'flat' || form.regime === 'presumptive' ? Number(form.rate) : null,
      slabs:
        form.regime === 'slab'
          ? form.slabs.map((slab, index) => ({
              up_to:
                slab.up_to.trim() === ''
                  ? index === form.slabs.length - 1
                    ? null
                    : parseMoney(slab.up_to)
                  : parseMoney(slab.up_to),
              rate: Number(slab.rate),
            }))
          : null,
      deductions: form.deductions.map((deduction) => ({
        label: deduction.label.trim(),
        amount: parseMoney(deduction.amount) ?? 0,
        pre_tax: deduction.pre_tax,
      })),
      other_income: other,
    }
  }, [form, errors])

  const signature = useDebounced(JSON.stringify(body), 400)

  useEffect(() => {
    if (!body) {
      setResult(null)
      return
    }
    let alive = true
    setCalculating(true)
    api<TakeHomeResult>(FINANCE_PATHS.profilePreview, { method: 'POST', body })
      .then((data) => {
        if (!alive) return
        setResult(data)
        setFailed(null)
      })
      .catch((e) => {
        if (!alive) return
        setResult(null)
        setFailed(errorMessage(e))
      })
      .finally(() => {
        if (alive) setCalculating(false)
      })
    return () => {
      alive = false
    }
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!body || !form.name.trim()) {
      setIssues((prev) => ({ ...prev, name: 'Give the profile a name so you can reuse it' }))
      return
    }
    setSaving(true)
    try {
      const payload: IncomeProfileInput = {
        name: form.name.trim(),
        kind: form.kind,
        gross_monthly: form.period === 'monthly' ? parseMoney(form.gross) : null,
        currency: form.currency,
        tax_regime: form.regime,
        tax_rate:
          form.regime === 'flat' || form.regime === 'presumptive' ? Number(form.rate) : null,
        slabs: body.slabs ?? null,
        deductions: body.deductions?.length ? body.deductions : null,
        notes: form.notes.trim() || null,
      }
      const saved = await api<IncomeProfile>(
        savedId ? `${FINANCE_PATHS.profiles}/${savedId}` : FINANCE_PATHS.profiles,
        { method: savedId ? 'PATCH' : 'POST', body: payload }
      )
      setSavedId(saved.id)
      toastSuccess(savedId ? 'Profile updated' : 'Profile saved', { description: saved.name })
      onSaved()
    } catch (e) {
      setFailed(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel dense title="Your numbers" description="Nothing is stored until you save a profile.">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,7rem)]">
            <Field label="Gross" htmlFor="calc-gross" required error={errors.gross ?? null}>
              <Input
                id="calc-gross"
                inputMode="decimal"
                value={form.gross}
                placeholder="85000"
                onChange={(event) => patch({ gross: event.target.value })}
                className="os-mono tabular-nums"
                aria-invalid={Boolean(errors.gross) || undefined}
              />
            </Field>
            <Field label="Per">
              <EnumSelect
                value={form.period}
                onChange={(period) => patch({ period: period as CalcForm['period'] })}
                options={['monthly', 'annual']}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <CurrencySelect
              id="calc-currency"
              value={form.currency}
              onChange={(currency) => patch({ currency })}
              required
              error={errors.currency ?? null}
            />
            <Field label="Tax regime" hint="how the API should read your tax">
              <EnumSelect
                value={form.regime}
                onChange={(regime) => patch({ regime: regime as TaxRegime })}
                options={regimes}
              />
            </Field>
          </div>

          {form.regime === 'flat' || form.regime === 'presumptive' ? (
            <Field
              label="Rate"
              htmlFor="calc-rate"
              required
              error={errors.rate ?? null}
              hint={
                form.regime === 'presumptive'
                  ? 'presumptive applies to gross, not to the taxable base'
                  : 'flat applies to the taxable base after pre-tax deductions'
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  id="calc-rate"
                  inputMode="decimal"
                  value={form.rate}
                  placeholder="30"
                  onChange={(event) => patch({ rate: event.target.value })}
                  className="os-mono w-28 tabular-nums"
                />
                <span className="os-micro">percent</span>
              </div>
            </Field>
          ) : null}

          {form.regime === 'slab' ? (
            <div className="os-panel min-w-0 px-3 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="os-label">Slabs</p>
                <p className="os-micro">
                  leave the last “up to” empty for everything above it
                </p>
              </div>
              <ul className="mt-2 min-w-0 space-y-1.5">
                {form.slabs.map((slab, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <span className="os-micro w-16 shrink-0">up to</span>
                    <Input
                      aria-label={`Upper bound of slab ${index + 1}`}
                      inputMode="decimal"
                      value={slab.up_to}
                      onChange={(event) =>
                        patch({
                          slabs: form.slabs.map((row, i) =>
                            i === index ? { ...row, up_to: event.target.value } : row
                          ),
                        })
                      }
                      className="os-mono flex-1 tabular-nums"
                    />
                    <span className="os-micro w-10 shrink-0 text-right">@</span>
                    <Input
                      aria-label={`Rate of slab ${index + 1}`}
                      inputMode="decimal"
                      value={slab.rate}
                      onChange={(event) =>
                        patch({
                          slabs: form.slabs.map((row, i) =>
                            i === index ? { ...row, rate: event.target.value } : row
                          ),
                        })
                      }
                      className="os-mono w-20 tabular-nums"
                    />
                    <IconButton
                      label={`Remove slab ${index + 1}`}
                      size="icon-sm"
                      onClick={() => patch({ slabs: form.slabs.filter((_, i) => i !== index) })}
                    >
                      <Trash2 className="size-3.5" />
                    </IconButton>
                  </li>
                ))}
              </ul>
              {errors.slabs ? <p className="mt-2 text-[11px] text-danger">{errors.slabs}</p> : null}
              <button
                type="button"
                onClick={() => patch({ slabs: [...form.slabs, { up_to: '', rate: '0' }] })}
                className="os-tap-none mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
              >
                <Plus className="size-3" /> add a slab
              </button>
            </div>
          ) : null}

          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="os-label">Deductions</p>
              <p className="os-micro">pre-tax lowers the taxable base, post-tax only the net</p>
            </div>
            <ul className="mt-2 min-w-0 space-y-1.5">
              {form.deductions.map((deduction, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={`Deduction ${index + 1} name`}
                    value={deduction.label}
                    placeholder="Provident fund"
                    onChange={(event) =>
                      patch({
                        deductions: form.deductions.map((row, i) =>
                          i === index ? { ...row, label: event.target.value } : row
                        ),
                      })
                    }
                    className="min-w-0 flex-1"
                  />
                  <Input
                    aria-label={`Deduction ${index + 1} amount`}
                    inputMode="decimal"
                    value={deduction.amount}
                    onChange={(event) =>
                      patch({
                        deductions: form.deductions.map((row, i) =>
                          i === index ? { ...row, amount: event.target.value } : row
                        ),
                      })
                    }
                    className="os-mono w-28 tabular-nums"
                  />
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px]">
                    <Checkbox
                      checked={deduction.pre_tax}
                      onCheckedChange={(next) =>
                        patch({
                          deductions: form.deductions.map((row, i) =>
                            i === index ? { ...row, pre_tax: next === true } : row
                          ),
                        })
                      }
                    />
                    pre-tax
                  </label>
                  <IconButton
                    label={`Remove deduction ${index + 1}`}
                    size="icon-sm"
                    onClick={() =>
                      patch({ deductions: form.deductions.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                patch({ deductions: [...form.deductions, { label: '', amount: '', pre_tax: true }] })
              }
              className="os-tap-none mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground underline underline-offset-2 transition-colors duration-150 hover:text-foreground"
            >
              <Plus className="size-3" /> add a deduction
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <AmountField
              label="Other income"
              id="calc-other"
              value={form.other}
              onChange={(other) => patch({ other })}
              currency={form.currency}
              hint="rent, dividends — added after tax unless you say otherwise"
            />
            <Field label="Profile name" htmlFor="calc-name" error={issues.name ?? errors.name ?? null}>
              <Input
                id="calc-name"
                value={form.name}
                placeholder="Job at Acme"
                onChange={(event) => patch({ name: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="Kind">
              <EnumSelect
                value={form.kind}
                onChange={(kind) => patch({ kind: kind as IncomeProfileKind })}
                options={kinds}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Button variant="outline" className="bg-transparent" onClick={() => void save()} loading={saving}>
                <Save /> {savedId ? 'Update profile' : 'Save as profile'}
              </Button>
            </div>
          </div>

          {failed ? (
            <p role="alert" className="text-xs text-danger">
              {failed}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel
        dense
        title="Take-home"
        description={
          calculating
            ? 'recalculating on the API…'
            : body
              ? 'derived by POST /income-profiles/preview'
              : 'fix the highlighted fields to see the answer'
        }
      >
        {!body ? (
          <p className="os-micro">
            {Object.keys(errors)[0]
              ? `Waiting on a valid ${Object.keys(errors)[0]}.`
              : 'Enter a gross amount.'}
          </p>
        ) : !result ? (
          <LoadingBlock rows={5} />
        ) : (
          <Result result={result} />
        )}
      </Panel>
    </div>
  )
}

function Result({ result }: { result: TakeHomeResult }) {
  const currency = result.currency
  const netShare = result.gross === 0 ? 0 : (result.net / result.gross) * 100
  return (
    <div className="min-w-0 space-y-4">
      <MoneyHero
        label="Monthly take-home"
        value={result.net_monthly}
        currency={currency}
        hint={
          <span className="text-muted-foreground">
            {formatMoney(result.net_annual, currency, { compact: true })} a year
          </span>
        }
      />
      <div>
        <div className="os-micro flex items-baseline justify-between">
          <span>what the gross becomes</span>
          <span className="os-mono">
            {result.effective_tax_rate === null
              ? '— effective'
              : `${result.effective_tax_rate.toFixed(1)}% effective`}
          </span>
        </div>
        <HairlineBar
          className="mt-1.5"
          value={netShare}
          label={`Net ${formatMoney(result.net, currency)} of ${formatMoney(result.gross, currency)} gross`}
        />
      </div>

      <dl className="os-panel min-w-0 divide-y divide-line-faint px-3">
        <Row label="Gross" value={formatMoney(result.gross, currency)} />
        <Row label="Taxable base" value={formatMoney(result.taxable, currency)} />
        <Row
          label="Deductions"
          value={formatMoney(result.deductions_total, currency, { sign: 'never' })}
          muted
        />
        <Row
          label="Tax"
          value={formatMoney(result.tax, currency, { sign: 'never' })}
          tone="text-warning"
        />
        <Row label="Net" value={formatMoney(result.net, currency)} strong />
      </dl>

      {result.slab_breakdown.length ? (
        <div className="min-w-0">
          <p className="os-label mb-1.5">Slab by slab</p>
          <table className="w-full min-w-0">
            <thead>
              <tr className="os-label border-b border-line-faint text-left">
                <th className="pb-1 font-medium">From</th>
                <th className="pb-1 text-right font-medium">To</th>
                <th className="pb-1 text-right font-medium">Rate</th>
                <th className="pb-1 text-right font-medium">Tax</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-faint">
              {result.slab_breakdown.map((slab, index) => (
                <tr key={index}>
                  <td className="os-mono py-1 text-[12px] tabular-nums">
                    {formatMoney(slab.from, currency, { sign: 'never' })}
                  </td>
                  <td className="os-mono py-1 text-right text-[12px] tabular-nums">
                    {slab.to === null ? 'above' : formatMoney(slab.to, currency, { sign: 'never' })}
                  </td>
                  <td className="os-mono py-1 text-right text-[12px] tabular-nums">
                    {slab.rate}%
                  </td>
                  <td className="py-1 text-right">
                    <MoneyCell value={slab.amount} currency={currency} sign="never" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {result.warnings.length ? (
        <ul className="min-w-0 space-y-1 border-t border-line-faint pt-3">
          {result.warnings.map((warning) => (
            <li key={warning} className="os-micro text-warning">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function Row({
  label,
  value,
  muted,
  strong,
  tone,
}: {
  label: string
  value: string
  muted?: boolean
  strong?: boolean
  tone?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className={cn('os-label', muted ? 'text-muted-foreground' : null)}>{label}</dt>
      <dd
        className={cn(
          'os-mono text-[13px] tabular-nums',
          tone ?? (strong ? 'text-foreground' : muted ? 'text-muted-foreground' : 'text-foreground')
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/* ---------------------------------------------------------------- profiles -- */

function ProfileTab({
  resource,
  onUse,
  onChanged,
}: {
  resource: ReturnType<typeof useResource<ListResponse<IncomeProfile>>>
  onUse: (id: string) => void
  onChanged: () => void
}) {
  const [deleting, setDeleting] = useState<IncomeProfile | null>(null)

  return (
    <Panel
      dense
      title="Saved profiles"
      description="A profile stores the rules you entered — the tax and net figures are recomputed from them every time, so they can never go stale."
      bodyClassName="px-0 py-0"
    >
      <ResourceState
        resource={resource}
        skeleton={<LoadingBlock rows={4} />}
        empty={
          <div className="px-3 py-3">
            <EmptyBlock
              title="No income profiles yet"
              description="Work an example out on the Calculator tab, then press “Save as profile”. Cost scenarios can then borrow those rules."
              icon={<CalculatorIcon className="size-5" />}
            />
          </div>
        }
      >
        {(data) =>
          data.items.length === 0 ? (
            <div className="px-3 py-3">
              <EmptyBlock
                title="No income profiles yet"
                description="Work an example out on the Calculator tab, then press “Save as profile”."
                icon={<CalculatorIcon className="size-5" />}
              />
            </div>
          ) : (
            <ProfileList
              rows={data.items}
              onDelete={setDeleting}
              onUse={onUse}
            />
          )
        }
      </ResourceState>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(next) => (next ? undefined : setDeleting(null))}
        title={`Delete “${deleting?.name ?? 'profile'}”`}
        description="Scenarios that used this profile keep their own items and simply lose the link."
        confirmLabel="Delete profile"
        onConfirm={() =>
          api(`${FINANCE_PATHS.profiles}/${deleting?.id}`, { method: 'DELETE' }).then(() => {
            toastSuccess('Profile deleted')
            onChanged()
          })
        }
      />
    </Panel>
  )
}

function ProfileList({
  rows,
  onUse,
  onDelete,
}: {
  rows: IncomeProfile[]
  onUse: (id: string) => void
  onDelete: (profile: IncomeProfile) => void
}) {
  return (
    <ul className="min-w-0 divide-y divide-line-faint">
      {rows.map((profile) => (
        <li key={profile.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-foreground">{profile.name}</span>
            <span className="os-micro block">
              {enumLabel(profile.kind)} · {enumLabel(profile.tax_regime)}
              {profile.tax_rate !== null ? ` ${profile.tax_rate}%` : ''} · entered{' '}
              {formatDate(profile.created_at)}
            </span>
          </span>
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="os-micro">gross</span>
            <MoneyCell value={profile.gross_monthly} currency={profile.currency} sign="never" />
          </span>
          <span className="flex shrink-0 items-baseline gap-2">
            <span className="os-micro">net / mo</span>
            <MoneyCell value={profile.monthly_net ?? null} currency={profile.currency} sign="never" />
          </span>
          <span className="os-mono shrink-0 text-[12px] tabular-nums text-muted-foreground">
            {profile.effective_tax_rate === null || profile.effective_tax_rate === undefined
              ? '—'
              : `${profile.effective_tax_rate.toFixed(1)}%`}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onUse(profile.id)}
              className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'bg-transparent')}
            >
              Open in calculator
            </button>
            <IconButton label={`Delete ${profile.name}`} size="icon-sm" onClick={() => onDelete(profile)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </span>
        </li>
      ))}
    </ul>
  )
}
