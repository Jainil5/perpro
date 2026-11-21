'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'

/**
 * Dialog chrome: canvas + one hairline + 2px radius. The overlay is a flat 60%
 * black (no blur, no gradient) and the only motion is opacity, because this
 * language has no elevation to animate (docs/DESIGN.md rule 3, rule 7).
 */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export const DialogPortal = ({ ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>) => (
  <DialogPrimitive.Portal {...props} />
)

export function DialogOverlay({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        'fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  )
}

const SIZES = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-xl',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
  full: 'sm:max-w-[min(96rem,96vw)]',
} as const

export function DialogContent({
  className,
  children,
  size = 'md',
  hideClose,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  size?: keyof typeof SIZES
  hideClose?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[92dvh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-os border border-line bg-background text-foreground',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
          SIZES[size],
          className
        )}
        {...props}
      >
        {children}
        {!hideClose ? (
          <DialogPrimitive.Close
            aria-label="Close dialog"
            className="absolute right-1.5 top-1.5 z-10 inline-flex size-8 items-center justify-center rounded-os border !border-transparent text-muted-foreground transition-colors duration-150 hover:!border-line hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

export function DialogHeader({ title, description, className, children }: {
  title?: ReactNode
  description?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <div className={cn('shrink-0 border-b border-line px-4 py-3 pr-12', className)}>
      {title ? (
        // The label lives on a child span so `.os-root h2` cannot out-specify it.
        <DialogPrimitive.Title className="min-w-0">
          <span className="os-label block truncate">{title}</span>
        </DialogPrimitive.Title>
      ) : null}
      {description ? (
        <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
          {description}
        </DialogPrimitive.Description>
      ) : (
        // Radix warns when a dialog has no description; this keeps it accessible.
        <DialogPrimitive.Description className="sr-only">Dialog</DialogPrimitive.Description>
      )}
      {children}
    </div>
  )
}

export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4', className)}>{children}</div>
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3',
        className
      )}
    >
      {children}
    </div>
  )
}
