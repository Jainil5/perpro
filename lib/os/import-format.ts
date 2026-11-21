/**
 * Literal payload for `POST /tasks/import` (docs/MYOS/API.md). Shown verbatim
 * as the placeholder of the import textarea, copied by the "Copy JSON format"
 * button and embedded in the agent prompt.
 *
 * The trailing commas are deliberate: the contract says the importer tolerates
 * them, so the example proves it instead of hiding it.
 */

export const IMPORT_EXAMPLE = `{
  "tasks": [
    {
      "title": "Send the schema draft to Ravi",
      "priority": "high",
      "due_date": "2026-11-27",
      "status": "todo",
      "description": "Includes the RLS policy sketch.",
      "notes": "Wait for his OK before the migration.",
      "estimated_minutes": 45,
      "recurrence": "none",
      "tags": ["crm", "schema"],
    },
    {
      "title": "Weekly invoice run",
      "priority": "medium",
      "due_date": "2026-11-30",
      "status": "done",
      "recurrence": "weekly",
    },
  ]
}`

export const IMPORT_FIELDS_HELP = `- title              required — one imperative sentence
- priority           optional — low | medium | high | urgent
- status             optional — todo | in_progress | blocked | done | dropped
- due_date           optional — YYYY-MM-DD (never "next week")
- start_date         optional — YYYY-MM-DD
- description        optional — short summary of the work
- notes              optional — long form: decisions, constraints, acceptance criteria
- estimated_minutes  optional — integer
- actual_minutes     optional — integer
- recurrence         optional — none | daily | weekly | fortnightly | monthly
- tags               optional — array of strings
- project_id         optional — usually left out; pick a project in the dialog instead

Alias keys are accepted: "name"→title, "deadline"/"due"→due_date,
"desc"→description. A bare array of task objects works as well as {"tasks":[…]},
and code fences or prose around the JSON are ignored. Any "id" is dropped — the
server always assigns fresh UUIDs, so the same JSON can be imported twice.`

/** Instructions for an agent that produces task JSON for MyOS. */
export function agentPrompt(projectName?: string | null): string {
  const scope = projectName
    ? `Add tasks to the "${projectName}" project in MyOS.`
    : 'Add tasks to my MyOS workspace.'
  return `${scope} Reply with JSON only — no prose, no markdown fence — in exactly this shape:

${IMPORT_EXAMPLE}

Rules:
${IMPORT_FIELDS_HELP}
- trailing commas are tolerated, so keep the shape above exactly
- use lowercase enum values exactly as written; unknown values are rejected
- every title is a standalone imperative sentence
- put decisions, constraints and acceptance criteria in "notes", not in the title
- completed work comes back with "status": "done"
- use real YYYY-MM-DD due dates, never "soon" or "next week"
- aim for 8–20 tasks, grouped so they can be worked through in order`
}
