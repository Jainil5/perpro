'use client'

import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'

/**
 * Button chrome for the Studio—BA language (docs/DESIGN.md §4).
 *
 * Primary is a solid disc of ink on the canvas; everything else is a hairline.
 * No shadow, no scale, no gradient: hover/focus only changes ink and the line.
 * Timing comes from `app/os.css` (`.os-root *`), so 150ms is enough here.
 *
 * `data-size` is what `app/os.css` keys the 44px mobile tap target off
 * (`button[data-size='icon']`), so every button carries it.
 */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-os font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        /** a disc of ink: white on canvas, black on white */
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        /** transparent + 1px hairline */
        secondary: 'border border-line bg-transparent text-muted-foreground hover:border-line-strong hover:text-foreground',
        outline: 'border border-line bg-transparent text-foreground hover:border-line-strong',
        /**
         * No line until you point at it, then a hairline appears. The `!` pair is
         * deliberate: `app/os.css` paints `--os-line` on every border in
         * `.os-root`, and an ordinary utility would tie with it and lose on source
         * order, so both states of this one control are declared important.
         */
        ghost: 'border !border-transparent bg-transparent text-muted-foreground hover:!border-line hover:text-foreground',
        /** hairline + danger ink, never a red fill */
        destructive: 'border !border-destructive/50 bg-transparent text-destructive hover:!border-destructive',
        success: 'border !border-success/50 bg-transparent text-success hover:!border-success',
        link: 'bg-transparent text-foreground underline decoration-line-strong underline-offset-4 hover:decoration-foreground',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-9 px-3.5 text-[13px]',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  children?: ReactNode
  /** Shows a spinner and blocks double submission. */
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-size={size ?? 'md'}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Spinner size={size === 'sm' || size === 'icon-sm' ? 12 : 14} /> : null}
      {children}
    </button>
  )
})

/** Spinning arc used by buttons and inline actions — 1px stroke, current ink. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn('animate-spin shrink-0', className)}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

/** Icon-only button: `label` is required so it is never announced as unnamed. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'children'> & { label: string; children: ReactNode }
>(function IconButton(
  { label, className, variant = 'ghost', size = 'icon', children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={props.type ?? 'button'}
      aria-label={label}
      title={label}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  )
})
