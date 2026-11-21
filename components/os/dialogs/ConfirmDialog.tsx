'use client'

import { useState, type ReactNode } from 'react'

import { errorMessage } from '@/lib/os/client'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Field } from '../ui/label'
import { toastError } from '../ui/toast'

/**
 * The one confirmation MyOS uses for destructive actions.
 * `requireText` turns it into a type-to-confirm dialog (used for project
 * deletion, which cascades to milestones).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  tone = 'destructive',
  requireText,
  onConfirm,
  onConfirmed,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  tone?: 'destructive' | 'default'
  /** The exact string the user must type to enable the confirm button. */
  requireText?: string
  onConfirm: () => Promise<unknown> | unknown
  onConfirmed?: () => void
  children?: ReactNode
}) {
  const [typed, setTyped] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blocked = requireText !== undefined && typed.trim() !== requireText

  async function confirm() {
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      setTyped('')
      onOpenChange(false)
      onConfirmed?.()
    } catch (e) {
      setError(errorMessage(e))
      toastError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTyped('')
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent size="sm" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader title={title} description={description} />
        <DialogBody className="space-y-3">
          {children}
          {requireText !== undefined ? (
            <Field
              label={`Type “${requireText}” to confirm`}
              htmlFor="os-confirm-text"
              error={error}
            >
              <Input
                id="os-confirm-text"
                value={typed}
                autoComplete="off"
                spellCheck={false}
                placeholder={requireText}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !blocked) void confirm()
                }}
              />
            </Field>
          ) : error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="rounded-os border border-line bg-transparent hover:bg-transparent"
          >
            Cancel
          </Button>
          {/* Danger is hairline + red ink, never a red fill (DESIGN §4). */}
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            onClick={() => void confirm()}
            loading={pending}
            disabled={blocked}
            className={
              tone === 'destructive'
                ? 'rounded-os border border-line bg-transparent text-danger shadow-none hover:bg-transparent hover:text-danger'
                : 'rounded-os'
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
