'use client'

import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/os/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-line bg-card text-card-foreground shadow-os', className)} {...props} />
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-start justify-between gap-3 px-4 pt-4 pb-2', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('font-os-display text-[13px] font-semibold tracking-tight', className)} {...props} />
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-0.5 text-xs text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-4 pb-4', className)} {...props} />
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-t border-line px-4 py-3', className)} {...props} />
}

/** Card with a title + action slot in the header — the shape MyOS panels use. */
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
        <CardHeader className={cn(dense && 'px-3.5 pt-3 pb-1.5')}>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              {icon ? <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">{icon}</span> : null}
              <span className="truncate">{title}</span>
            </CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
        </CardHeader>
      )}
      <div className={cn('min-w-0 flex-1 px-4 pb-4', dense && 'px-3.5 pb-3', bodyClassName)}>{children}</div>
    </Card>
  )
}
