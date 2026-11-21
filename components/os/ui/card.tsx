'use client'

import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'

/**
 * A panel in this language is a hairline on the canvas — `.os-panel` from
 * app/os.css (1px line, 2px radius, no fill, no shadow). The header of a panel
 * is an `.os-label` line, not a title block.
 *
 * `CardTitle` renders its text inside a span because `app/os.css` styles
 * `.os-root h1/h2/h3` directly (display face, ink, tight tracking); a class on
 * the heading itself would lose that specificity contest, a class on the child
 * inherits nothing it should not.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('os-panel min-w-0 text-foreground', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-3 border-b border-line px-3 py-2', className)} {...props} />
}

export function CardTitle({ className, children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('min-w-0', className)} {...props}>
      <span className="os-label block truncate">{children}</span>
    </h3>
  )
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-0.5 text-xs text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-3 py-3', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5', className)} {...props} />
}

/** Panel with a title + action slot in the header — the shape MyOS screens use. */
export function Panel({
  title,
  description,
  action,
  icon,
  children,
  className,
  bodyClassName,
  dense,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  dense?: boolean
}) {
  return (
    <Card className={cn('flex h-full min-w-0 flex-col', className)}>
      {(title || action) && (
        <CardHeader className={cn(dense && 'px-3 py-1.5')}>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {icon ? (
                <span aria-hidden className="os-label flex shrink-0 items-center [&_svg]:size-3.5">
                  {icon}
                </span>
              ) : null}
              {title ? <CardTitle>{title}</CardTitle> : null}
            </div>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
        </CardHeader>
      )}
      <div className={cn('min-w-0 flex-1 px-3 py-3', dense && 'px-3 py-2.5', bodyClassName)}>{children}</div>
    </Card>
  )
}
