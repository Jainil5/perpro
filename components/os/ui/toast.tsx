'use client'

import { Toaster, toast } from 'sonner'
import type { CSSProperties } from 'react'

/**
 * Thin sonner wrapper so MyOS screens all raise toasts the same way and pick up
 * the `.os-root` tokens instead of sonner's defaults.
 */
export { toast }

export const toastError = (message: string, opts?: { description?: string }) =>
  toast.error(message, { description: opts?.description, duration: 6000 })

export const toastSuccess = (message: string, opts?: { description?: string; action?: { label: string; onClick: () => void } }) =>
  toast.success(message, opts ? { description: opts.description, action: opts.action } : undefined)

export function OsToaster({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'os-root !rounded-lg !border !border-line !bg-card !text-card-foreground !shadow-os-lg !text-[13px] group-[.destructive]:!border-destructive/40',
          description: '!text-muted-foreground',
          actionButton: '!bg-primary !text-primary-foreground !rounded-md !text-[12px]',
          cancelButton: '!bg-muted !text-muted-foreground !rounded-md !text-[12px]',
          error: '!text-destructive',
          success: '!text-success',
          info: '!text-info',
          warning: '!text-warning',
        },
      }}
      style={
        {
          '--normal-bg': 'hsl(var(--os-card))',
          '--normal-text': 'hsl(var(--os-foreground))',
          '--normal-border': 'hsl(var(--os-line))',
        } as CSSProperties
      }
    />
  )
}
