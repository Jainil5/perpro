# MyOS API v1 — contract

Base path: `/api/v1`. Frontend calls `/api/os/v1/…` (the Next proxy strips `/api/os`).
Single workspace in Phase 1: `MYOS_WORKSPACE` (default `default`) resolves the workspace row;
every query is scoped to it. All timestamps are UTC ISO-8601 with `Z`; all dates are
`YYYY-MM-DD` or `null`. All ids are server-generated UUID4 strings.

Errors are always:

```json
{ "error": { "code": "not_found", "message": "task not found", "details": [] } }
```

| HTTP | code |
|---|---|
| 404 | `not_found` |
| 409 | `conflict` (rule violation, e.g. task belongs to another workspace) |
| 422 | `validation_error` (Pydantic field errors in `details`) |
| 502 | `upstream_unavailable` (proxy could not reach FastAPI) |

---

## Enumerations (canonical values, lowercase snake_case)

```
project.status : backlog | planning | in_progress | on_hold | review | completed | archived
task.status    : todo | in_progress | blocked | done | dropped
priority       : low | medium | high | urgent
task.recurrence: none | daily | weekly | fortnightly | monthly
note.category  : technical | ai_ml | business_idea | meeting | project_doc | learning |
                 startup | personal | resource
milestone.status: open | done
reminder.status : pending | done
goal.status     : active | completed | abandoned
contact.kind    : client | prospect | partner | vendor | mentor | personal | other
notification.kind: task_overdue | task_due | milestone | reminder | project_stalled | system
notification.severity: info | warning | critical
activity.verb   : created | updated | completed | reopened | deleted | commented | moved
source          : user | demo | import | ai
member.role     : owner | admin | member | viewer
note_relation.target_type: task | note | project | milestone | contact | company | goal
task_dependency.type: finish_to_start | start_to_finish | finish_to_finish | start_to_start
```

These values are copied from the running `GET /meta`; the served list is authoritative and the
frontend renders selects/chips from it rather than hardcoding. Wire keys are dotted
(`task.status`, `note.category`, …); `lib/os/hooks.ts` re-keys them to the shape screens use.

The canonical list is served, not hardcoded: `GET /meta` returns every enumeration above
under `enums` (keyed exactly as `project.status`, `task.status`, …) plus live row counts in
`counts` (`projects`, `tasks`, `tasks_open`, `tasks_overdue`, `tasks_due_today`, `tasks_done`,
`milestones`, `notes`, `contacts`, `companies`, `tags`, `goals`, `reminders`, `notifications`,
`activity`). The frontend's selects, chips and badges all read from there.

The frontend must not invent other values; unknown values from the API render as the raw string.

---

## Object shapes

### workspace
```json
{ "id": "ws-…", "name": "MyOS", "slug": "default", "timezone": "Asia/Kolkata",
  "currency": "INR", "created_at": "…" }
```

### project
```json
{ "id": "…", "name": "OrderBook CRM", "description": "…", "category": "client",
  "status": "in_progress", "priority": "high",
  "start_date": "2026-10-01", "target_date": "2026-12-15",
  "repository_url": null, "documentation_url": null,
  "next_action": "Send schema draft to Ravi",
  "manual_progress": 0,
  "progress": 62,
  "task_counts": { "total": 13, "done": 8, "open": 5, "overdue": 1 },
  "next_due": { "title": "Write migration notes", "due_date": "2026-11-23" },
  "milestone_count": 3, "milestones_done": 1,
  "created_at": "…", "updated_at": "…" }
```
`progress` rule (unit-tested): `completed`/`archived` ⇒ 100; else if the project has tasks ⇒
`round(done / total * 100)`; else `manual_progress`.

### task
```json
{ "id": "…", "title": "Write migration notes", "description": "…", "notes": "…",
  "project_id": "…", "project": { "id": "…", "name": "OrderBook CRM", "status": "in_progress" },
  "parent_task_id": null,
  "status": "todo", "priority": "high",
  "due_date": "2026-11-23", "start_date": null,
  "estimated_minutes": 90, "actual_minutes": null,
  "recurrence": "none", "tags": ["schema"],
  "position": 3,
  "completed_at": null, "created_at": "…", "updated_at": "…" }
```
Derived flags returned on every task: `is_overdue` (open and `due_date < today`),
`is_due_today` (open and `due_date == today`).

### milestone
```json
{ "id": "…", "project_id": "…", "title": "Beta to first client", "description": null,
  "date": "2026-12-01", "status": "open", "completed_at": null,
  "days_away": 10, "created_at": "…", "updated_at": "…" }
```

### note
```json
{ "id": "…", "title": "RLS patterns", "content": "# markdown body",
  "category": "technical", "tags": ["postgres", "security"],
  "is_favorite": false, "project_id": null,
  "word_count": 240,
  "relations": [ { "id": "…", "target_type": "task", "target_id": "…", "target_title": "…" } ],
  "backlinks": [ { "note_id": "…", "note_title": "…" } ],
  "created_at": "…", "updated_at": "…" }
```
List responses use `note_summary` (same fields minus `content`, plus `excerpt`: first 160 chars of
plain text).

### contact / company
```json
{ "id": "…", "name": "Ravi Kumar", "email": "ravi@example.com", "phone": null,
  "title": "CTO", "company_id": "…", "company": "Northwind", "location": "Bengaluru",
  "kind": "client", "tags": ["crm"], "notes": null, "created_at": "…", "updated_at": "…" }

{ "id": "…", "name": "Northwind", "website": "https://…", "industry": "fintech",
  "location": null, "notes": null, "contact_count": 2, "created_at": "…", "updated_at": "…" }
```

### notification
```json
{ "id": "…", "kind": "task_overdue", "severity": "critical", "title": "2 tasks overdue",
  "body": "…", "entity_type": "task", "entity_id": null, "href": "/tasks?filter=overdue",
  "read": false, "read_at": null, "dedupe_key": "task_overdue:…", "created_at": "…",
  "updated_at": "…" }
```

### reminder
```json
{ "id": "…", "title": "Chase invoice", "due_at": "2026-11-24T09:00:00Z",
  "status": "pending", "entity_type": "task", "entity_id": "…", "notes": null,
  "snoozed_until": null, "created_at": "…", "updated_at": "…" }
```

### activity log
```json
{ "id": "…", "verb": "completed", "entity_type": "task", "entity_id": "…",
  "entity_title": "Write migration notes", "summary": "Completed “Write migration notes”",
  "project_id": "…", "href": "/projects/…", "actor": "owner", "created_at": "…" }
```

---

## Endpoints

### Health / meta
* `GET /health` → `{ "status": "ok", "version": "0.1.0", "workspace": "default", "database": "sqlite", "ai_enabled": false }`
* `GET /workspace` → workspace object
* `PATCH /workspace` → `{ "name?, "timezone?", "currency"? }` → workspace
* `GET /meta` → `{ "enums": {…all enumerations above…}, "counts": { "tasks": 42, … } }` (single
  source of truth for the frontend's selects and stats)

### Projects
* `GET /projects?status=&priority=&q=&sort=updated|target|name&limit=&offset=` →
  `{ "items": [project], "total": n }`
* `POST /projects` — required `name`; optional every project field except derived ones.
  `slug` uniqueness per workspace ⇒ 409 on duplicate name.
* `GET /projects/{id}` → project (with `task_counts`, `next_due`)
* `PATCH /projects/{id}` → project
* `DELETE /projects/{id}` → `204`. Cascade: tasks become `project_id = null` (they are *kept*),
  milestones are deleted. Response includes nothing; the UI reloads.
* `GET /projects/{id}/stats?today=` → `{ "total","done","open","overdue","due_today","pct","next_due","by_status":{…},"by_priority":{…} }`

### Tasks
* `GET /tasks?status=&priority=&project_id=&tag=&due=today|week|overdue|none|upcoming&q=&sort=due|priority|created|position&limit=200&offset=`
  → `{ "items": [task], "total": n, "limit": …, "offset": … }`
* `POST /tasks` — required `title`; optional `project_id, description, notes, parent_task_id,
  status, priority, due_date, start_date, estimated_minutes, actual_minutes, recurrence, tags`
* `GET /tasks/{id}` / `PATCH /tasks/{id}` / `DELETE /tasks/{id}`
* `POST /tasks/{id}/complete` → task (sets `status="done"`, `completed_at`). If `recurrence !=
  none`, a *new* task is created for the next due date and returned as
  `{ "task": done_task, "next": new_task }`.
* `POST /tasks/{id}/reopen` → task (`status="todo"`, `completed_at=null`)
* `POST /tasks/{id}/move` — `{ "status": "in_progress", "position": 2 }` → task (kanban drag)
* `POST /tasks/bulk` — `{ "ids": […], "action": "complete|delete|set_priority|set_project",
  "value": … }` → `{ "updated": n, "failed": [ {id, error} ] }`
* `POST /tasks/import` — `{ "raw": "…json or fenced json…", "project_id": null,
  "allow_duplicates": false }` → `{ "created": n, "duplicates": n, "rejected": [ {index, title, reason} ], "warnings": [ … ] }`.
  Accepts a bare array or `{tasks:[…]}`, code fences, prose around JSON, trailing commas, and
  alias keys (`name`→title, `deadline`/`due`→due_date, `done`/`status`→status, `desc`→description).
  Titles are generated ids-free: the server always assigns new UUIDs.

### Milestones
* `GET /milestones?project_id=&status=open|done` → `{ "items": [milestone], "total": n }`
* `POST /milestones` (required `project_id`, `title`, `date`) · `PATCH` · `DELETE`
* `POST /milestones/{id}/complete` | `POST /milestones/{id}/reopen`

### Notes
* `GET /notes?category=&tag=&q=&favorite=true&project_id=&sort=updated|created|title`
  → `{ "items": [note_summary], "total": n, "categories": [ {category, count} ] }`
* `POST /notes` (required `title`; optional `content, category, tags, project_id, is_favorite,
  relations[{target_type,target_id}]`) · `GET /notes/{id}` · `PATCH /notes/{id}` · `DELETE`
* `POST /notes/{id}/relations` · `DELETE /notes/{id}/relations/{relation_id}`
* `GET /note-tags` → `[ { "tag": "postgres", "count": 4 } ]`

### People
* `GET /contacts?q=&company_id=&tag=&limit=&offset=` → `{ "items": [contact], "total": n }`
* `POST/PATCH/DELETE /contacts{,/{id}}`
* `GET /companies` → `{ "items": [company], "total": n }` · `POST/PATCH/DELETE /companies{,/{id}}`

### Goals
* `GET /goals?status=&project_id=&q=` → `{ "items": [goal], "total": n }`
```json
{ "id": "…", "title": "Ship MyOS Phase 1", "description": "…", "category": "personal",
  "priority": "high", "status": "active", "progress": 40, "target_date": "2026-12-20",
  "project_id": "…", "project": { "id": "…", "name": "…", "status": "in_progress" },
  "completed_at": null, "created_at": "…", "updated_at": "…" }
```
* `POST /goals` (required `title`; optional `description, category, priority, status, progress`
  0–100, `target_date, project_id`) · `PATCH /goals/{id}` · `DELETE /goals/{id}`
* Setting `status=completed` stamps `completed_at`; moving away from it clears it. `progress`
  never silently overrides task-derived project progress — the two are independent.

### Search (global)
* `GET /search?q=&limit=8` →
```json
{ "query": "order",
  "groups": [ { "type": "tasks", "label": "Tasks", "href": "/tasks?q=order",
                "items": [ { "id", "title", "subtitle", "href", "badge" } ] } ],
  "total": 12 }
```
  Searches tasks, projects, notes, milestones, contacts, companies. SQLite `LIKE` on
  title/name/description/content, case-insensitive, ranked: exact › prefix › substring.
  `q` shorter than 2 chars ⇒ `{ "groups": [], "total": 0 }`.

### Dashboard
* `GET /dashboard?today=YYYY-MM-DD` →
```json
{ "today": "2026-11-21",
  "tasks": { "due_today": [task], "overdue": [task], "upcoming": [task],
             "completed_this_week": 7, "open": 23 },
  "projects": { "active": [project], "deadline_soon": [ { "id","name","target_date","days_left" } ] },
  "people": { "new_contacts_30d": 2 },
  "notes": { "recent": [note_summary] },
  "milestones": { "upcoming": [milestone] },
  "reminders": { "due": [reminder] },
  "notifications": { "unread": 3, "items": [notification] },
  "activity": [activity],
  "insights": [ { "kind": "overdue", "severity": "critical", "text": "3 tasks are overdue…" } ] }
```
`insights` are rule-based in Phase 1 (deterministic, unit-tested): overdue clusters, projects with
no task updated in 7+ days, projects past `target_date` but not completed, notes not linked to
anything, milestones within 7 days, empty-projects (no tasks).
`today` exists so the whole dashboard is testable without clock mocking.

### Notifications & reminders
* `GET /notifications?unread=true&limit=50` → `{ "items": [notification], "unread": n }`
* `POST /notifications/refresh` → regenerates derived notifications idempotently using
  `dedupe_key` (never duplicates an open one) → `{ "created": n, "resolved": n }`
* `PATCH /notifications/{id}` (`read`) · `POST /notifications/read-all` · `DELETE /notifications/{id}`
* `GET /reminders?status=pending` · `POST /reminders` · `PATCH /reminders/{id}` ·
  `DELETE /reminders/{id}` · `POST /reminders/{id}/complete` · `POST /reminders/{id}/snooze`
  (`{ "minutes": 60 }`)

### Activity
* `GET /activity?entity_type=&project_id=&days=7&limit=100` → `{ "items": [activity], "total": n }`

### System / settings
* `GET /export` → `application/json` full data dump `{ "exported_at", "workspace", "tables": {…} }`
* `POST /demo/seed` → `{ "created": {…counts…}, "skipped": bool }` — idempotent: if demo rows
  already exist it does nothing and returns `skipped: true`
* `POST /demo/reset` → wipes demo-created rows only (`source = 'demo'`) and reseeds. Guarded:
  409 unless `MYOS_ALLOW_DEMO_RESET=1`.

## Response rules the UI depends on

1. Lists are `{ "items": [...], "total": n }` — always that envelope.
2. A missing FK target (`project_id` pointing elsewhere) is a `422`, not a silent `null`.
3. `updated_at` changes on every write, so "recent activity" ordering is stable.
4. `GET` requests are read-only; they must never create notifications (that happens in
   `POST /notifications/refresh`, called by the UI on dashboard load and by the CLI).

## Deep-link contract (`href` on activity, notifications, insights and search items)

There is one link scheme, and it is query-based — the app has no `/tasks/[id]`, `/notes/[id]`
or `/contacts/[id]` routes (record detail is a dialog over the list). Routes are canonical:
MyOS is not a sub-app, so nothing may be emitted with the retired `/os/` prefix.

| record | href |
|---|---|
| task | `/tasks?task=<id>` |
| note | `/notes?note=<id>` |
| contact | `/contacts?contact=<id>` |
| milestone | `/projects/<project_id>` |
| project / goal | `/projects/<id>` / `/goals` |
| reminder, notification, company, workspace | the list page that shows it (`/notifications`, `/settings`) |
| cluster filters | `/tasks?filter=overdue`, `/projects?q=<term>` |
| search group headers | `/tasks?q=…`, `/projects?q=…`, `/notes?q=…`, `/contacts?q=…` |

`backend/app/services/links.py` is the only emitter, and `tests/test_links.py` sweeps every
stored string to prove no href starts with `/os` and none contains the literal `None`; a missing
project id falls back to the list page. `osHref()` in `lib/os/format.ts` normalises both the
canonical form and the retired prefixed form, because `activity_logs.href` and
`notifications.href` are historical snapshots written before the migration.
A wrong HTTP method on a known path answers `404 {"code":"not_found","message":"method not
allowed"}` — the API deliberately has no 405 body so the frontend has exactly one error shape.
`GET /meta` `counts` keys are explicit (`tasks_open`, `tasks_overdue`, `tasks_due_today`,
`tasks_done`, `activity`, …), validation `details` entries are
`{loc, field, msg, type}` with `body` omitted from `loc`, and `POST /demo/reset` returns the
same `{created, skipped}` body as `POST /demo/seed`.
