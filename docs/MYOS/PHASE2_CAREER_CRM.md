# Phase 2 — Career & CRM: the contract this build implements

This is the working contract for the two business pipelines. `DATA_MODEL.md` §12 owns the schema,
this file owns the endpoint surface, the state machines, the derived-number rules, the deep links,
the screen list and the verification gates. If the code and this file disagree, one of them is
wrong — and the frontend mirror of every rule below is `lib/os/career.ts`, `lib/os/crm.ts` and
`lib/os/meetings.tsx`, which is where the screens read them from.

Phase 2 was specified after Phase 3 was built, so it inherits Phase 3's rules instead of restating
them: money is derived on read and never totalled across currencies in the browser
(`PHASE3_FINANCE.md` §2), and a screen that cannot reach the API says so rather than showing
something invented.

## 1. Scope

Three tabs in the sidebar and one shared meeting form. There is no fourth "MyOS" app:

| screen | route | what it answers |
|---|---|---|
| Career | `/career` | the job funnel, the interview diary behind it, and the rates the funnel has produced |
| Freelance CRM | `/crm` | the lead pipeline, the follow-up clock, and what the pipeline is worth |
| Customers | `/customers` | the account book: contracts, renewal warnings, health, lifetime value, receivables |
| Meeting form | `components/os/meetings.tsx` | one dialog used by all three screens and by Career's interviews |

Phase 1's `/contacts` stays the address book — CRM rows point at it and never copy from it.
`/meetings` stays the Supabase screen. **No Phase 2 payload, link, search group or activity row
ever emits `/meetings`** (see §7).

## 2. The rules that are not negotiable

1. **The server owns state legality.** A board never offers a hop the machine does not allow
   (`allowedTransitions` / `allowedLeadTransitions` in the mirrors), and an illegal move that
   arrives anyway is a `409` whose `details` name the whole legal set. The UI renders that list
   verbatim; it does not soften it.
2. **`last_touch_at` is server-only.** It is stamped by `transition` and by `promote`, and it is
   the source of `days_since_touch`, the follow-up list and time-to-win. It is not a body field on
   any endpoint, because a pipeline whose "when did I last speak to them" can be typed in is a
   pipeline nobody can trust.
3. **Money follows Phase 3 §2.** Per-currency tallies (`value_by_currency`, `weighted_value`,
   `lifetime_value`, `open_receivables`, `mrr_by_currency`) are the honest view; a single number
   exists only when the bucket is one currency or the caller named a target with `?currency=`.
   Salary bands are the exception §12 writes into the schema: they have no currency column because
   they are denominated in `workspaces.currency`, which `/career/summary` echoes as `currency` and
   never converts.
4. **A record's dates are one question, answered by the API.** `days_to_next_touch`, `is_overdue`,
   `days_to_contract_end`, `renewal_in_days`, `days_since_touch`, `is_stale` are all derived on
   read against the injected `?today=` (or the server's day). No screen re-derives them.
5. **Nothing in the funnel is stored that can be recomputed.** `/career/summary` and
   `/crm/summary` rebuild every figure from the rows the list reads, so moving a card cannot leave
   a stale rate behind.
6. **Forms surface real field errors.** A `422` is mapped through `mergeFieldErrors` onto the input
   that caused it; a `409` is shown as what it is (a duplicate account, an illegal move) with the
   link it implies, never as a generic failure.

## 3. The two state machines

`saved → applied → screening → interview → offer → hired` is the career ladder;
`new → contacted → qualified → proposal → won` is the sales one. Both allow any *strictly forward*
hop, so skipping `screening` or `qualified` is legal. `offer` is **open** — it can still become
`hired` or fall through to `rejected`.

| `job_application.status` | legal next |
|---|---|
| `saved` | `applied`, `rejected`, `withdrawn` |
| `applied` | `screening`, `interview`, `rejected`, `withdrawn` |
| `screening` | `interview`, `offer`, `rejected`, `withdrawn` |
| `interview` | `offer`, `rejected`, `withdrawn` |
| `offer` | `hired`, `rejected`, `withdrawn` |
| `hired` | nothing (terminal) |
| `rejected` / `withdrawn` | `applied` (a reopen, and the only way back) |

| `lead.status` | legal next |
|---|---|
| `new` | `contacted`, `qualified`, `proposal`, `won`, `lost`, `dormant` |
| `contacted` | `qualified`, `proposal`, `won`, `lost`, `dormant` |
| `qualified` | `proposal`, `won`, `lost`, `dormant` |
| `proposal` | `won`, `lost`, `dormant` |
| `won` | nothing (terminal — a second `promote` is the 409 that says so) |
| `lost` | `contacted` |
| `dormant` | `contacted`, `lost` |

Three consequences the screens depend on:

* `lost` requires `lost_reason`; `_require_reason` answers 422 naming the field, and the board asks
  for the reason inline before it posts, so the refusal is rare rather than invisible.
* A row reaching `rejected | withdrawn | hired | offer` stamps `closed_at` **the first time only**.
  It is an outcome stamp (the date the pipeline produced something, which is what
  `time_to_offer_days` measures), not an "inactive" flag.
* `dormant` is not closed: it is overdue-eligible, because parking a lead does not discharge the
  call you promised. `won` and `lost` are the only terminal pair.

**`POST /leads/{id}/promote` is the only place a lead creates another row.** One transaction: the
account is created, the lead becomes `won`, an `activity_logs` row of verb `promoted` lands on the
lead and a `created` row on the client. The body is `extra="forbid"` and honours exactly seven
keys — `stage`, `health`, `contract_start`, `contract_end`, `renewal_reminder_days`, `tags`, `notes`
— all applied to the **new** client only; nothing about an existing account is ever mutated by a
promote. `name` is absent because it is derived, `owner_id` because no Phase 2 endpoint writes
`users.id`, and `estimated_value` because a won deal's size is history while an account's
recurring money comes from its subscriptions. When the lead names neither a contact nor a company,
the promote creates the contact as well — an account whose display name was its own uuid would sort
as noise.

## 4. Derived numbers, and where each one comes from

| field | endpoint | source |
|---|---|---|
| `days_since_touch` (lead) | `/leads`, `/leads/{id}` | `coalesce(last_touch_at, updated_at)` − today, unclamped |
| `days_to_next_touch`, `is_overdue` | `/leads`, `/leads/{id}` | `next_touch_at` − today; overdue only when `next_touch_at < today` and status is not `won`/`lost` |
| `days_since_touch`, `is_stale` (application) | `/job-applications` | newest of `updated_at`/`applied_at`; stale = open + nothing scheduled later + `STALE_AFTER_DAYS` (14) |
| `interview_count`, `next_interview` | `/job-applications`, `/job-applications/{id}` | from `job_interviews`, scheduled rows only |
| `name` (client) | `/clients` | company name, else contact name — `clients` has no name column of its own |
| `mrr`, `mrr_by_currency` | `/clients`, `/clients/{id}` | Phase 3 `money.mrr` restricted to that account's live subscriptions |
| `mrr_recorded` | `/clients` | §12's stored column, echoed only. **No Phase 2 endpoint writes it**, which is why every screen prints the derived figure and says when the two differ |
| `lifetime_value`, `open_receivables` | `/clients` | per-currency tallies over that account's income ledger |
| `days_to_contract_end`, `renewal_in_days` | `/clients` | `contract_end` − today; `contract_end − renewal_reminder_days − today` |
| `pipeline[]`, `value_by_currency`, `weighted_value` | `/crm/summary` | all seven statuses counted; weighting is `score / 100 × value` with a null score counting as zero |
| `needs_follow_up[]` | `/crm/summary` | overdue rows, capped at `NEEDS_FOLLOW_UP_ROWS` (20) — a list of hundreds is a report, not a to-do |
| `funnel[]`, `rates`, `time_to_*_days`, `stale[]`, `interviews_upcoming[]` | `/career/summary` | recomputed from the rows; a rate is `null` when its denominator is empty, because 0 % is a claim |

`GET /clients/{id}` embeds three windows, and each screen says which window it is reading: every
subscription live as of today, the 12 most recent income rows (`DETAIL_INCOME_ROWS`) any status,
and the next 10 upcoming meetings (`DETAIL_MEETING_ROWS`, no horizon cap). Lifetime value and
receivables cover the whole ledger, so a short income list is not a short account.

`sort=mrr` on `GET /clients` orders **the page the API returns**, not the book: the key is derived,
so SQL cannot do it (`_order_by_mrr`). Every screen that ranks accounts says so and ranks the rows
it actually loaded.

## 5. Endpoint surface

All under `/api/v1`, reached by the browser as `/api/os/v1/*`. Every list is
`{items, total, limit, offset}`; every list takes `sort`/`dir`/`q`/`limit`/`offset`.

| family | endpoints |
|---|---|
| job applications | `GET|POST /job-applications`, `GET /job-applications/{id}` (embeds `interviews`), `PATCH|DELETE /job-applications/{id}`, `POST /job-applications/{id}/transition` (`{status, note?}`; a `note` on a row that did not move is still history) |
| interviews | `GET|POST /job-interviews`, `PATCH|DELETE /job-interviews/{id}` |
| career roll-up | `GET /career/summary?today=&currency=` |
| leads | `GET|POST /leads` (filters `status`, `origin`, `company_id`, `contact_id`, `score_min`, `q`), `GET /leads/{id}` (adds `client`), `PATCH|DELETE /leads/{id}`, `POST /leads/{id}/transition`, `POST /leads/{id}/promote` |
| CRM roll-up | `GET /crm/summary?today=&currency=` |
| clients | `GET|POST /clients` (filters `stage`, `health`, `tag`, `company_id`, `q`, `currency`; `sort=name|contract_end|mrr|created`; deliberately **no `contact_id` filter**), `GET /clients/{id}`, `PATCH|DELETE /clients/{id}` |
| meetings | `GET|POST /meetings`, `GET|PATCH|DELETE /meetings/{id}` (filters `status`, `entity_type`, `entity_id`, `start`, `end`, `q`; `sort=starts_at|created|title`) |

Meeting rules the UI is built around: `ends_at` is NOT NULL and must be after `starts_at`; the
entity pair is both-or-neither, and `entity_id` without `entity_type` is a 422 naming
`query.entity_type`; an id from another workspace is refused on the field rather than silently
returning an empty page. `status` is an ordinary field, so completing a meeting is a `PATCH` —
there is no action endpoint to mis-click. `calendar_event_id` is echoed and stays null until
Phase 4 owns calendar events.

## 6. Enumerations and counts added with this phase

`GET /meta` `enums` gains eleven keys, and `counts` gains exactly five:

```
job.application.status   : saved | applied | screening | interview | offer | hired | rejected | withdrawn
job.application.channel  : referral | job_board | recruiter | website | event | other
job.interview.type       : phone | video | onsite | technical | hr | other
job.interview.status     : scheduled | completed | cancelled | no_show
job.interview.outcome    : positive | neutral | negative | pending
lead.status              : new | contacted | qualified | proposal | won | lost | dormant
lead.origin              : website | referral | inbound | outbound | event | social | other
client.stage             : onboarding | active | at_risk | churned | archived
client.health            : green | amber | red | unknown
meeting.status           : scheduled | completed | cancelled | no_show
meeting.entity_type      : task | note | project | milestone | contact | company | goal |
                           job_application | lead | client
```

`activity.verb` gains `transitioned` and `promoted`; `notification.kind` gains `interview_upcoming`,
`application_stale`, `lead_follow_up` and `client_contract_end`. `counts` gains `applications`,
`interviews`, `leads`, `clients`, `meetings`. `lib/os/enums.ts` carries the same list as the
fallback for a `/meta` that has not answered, and `normaliseEnums` re-keys the dotted wire names,
so a screen never hardcodes an enum.

## 7. Deep links

One scheme, query-based, emitted only by `backend/app/services/links.py`:

| record | href |
|---|---|
| job application | `/career?app=<id>` |
| interview | `/career?interview=<id>` |
| lead | `/crm?lead=<id>` |
| client | `/customers?client=<id>` |
| meeting | the **owning** record's href — a meeting has no page of its own |
| search group header | `/career?q=…`, `/crm?q=…`, `/customers?q=…` |

A meeting with no owner resolves to its `entity_type`'s list page; there is no `?id=` form and no
`/meetings` link anywhere in a Phase 2 payload. `tests/test_links.py` sweeps every stored string
for both rules, and the screens read these params on arrival as well as on first render, so a link
from a notification, ⌘K or the dashboard moves the filters instead of being ignored.

## 8. Deliberate deviations from DATA_MODEL §12

* `renewal_reminder_days` is CHECKed `0..180` — the dialogs refuse outside it locally with the same
  range the server answers with, and the default is 30.
* `leads.next_touch_at` is a **DATE**, so the follow-up field is a plain date input and the body is
  `YYYY-MM-DD`; `last_touch_at` is a timestamp and is never sent by a form.
* `clients.mrr` remains a stored column but is write-less: it is `mrr_recorded`, echoed for
  diffing. The figure the UI prints is derived.
* `job_interviews.interviewer_ids` is `|`-joined ids (the first table without a join row); the
  frontend sends and receives an array and the service joins.
* `POST /leads/{id}/promote` creates a contact when the lead names neither person nor company.
* `client_id` FKs on `income_transactions` and `subscriptions` belong to §13 and are created by the
  same migration (0004). The Phase 3 payloads carry the id only — **no nested `client` echo** —
  because `name` is derived and would make the money services depend on the CRM service; the ledger
  maps id → name through the `/clients` list it already has in memory.
* `calendar_connections` / `calendar_events` stay Phase 4 tables; `0004` does not touch them.

## 9. The screens this phase ships

Shared pieces, so the three tabs read as one product rather than three CRUD pages:

* `components/os/pipeline.tsx` — `PipelineBoard` (drag, arrows, and an honest note for rows that
  fall outside the columns), `FunnelRail`, `HealthDisc`, `TallyFigures`.
* `components/os/meetings.tsx` — `MeetingDialog` (slot maths from `lib/meeting-times`: the default
  is *today* at the next sensible hour, presets, and `follow` so an edit never silently
  reschedules) and `MeetingLine` (complete/cancel inline).
* `components/os/marks.tsx` — the five dot states the task list already uses, so a lead and a task
  mean the same thing at a glance. Colour appears only on health, which is a judgement.
* `components/os/pickers.tsx` — `ClientSelect` over `GET /clients?limit=200&sort=name`, with an
  empty state that tells you to win a lead rather than showing a blank dropdown.
* Career: `CareerView` (board + table + diary + rates), `ApplicationDialog`, `ApplicationDetail`,
  `InterviewDialog`.
* CRM: `CrmView` (board + table + follow-up rail + value rail), `LeadDialog`, `LeadDetail`,
  `PromoteDialog`.
* Customers: `CustomersView` (table + stage board + contract clock + per-currency book),
  `ClientDialog`, `ClientDetail`.

Every one of them keeps the four states: loading skeleton, empty with the action that fills it,
error with a retry (and an explicit "this API has no CRM endpoints yet" on a 404, rather than a
blank board), and the data itself.

## 10. Gates this phase must pass before it is called done

1. `npx tsc --noEmit` prints nothing.
2. `npm test` passes, including `lib/os/career.test.ts` and `lib/os/crm.test.ts`, which pin both
   graphs against this file, the dot mappings, `salaryBand`/`salaryBandError`, `mergeTally`,
   `sumMrrByCurrency`, `renewalBuckets`, `tagCounts`, `openLeadCount` and every sort/default pair.
3. `cd backend && python3 -m pytest -q` passes, including the API tests for the two machines
   (an illegal hop is a 409 that names the legal set), the promote transaction, the duplicate
   account 409, the meeting entity rules and the derived columns under an injected `?today=`.
4. `npx next build` succeeds; `/career`, `/crm` and `/customers` answer 200 and every screen reads
   the running API — no mock data, no static screen.
5. `alembic upgrade head` (0004) applies on both SQLite and Postgres, and `/demo/seed` produces
   leads, accounts, applications and interviews with plausible dates, so an empty install is never
   the demo.

### Still open at the time of writing

Checked against the tree, and against a live `0004` API on a scratch database, rather than assumed:

* **Mounted and reachable.** `alembic upgrade head` on a fresh file runs `0001 → 0002 → 0003 → 0004`
  and leaves 35 tables; `career` and `crm` are in `api_router`, so `GET /job-applications`,
  `/career/summary`, `/leads`, `/crm/summary`, `/clients` and `/meetings` all answer 200, `links.py`
  maps the five record types, and `GET /meta` serves the eleven enum keys, the two new verbs and the
  five new counts. Every payload key set matches `lib/os/career.ts` and `lib/os/crm.ts` — verified by
  diffing responses against the interfaces, not by reading the schemas.
* **Career is blocked by two write-path bugs**, which is why the tab is not yet usable end to end:
  `GET /job-interviews` 500s (`AttributeError: 'ScalarResult' object has no attribute 'offset'` — the
  statement is paged after it has been executed), and `POST /job-applications` answers 409 for every
  body, because the create path runs the transition guard while the new row's status is still `None`
  — `"a job application in status 'None' cannot move to 'saved'"`. That second one is the same shape
  of mistake `tests/test_links.py` sweeps hrefs for: the literal string `None` in a client-visible
  message. Until both are fixed `/career/summary` reports a funnel of eight zeros.
* **CRM behaves as specified.** `POST /leads` → 201, `new → qualified` accepted, `won → new` refused
  with the legal set, a promote creates the account and the second promote is a 409, `PATCH /clients`
  moves stage and health, and `GET /clients/{id}` embeds `subscriptions`, `income` and `meetings`.
  The meeting rules the UI is built around hold on the wire, including `entity_id` without
  `entity_type` → 422 naming `query.entity_type`.
* **`demo.seed` creates no Phase 2 rows** — the seed on a fresh `0004` database lists nothing for
  leads, clients, applications, interviews or meetings, so gate 5 is unmet and a fresh install shows
  empty boards. It has to become idempotent-per-half the way Phase 3's was.
* **⌘K cannot find the new records yet**: `services/search.py` does not read the tables, even though
  `_SEARCH_PAGES` already names both group headers.
* **Three of the four notification kinds are not emitted yet** (`interview_upcoming`,
  `application_stale`, `lead_follow_up`); `client_contract_end` comes from the write path that owns
  the rule.
* **The dev database in this sandbox is stamped `0002`**, so the browser is still pointed at a surface
  without these tables; moving it is shared-state change and needs the operator's go-ahead
  (`stamp 0003`, then `upgrade head`). Note that `auto_create` defaults to on, so restarting uvicorn
  against that file would itself create the missing tables rather than migrate them — the two paths
  are not the same thing, and only the migration records the schema in `alembic_version`.
* **`tests/test_cli.py` pins `HEAD = "0003"`** while `0004` exists: five failures whose only cause is
  the constant (`assert '0004' == '0003'`), not the chain.
* **The Phase 3 → client seam (§8)** is now expressible — `lib/os/finance.ts` carries
  `client_id?: string | null` on `Subscription`, `IncomeTransaction` and both input types, and the
  backend echoes it on both lists with no nested `client` — but the ledger and subscriptions screens
  still have to render the picker and honour `?client_id=` before the account pages can claim a
  money trail.
