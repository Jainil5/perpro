'use client'

import { Copy, Download, FileJson, ListChecks } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/os/cn'
import { copyText } from '@/lib/clipboard'
import { errorMessage } from '@/lib/os/client'
import { generalError } from '@/lib/os/forms'
import { useCreate } from '@/lib/os/hooks'
import { agentPrompt, IMPORT_EXAMPLE, IMPORT_FIELDS_HELP } from '@/lib/os/import-format'
import type { ImportInput, ImportResult } from '@/lib/os/types'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../ui/dialog'
import { Field } from '../ui/label'
import { CodeArea } from '../ui/textarea'
import { Switch } from '../ui/switch'
import { ProjectSelect } from '../pickers'
import { toastError, toastSuccess } from '../ui/toast'
import { TASK_SCOPE } from './TaskDialog'

/**
 * `POST /tasks/import`. The textarea placeholder is the literal payload shape
 * from API.md — trailing commas included — because the server, not the browser,
 * does the parsing and repair.
 */
export function ImportTasksDialog({
  open,
  onOpenChange,
  defaultProjectId,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultProjectId?: string | null
  onImported?: (result: ImportResult) => void
}) {
  const [raw, setRaw] = useState('')
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null)
  const [allowDuplicates, setAllowDuplicates] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const create = useCreate<ImportResult, ImportInput>('/tasks/import', {
    invalidates: TASK_SCOPE,
  })

  function close(next: boolean) {
    onOpenChange(next)
    if (!next) {
      setResult(null)
      create.reset()
    }
  }

  async function run() {
    if (!raw.trim()) {
      toastError('Nothing to import', { description: 'Paste task JSON into the box first.' })
      return
    }
    try {
      const res = await create.mutate({
        raw,
        project_id: projectId,
        allow_duplicates: allowDuplicates,
      })
      setResult(res)
      if (res.created) toastSuccess(`Imported ${res.created} task${res.created === 1 ? '' : 's'}`)
      onImported?.(res)
    } catch (e) {
      setResult(null)
      toastError(generalError(create.error, ['raw']) ?? errorMessage(e))
    }
  }

  async function copy(text: string, label: string) {
    const ok = await copyText(text)
    if (ok) toastSuccess(label)
    else toastError('Clipboard blocked by the browser', { description: 'Select and copy manually.' })
  }

  const banner = generalError(create.error, ['raw', 'project_id'])
  const failed = create.error?.details ?? []

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="xl">
        <DialogHeader
          title="Import tasks from JSON"
          description="Paste JSON from an agent, a spreadsheet export or a previous import. The server parses it — code fences, prose and trailing commas are all accepted."
        />
        <DialogBody className="space-y-4">
          {banner ? (
            <p
              role="alert"
              className="rounded-os border border-line px-3 py-2 text-xs text-danger"
            >
              {banner}
            </p>
          ) : null}
          {failed.length ? (
            <ul className="os-mono space-y-0.5 text-[11px] text-danger">
              {failed.map((d, i) => (
                <li key={`${d.field}-${i}`}>
                  {d.field ? `${d.field}: ` : ''}
                  {d.message}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copy(IMPORT_EXAMPLE, 'Copied the JSON format')}
              className="rounded-os bg-transparent"
            >
              <FileJson /> Copy JSON format
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copy(agentPrompt(null), 'Copied the prompt for an agent')}
              className="rounded-os bg-transparent"
            >
              <Copy /> Copy prompt for an agent
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copy(IMPORT_FIELDS_HELP, 'Copied the field reference')}
              className="rounded-os"
            >
              <Download /> Copy field reference
            </Button>
            <span className="os-micro ml-auto">
              {raw.trim() ? `${raw.trim().split(/\n/).length} lines ready` : 'Empty — paste or write JSON'}
            </span>
          </div>

          <Field
            label="Task JSON"
            htmlFor="import-raw"
            hint={'bare array or {"tasks": […]} — ids are always reassigned here'}
          >
            <CodeArea
              id="import-raw"
              className="min-h-[300px]"
              value={raw}
              spellCheck={false}
              placeholder={IMPORT_EXAMPLE}
              onChange={(event) => setRaw(event.target.value)}
              aria-describedby="import-format-note"
            />
          </Field>
          <p id="import-format-note" className="os-micro">
            The placeholder above is the exact accepted shape, trailing commas included — clear it and
            paste your own.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Add to project" hint="leave empty for unassigned">
              <ProjectSelect value={projectId} onChange={setProjectId} />
            </Field>
            <div className="flex items-end pb-1">
              <SwitchRowish
                checked={allowDuplicates}
                onCheckedChange={setAllowDuplicates}
                label="Allow duplicate titles"
                description="Off: a task with the same title in the same project is reported as a duplicate instead of created twice."
              />
            </div>
          </div>

          {result ? <ImportSummary result={result} /> : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => close(false)}
            disabled={create.pending}
            className="rounded-os border border-line bg-transparent hover:bg-transparent"
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={() => void run()} loading={create.pending} disabled={!raw.trim()} className="rounded-os">
            <ListChecks /> Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Result panel: created / duplicates / rejected / warnings, exactly as returned. */
export function ImportSummary({ result }: { result: ImportResult }) {
  const rejected = result.rejected ?? []
  const warnings = result.warnings ?? []
  if (!result.created && !rejected.length && !warnings.length && !result.duplicates) {
    return (
      <p className="rounded-os border border-line px-3 py-2 text-xs text-muted-foreground">
        Nothing was created. Check the JSON against the format above.
      </p>
    )
  }
  return (
    <div className="min-w-0 space-y-4 rounded-os border border-line p-3">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        <Count n={result.created} label="created" />
        <Count n={result.duplicates} label="duplicates" />
        <Count n={rejected.length} label="rejected" tone={rejected.length ? 'text-danger' : undefined} />
        <Count n={warnings.length} label="warnings" tone={warnings.length ? 'text-warning' : undefined} />
      </div>
      {rejected.length ? (
        <div>
          <p className="os-label mb-1.5">Rejected</p>
          <ul className="space-y-1">
            {rejected.map((item) => (
              <li key={`${item.index}-${item.title ?? ''}`} className="flex gap-2 text-xs">
                <span className="os-mono shrink-0 text-[11px] text-danger">#{item.index}</span>
                <span className="min-w-0">
                  <span className="text-foreground">{item.title || 'untitled'}</span>{' '}
                  <span className="text-muted-foreground">{item.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length ? (
        <div>
          <p className="os-label mb-1.5">Warnings</p>
          <ul className="os-mono space-y-1 text-[11px] text-muted-foreground">
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function Count({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('os-mono text-[13px] text-foreground', tone)}>{n}</span>
      <span className="os-label os-label-faint">{label}</span>
    </span>
  )
}

/** Local label+switch row so the import dialog stays self-contained. */
function SwitchRowish({
  checked,
  onCheckedChange,
  label,
  description,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  label: string
  description: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block text-[13px] text-foreground">{label}</span>
        <span className="os-micro mt-0.5 block">{description}</span>
      </span>
    </label>
  )
}
