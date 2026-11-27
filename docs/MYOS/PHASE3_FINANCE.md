# Phase 3 — Finance: the contract this build implements

This is the working contract for the Finance module. `DATA_MODEL.md` §13 owns the schema,
this file owns the endpoint surface, the derived-number rules, the screen list and the
verification gates. Anything a screen reads is specified here; if the code and this file
disagree, one of them is wrong.

## 1. Scope

Six modules, matching the `Finance` group in `lib/os/nav.ts`, plus an overview:

| screen | route | what it answers |
|---|---|---|
| Finance overview | `/finance` | where the money came from and went this month, runway, renewals, receivables, currency exposure |
| Income Calculator | `/finance/income` | gross → tax → take-home, monthly/annual, two profiles side by side |
| Currency Converter | `/finance/currency` | convert any amount at a stored rate, see the rate ledger, total mixed-currency rows |
| Subscriptions | `/finance/subscriptions` | recurring commitments, renewal dates, normalised monthly/annual cost |
| Service Catalogue | `/finance/services` | what you sell, per-unit rates, the plans on top of it |
| Cost Scenarios | `/finance/scenarios` | a monthly curve for a plan, break-even month, runway, compare two plans |
| Expenses | `/finance/expenses` | logged spend by month/category/vendor, recurring share, CSV export |

Everything is **offline first**: no paid API, no mandatory network. Exchange rates are rows
the user owns; a missing rate is an error the UI shows, never a made-up number.

The personal dashboard carries a **Money** tile (`money` in `lib/os/widgets.ts`) that reads the
same `GET /finance/summary` as `/finance`, so the two can never quote different figures. It asks
the API to state the workspace's own currency — four numbers on one tile have to be comparable —
and a workspace with no default simply sends no `currency` and prints what an unnamed book returns.

## 2. Money rules (non-negotiable)

1. **Decimal everywhere in Python.** Money columns are `NUMERIC(14,2)`, rates
   `NUMERIC(18,6)`. Arithmetic uses `decimal.Decimal` and quantises once, at the end, with
   `ROUND_HALF_UP` to the target's minor-unit count. No float is ever summed.
2. **JSON shape.** Derived and stored money leaves the API as a JSON number rounded to the
   currency's minor units (2 dp for INR/USD/EUR…, 0 dp for JPY/KRW/VND). Aggregation always
   happens server-side so the browser only ever *displays* numbers, never adds them.
3. **Nothing is converted silently.** A converted figure is stored next to the original
   (`converted_amount`/`converted_currency`/`converted_at`, all three or none) or returned as
   an explicit derived object carrying `rate`, `as_of` and `stale_days`. A total across
   currencies is reported **per currency**, and a single-currency total is only produced when
   the caller names the currency and every row can be converted.
4. **A rate lookup never invents a rate.** `MAX(as_of) <= requested_date` for the pair; if no
   row exists, the endpoint answers 422 `validation_error` naming the pair and the date. If the
   newest row is older than `RATE_STALE_DAYS` (30) the response says `stale: true` + `as_of` so
   the UI can flag it — the number is still the user's own last known rate.
5. **`workspaces.currency` is only a default for new rows**, never a conversion target behind
   the user's back. `?currency=` on summaries is the explicit target and is echoed back.
6. **A screen must render the unnamed state.** `/finance` opens with *As recorded* — no target sent
   — so a mixed book shows em dashes, the `by_currency` split, and one sentence explaining that a
   total would need a rate. `Read totals in` then names a code and the API re-derives everything in
   it. The default is deliberately *not* the workspace currency: the reader has to see that mixing
   codes was their choice. `?currency=INR` in the URL is shareable and re-derives the same figures
   twice, for anyone, at any date the rows cover. The contract that makes this renderable is on the
   API side (§4 Overview): **a null `currency` never travels with bare numbers**, so the screen does
   not have to warn about individual figures — a dash is always the honest answer.

## 3. Period and normalisation rules

* A `month` parameter is `YYYY-MM` **or `YYYY-MM-01`**; both mean the same window and the label is
  always echoed as `YYYY-MM`. A value that is neither is a 422 on `["query","month"]`. The three
  month-bearing reads are `/expenses/summary`, `/income/summary` and `/expense-categories` (the
  tree carries no label, so it cannot echo one).
* Recurrence normalises to a **monthly** figure (the common denominator for burn/runway):
  weekly × 52 / 12, quarterly ÷ 3, yearly ÷ 12, one_time ÷ horizon (scenario items) or
  excluded from the monthly figure and shown separately otherwise. `45m`-style fractions are
  never used; intervals are the enum in §5.
* `monthly_burn` is a **run rate plus this month's one-offs**: one row per live recurring
  commitment (`recurring_rules()`), converted at the rate in force on `today`, never dropped
  because it is priced in another code; a `one_time` row only counts on its own date.
  `/expenses/summary`'s `recurring_monthly` is that same run rate and therefore does **not** depend
  on the requested `month`; the 12-month `series` does.
* `runway_months` = `cash_in / monthly_burn` where `cash_in` = income received in the last 90
  days minus expenses paid in the same window, floored at 0, `null` when the burn is 0 (infinite
  runway is not a number and must not be faked as one).
* `break_even_month` = first month in a scenario projection whose cumulative net ≥ 0, `null` if
  none inside the horizon.

## 4. Endpoint surface

All paths are under `MYOS_API_PREFIX` (`/api/v1`) and reach the browser through
`/api/os/v1/*`. Lists are `{"items": […], "total": n}`. Mutating endpoints write an activity
row in the same transaction. Money-bearing rows always carry an explicit `currency`.

Paginated lists echo the page they served: `{items, total, limit, offset}` — `/expenses`, `/income`,
`/subscriptions`, `/services`, `/service-plans`, `/exchange-rates`. `/expense-categories`,
`/income-profiles`, `/cost-scenarios` and `/currencies` are unpaginated and carry no
`limit`/`offset`, so a client that reads them must not expect one.

**Sorting direction.** Every finance list that takes `sort=` also takes `dir=asc|desc`. Absent or
blank means the key's own default (see the per-endpoint notes below: date, amount, price, created
and updated keys default to descending; `name`, `pair` and `renews` to ascending). `dir` flips that
one key and nothing else — `id ASC` stays the final tiebreaker in every family, so two rows with an
equal key keep their relative order in both directions. A value outside `asc|desc` is a 422 on
`["query","dir"]` with `field: "query.dir"`.

### Overview
* `GET /finance/summary?today=&currency=` →
  `{ currency, month: "2026-11", income, expense, net, monthly_income_avg_3m,
     monthly_burn, runway_months, cash_in_90d, mrr, arr, receivables, overdue_income,
     income_by_month: [{month, income, expense, net}],
     expense_by_category: [{category_id, name, color, amount, share}],
     top_vendors: [{vendor, amount, count}],
     renewing_this_month: [{id, label, amount, currency, renews_on, days_until}],
     by_currency: [{currency, income, expense}],
     stale_rates: [{base, quote, as_of, age_days}],
     counts: {expenses, income, subscriptions, services, scenarios} }`
  Every figure is derived in `app/services/money.py::finance_summary`; nothing here is stored.
  `?currency=` is the reader's lever (§2.6). With no target and more than one code in the window
  `currency` is `null`, and **every figure that would need a rate is `null` too** — `income`,
  `expense`, `net`, `monthly_income_avg_3m`, `monthly_burn`, `runway_months`, `receivables`,
  `overdue_income`, `cash_in_90d`, `mrr`, `arr`, and the amounts inside `income_by_month`,
  `expense_by_category` and `top_vendors`. What stays numeric is `by_currency` and any list whose
  rows each name their own code — `renewing_this_month` carries a `currency` per row, so it is a
  list of answers rather than a merged total. A null envelope never travels with a bare number;
  that is what lets `/finance` render dashes and one sentence instead of guessing.

### Income profiles (`income_profiles`)
* `GET /income-profiles?kind=` → items + total; each item gains derived `monthly_net`,
  `effective_tax_rate`, `annual_gross`.
* `POST /income-profiles` — required `name`, `currency`; `gross_monthly >= 0`; unique name per
  workspace ⇒ 409; `tax_regime` other than `none` with no `tax_rate` and no `slabs` ⇒ 422 on
  `tax_rate` (`PATCH` shares the rule — a profile that cannot be taxed is not stored, because a
  stored `slab` profile with no inputs previews as `monthly_net: 0.0`, which reads like an answer).
* `GET|PATCH|DELETE /income-profiles/{id}` — delete is 204; scenarios referencing it keep their
  own rows (`SET NULL`).
* `POST /income-profiles/preview` — the calculator, nothing saved. Body
  `{ gross_monthly | gross_annual, period: "monthly"|"annual", currency, tax_regime, tax_rate,
     slabs: [{up_to, rate}], deductions: [{label, amount, pre_tax}], other_income }` →
  `{ gross, taxable, tax, net, net_monthly, net_annual, effective_tax_rate, currency,
     slab_breakdown: [{from, to, rate, amount}], deductions_total, warnings: [ … ] }`.
  `slabs` are `{up_to: null}`-terminated; a `presumptive` regime applies `tax_rate` to gross, a
  `slab` regime to taxable after pre-tax deductions, `flat` to taxable.
* `PATCH /income-profiles/{id}` accepts the same maths fields; re-previewing is the client's
  business (the profile stores inputs, never results).

### Currencies and rates
* `GET /currencies` → `{ items: [{code, symbol, name, minor_units, decimal, group}] }` from
  `app/core/currencies.py` (a curated ~40-code registry; `minor_units` drives rounding).
* `GET /exchange-rates?base=&quote=&q=&sort=as_of|pair|created&dir=&limit=&offset=` → rate rows,
  newest first by default, each with `age_days` relative to `today`.
* `POST /exchange-rates` — `base`, `quote` (uppercased, must differ ⇒ 422), `rate > 0`,
  `as_of`. Duplicate `(base, quote, as_of)` ⇒ 409. A pair is stored one-way; the API derives the
  inverse for `quote→base` **only** as `1/rate` and labels it `derived: true`.
* `PATCH|DELETE /exchange-rates/{id}` · `DELETE /exchange-rates/{id}` → 204.
* `GET /convert?amount=&base=&quote=&as_of=` →
  `{ amount, base, quote, converted, rate, as_of, derived, stale, age_days }`. Unknown pair ⇒
  422 naming the pair and the date it looked up.
* `POST /exchange-rates/sync` — optional network refresh. Without `MYOS_RATES_URL` configured it
  answers 503 `{ "code": "not_configured", … }` and the UI shows "add rates by hand". Nothing
  else in Finance calls the network.

### Catalogue (`services`, `service_plans`)
* `GET /services?q=&active=&unit=&sort=updated|name|price&dir=&limit=&offset=` · `POST` ·
  `GET /services/{id}` ·
  `PATCH` · `DELETE` (plans cascade, `subscriptions.plan_id` becomes null).
  Detail adds `plans: […]`, `revenue: {total, currency, paid_count, invoiced_amount}` from
  `income_transactions.service_id`, and `utilisation_hours` from linked project tasks when a
  `project_id` is later added (phase-3: `null`, documented, not faked).
* `GET /service-plans?service_id=&interval=&active=&sort=price|name&dir=&limit=&offset=` ·
  `POST` (requires
  `service_id`, `name`, `price >= 0`; unknown service ⇒ 422) · `PATCH` · `DELETE`. Each plan
  gains derived `monthly_price`, `effective_rate` (price ÷ included_units **in the plan's own
  interval**, deliberately not per month — `monthly_price` is the normalised figure; `null` when
  `included_units` is null or 0) and `subscriber_count`. `project_template` is write-only by
  construction: it exists in create/update bodies and is stored, but no payload echoes it, because
  cloning a task breakdown is Phase 2 work and an echo would invite the UI to promise it.

### Subscriptions (`subscriptions`)
* `GET /subscriptions?status=&renews=month|week|past&q=&sort=renews|price|created|cost&dir=&limit=&offset=`
  → rows + derived `monthly_cost`, `annual_cost`, `renews_in_days`, `is_running`. `renews=month` is
  the **calendar month containing `today`**, and all three windows list only rows that still bill
  (`trialing|active`, started, not yet cancelled) — the same rows the burn and
  `renewing_this_month` use, so the screen's list, the overview's panel and the run rate agree.
* `POST` — requires `started_on`, `price`, `currency`; `status=active|trialing` with a past
  `renews_on` is allowed but flagged in the response (`warnings`), because people log real
  renewals late. `cancelled_on` before `started_on` ⇒ 422.
* `GET|PATCH|DELETE /subscriptions/{id}`.
* `POST /subscriptions/{id}/pause|resume|cancel` → the row, with the derived block recomputed.

### Expense categories and expenses
* `GET /expense-categories?kind=&archived=&month=&currency=` → a tree: each node has `children`, `depth`,
  `amount_this_month` (its own rows + children) and `monthly_norm`. Seeded system keys
  (`rent`, `software`, `insurance`, `tax`, `food`, `travel`, `other`) are idempotent by
  `system_key`.
* `POST /expense-categories` — `name` unique per `(workspace, parent)`. `parent_id` must exist
  **in this workspace**: a body reference to a missing or unknown parent is a 422 naming
  `parent_id` (a path id is still a 404, another workspace's row is a 409); a cycle or
  `parent_id == id` is a 422.
* `GET /expenses?category_id=&vendor=&currency=&recurring=&from=&to=&q=&sort=paid_on|amount|created&dir=&limit=&offset=`
* `POST /expenses` — required `label`, `amount >= 0`, `currency`, `paid_on`; unknown category ⇒
  422; `recurring=true` without a non-`none` `recurrence` ⇒ 422 (and vice versa).
* `GET|PATCH|DELETE /expenses/{id}` · `POST /expenses/bulk` `{ids, action:
  "delete|set_category|set_recurring", value}` → `{updated, failed:[{id,error}]}`.
* `GET /expenses/summary?month=&currency=&today=` → `{ month, currency, total, count,
  recurring_monthly, by_category[], by_vendor[], by_currency[], series: [{month, total}],
  top_expenses[] }` (12-month series).
* `GET /expenses/export.csv?from=&to=&category_id=` → `text/csv`, one row per expense plus a
  trailing totals comment; the file is generated per request and never written to disk.

### Income transactions
* `GET /income?status=&from=&to=&service_id=&subscription_id=&currency=&q=&sort=received_on|amount|created&dir=&limit=&offset=`
* `POST` — required `label`, `amount`, `currency`, `received_on`; the `converted_*` triple is
  all-or-none ⇒ 422; `status=overdue` with a future `received_on` ⇒ 422.
* `GET|PATCH|DELETE /income/{id}` · `POST /income/{id}/mark-paid` (sets `status=paid`,
  `received_on=today` when the row was `expected`).
* `GET /income/summary?month=&currency=&today=` → `{ invoiced, received, receivables,
  overdue[], by_status{}, by_service[], series[], by_currency[], count }` — `count` is the number
  of rows inside the window.
* `GET /income/export.csv?status=&service_id=&subscription_id=&currency=&from=&to=&q=&today=` →
  `text/csv`, one row per income entry plus a trailing `# income … totals` comment block per
  currency. Generated per request, never written to disk, and the same filters the ledger itself
  uses, so the download is what is on the screen.

### Cost scenarios
* `GET /cost-scenarios?status=&kind=` · `POST` (requires `name`, `start_month`,
  `horizon_months 1..120`) · `GET /cost-scenarios/{id}` (items nested) · `PATCH` · `DELETE`
  (items cascade) · `POST /cost-scenarios/{id}/duplicate` → `{ "scenario": …, "copied_items": n }`
  · `POST /cost-scenarios/{id}/activate` (one `active` per workspace; the previous one is
  archived and the response names it).
* `GET|POST /cost-scenarios/{id}/items` · `PATCH|DELETE /cost-scenario-items/{id}` — direction
  `income|cost`, `amount`, `currency`, optional `recurrence`, `starts_on`/`ends_on` with
  `ends_on >= starts_on` ⇒ 422 otherwise; items always belong to their scenario (foreign
  scenario id ⇒ 409).
* `GET /cost-scenarios/{id}/projection?today=&horizon_months=&currency=` →
  `{ scenario, currency, months: [{month, income, cost, net, cumulative}],
     totals: {income, cost, net}, break_even_month, runway_months, assumptions }`.
  The curve is computed from items every call — totals are **never** stored.
* `GET /cost-scenarios/compare?a=&b=&currency=&today=` → both curves on a shared month axis +
  `delta` per month + which one breaks even first.

### System surfaces
* `GET /meta` gains a `counts` for every finance table (`expenses`, `income`, `subscriptions`,
  `services`, `scenarios`) — same shape as today's keys.
* `GET /search` gains groups `expenses`, `subscriptions`, `services` (labels in
  `SEARCH_GROUP_LABELS`, order appended after the existing six).
* `POST /demo/seed` / `POST /demo/reset` also seed/wipe finance rows with `source='demo'`, using
  clock-relative dates (never absolute literals) so the demo is alive whenever it is seeded.
* `GET /export` includes the ten finance tables automatically (metadata-driven dump).
* `links.py` emits the finance hrefs (§7), so activity, notifications and search all deep-link.

## 5. Enumerations added with this phase (`ENUMS` keys)

| key | values |
|---|---|
| `income.kind` | `salary, freelance, contract, business, mixed` |
| `tax.regime` | `none, flat, slab, presumptive` |
| `currency.code` | the curated registry in `app/core/currencies.py` (validated in the service, not a CHECK) |
| `service.unit` | `hour, day, fixed, retainer, seat` |
| `plan.interval` | `monthly, quarterly, yearly, one_time` |
| `subscription.status` | `trialing, active, paused, cancelled, expired` |
| `expense.category.kind` | `fixed, variable, one_off, tax` |
| `expense.recurrence` | `none, weekly, monthly, quarterly, yearly` |
| `income.status` | `expected, invoiced, paid, overdue, written_off` |
| `income.method` | `bank, card, upi, cash, crypto, other` |
| `scenario.kind` | `personal, business, hybrid` |
| `scenario.status` | `draft, active, archived` |
| `scenario.item.direction` | `income, cost` |
| `scenario.item.recurrence` | `none, weekly, monthly, quarterly, yearly, one_time` |
| `notification.kind` | gains `subscription_renewing`, `expense_recurring_due`, `income_overdue`, `rate_stale` |

## 6. Derived notifications (`services/notifications.py`)

Idempotent by the existing `dedupe_key`, so a refresh never duplicates a row:

| rule | key | severity | href |
|---|---|---|---|
| a live subscription renews within 7 days | `subscription:<id>:renews:<date>` | info | `/finance/subscriptions?sub=<id>` |
| a recurring expense is due within 3 days | `expense:<id>:due:<month>` | info | `/finance/expenses?expense=<id>` |
| an income row is `overdue` | `income:<id>:overdue` | warning | `/finance/income?income=<id>` |
| a pair's newest rate is older than 30 days | `rate:<base>-<quote>:<week>` | info | `/finance/currency?pair=<base><quote>` |

## 7. Deep links (`services/links.py`)

| record | href |
|---|---|
| expense | `/finance/expenses?expense=<id>` |
| income transaction | `/finance/income?income=<id>` |
| subscription | `/finance/subscriptions?sub=<id>` |
| service | `/finance/services?service=<id>` |
| cost scenario | `/finance/scenarios?scenario=<id>` |
| expense category | `/finance/expenses?category=<id>` |
| income profile | `/finance/income` |
| service plan | `/finance/services` |
| exchange rate | `/finance/currency` |
| group headers | `/finance/expenses?q=…`, `/finance/subscriptions?q=…`, `/finance/services?q=…` |

The last three records carry no row-level query parameter: the screens they land on list the family
and the notification text names the row, which is enough to find it. `links.py` maps
`income_profile` → `FINANCE_INCOME`, `service_plan` → `FINANCE_SERVICES`, `exchange_rate` →
`FINANCE_CURRENCY`.

`/finance` itself is the module root; the nav's Finance group head links to it.

## 8. Schema deviations from DATA_MODEL §13 (deliberate, documented)

* `subscriptions.client_id` is **not** created in `0003`: `clients` is a Phase 2 table and does
  not exist yet. The column and its FK arrive with Phase 2 in its own migration, so nothing is
  reverse-engineered later. `company_id` (→ `companies`, which exists) is created now.
* `exchange_rates.provider` is a free-text `VARCHAR(24)` (`manual`, `sync`, `import`), not a
  CHECK — the set grows with each connector.
* `expense_categories.color` stores a 12-char hex string used as the category dot colour on
  screen and nowhere in the maths.

## 9. The screens this phase ships

Every file below is a server `page.tsx` plus a colocated `'use client'` view. Each view is a thin
reader: it sends its filters as query parameters, renders what the API derived, and never adds,
converts or rounds a number itself. Routes that read `useSearchParams` render under `Suspense`.

| screen | view | primary calls | the honest states it must show |
|---|---|---|---|
| Finance overview | `app/(perpro)/finance/FinanceView.tsx` | `GET /finance/summary` | empty book → module launcher with zero counts; mixed codes → em dashes + `by_currency` + the reader control; stale rates → warning links into `/finance/currency?pair=` |
| Income | `finance/income/IncomeView.tsx` + `IncomeLedger.tsx` | `GET /income-profiles`, `POST /income-profiles/preview`, `GET /income`, `GET /income/summary`, `POST /income/{id}/mark-paid`, `GET /income/export.csv` | profile delete is type-to-confirm; ledger keeps a row open from `?income=`; overdue days come from the server; the CSV link sends the ledger's own filters |
| Currency | `finance/currency/CurrencyView.tsx` | `GET /currencies`, `GET` and `POST /exchange-rates`, `GET /convert`, `POST /exchange-rates/sync` | unknown pair → the API's 422 naming pair and date; `sync` without `MYOS_RATES_URL` → 503 `not_configured` rendered as "add rates by hand" |
| Subscriptions | `finance/subscriptions/SubscriptionsView.tsx` | `GET /subscriptions`, `POST /subscriptions/{id}/pause`, `resume`, `cancel`, `GET /service-plans` | `one_time` has no monthly figure, so it prints an em dash, not a division; renewal window chips are queries, not filters |
| Service catalogue | `finance/services/ServicesView.tsx` | `GET /services`, `GET /services/{id}`, `GET /service-plans` | a service whose income spans codes reports `total: null` instead of a blended figure; plans packaged from a service are a separate empty state |
| Cost scenarios | `finance/scenarios/ScenariosView.tsx` | `GET /cost-scenarios`, `/cost-scenarios/{id}`, `/projection`, `/compare` | a line with no cadence is called out as absent from the curve; `in_horizon: false` months print faint em dashes; a mixed-currency scenario answers `?currency=` before it totals; assumptions are echoed with "the curve is built from lines alone" |
| Expenses | `finance/expenses/ExpensesView.tsx` | `GET /expenses`, `/expenses/summary`, `/expense-categories`, `POST /expenses/bulk`, `GET /expenses/export.csv` | tree filter shows children amounts; bulk action reports per-id failures; CSV is a link to the API, never built in the browser |

Shared money components live in `components/os/finance.tsx` (`MoneyCell`, `MoneyHero`, `InOutBars`,
`CumulativeCurve`, `ShareList`, `PeriodNav`, `SortHeader`, `AmountField`, `CurrencySelect`,
`ServiceSelect`, `ProfileSelect`, `RateStrip`) and mirror types in `lib/os/finance.ts`
(`FINANCE_PATHS`, `FINANCE_SCOPE`, `FINANCE_SORTS`, `SCENARIO_RECURRENCES`). `Money = number | null`
in that file is the UI's copy of rule 3: a null is a missing answer, not zero, and it renders as an
em dash everywhere.

## 10. Gates this phase must pass before it is called done

1. `cd backend && python3 -m pytest -q` green, including new `tests/test_money.py`,
   `test_finance_api.py`, `test_scenarios.py`, `test_rates.py` — and green under the frozen-clock
   plugin at 1995-02-27, 2032-02-29, 2060-12-31 and an IST date-boundary run (no test may depend
   on the machine date).
2. Money tests must pin, at minimum: slab vs flat vs presumptive tax, 0-dp currencies (JPY),
   half-cent rounding, monthly normalisation of every interval, runway with zero burn → `null`,
   conversion that degrades to the last known rate, conversion that refuses an unknown pair, and
   a scenario curve whose totals equal the sum of its months.
3. `npx tsc --noEmit` clean, `npm test` green, `npx next build` clean.
4. Every finance screen is on the real API — no static mockups, no seeded-in-component data.
   Each has loading, empty and error states; forms validate client-side and surface the API's
   422 `details` per field.
5. `tests/test_links.py` sweeps every emitted href: no `/os` prefix, no literal `None`.
6. README + `docs/MYOS/API.md` + `DATA_MODEL.md` updated to match what shipped.

### Open items

**Closed.** (a) An unnamed mixed-currency response nulls `monthly_burn`, `receivables` and
`cash_in_90d` along with the envelope currency (§2.3, rule 3), pinned in `tests/test_money.py` and
`tests/test_finance_api.py` — a recurring USD expense is converted into an INR-target burn instead
of being dropped from it. (b) `POST /demo/seed` backfills the Phase 3 half of a database that was
seeded before Phase 3; the skip is per half, so an old install gets its money without a gated
reset, and a third call says there is nothing to do. (c) `GET /income/export.csv` is live and is
the Income ledger's Export CSV button.

Three deviations the API owed and now enforces, found while writing the pins: an unknown
`parent_id` in an expense-category body is a 422 rather than a 404; a `tax_regime` that names a
rule with no inputs cannot be saved (it used to store, then preview as `monthly_net: 0.0`); and
`/subscriptions?renews=` lists only rows that still bill, so that filter, the overview's
`renewing_this_month` and the burn can no longer disagree about a paused subscription.
