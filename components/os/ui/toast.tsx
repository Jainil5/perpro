'use client'

import { Toaster, toast } from 'sonner'
import type { CSSProperties } from 'react'

/**
 * Thin sonner wrapper so MyOS screens all raise toasts the same way and pick up
 * the `.os-root` tokens instead of sonner's defaults.
 *
 * Sonner styles its toast from its own CSS variables, so the overrides have to
 * be important. The result is the app's chrome: canvas, one hairline, 2px
 * radius, no elevation, and colour only on the semantic kinds.
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
            'os-root !rounded-os !border !border-line !bg-background !text-[13px] !shadow-none group-[.destructive]:!border-destructive/50',
          title: '!text-foreground !font-medium',
          description: '!text-muted-foreground',
          actionButton: '!rounded-os !bg-primary !text-primary-foreground !text-[12px] !shadow-none',
          cancelButton: '!rounded-os !border !border-line !bg-transparent !text-muted-foreground !text-[12px] !shadow-none',
          closeButton: '!rounded-os !border !border-line !bg-transparent !text-muted-foreground',
          error: '!text-destructive',
          success: '!text-success',
          info: '!text-muted-foreground',
          warning: '!text-warning',
        },
      }}
      style={
        {
          '--normal-bg': 'hsl(var(--os-background))',
          '--normal-text': 'hsl(var(--os-foreground))',
          '--normal-border': 'hsl(var(--os-line))',
        } as CSSProperties
      }
    />
  )
}
