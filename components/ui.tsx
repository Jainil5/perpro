'use client';

import { ReactNode } from 'react';
import { GridField, MicroData } from '@/components/os/marks';

/**
 * PerPro's own form/button primitives, restyled to the ONE language the app now
 * speaks (docs/DESIGN.md): hairlines instead of cards, 2px radius, no shadows,
 * no blur, no scale or spring motion, and colour reserved for state only.
 *
 * They read the same semantic utilities the MyOS primitives use
 * (bg-background, text-muted-foreground, border-line, text-danger …), so both
 * screen sets resolve from one palette.
 */

const BUTTON_BASE =
  'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-os border px-3 text-[13px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  loading,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
  type?: 'button' | 'submit';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const styles = {
    /* primary = white ink on canvas (DESIGN.md §4) */
    primary: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'border-line text-foreground hover:border-line-strong',
    ghost: 'border-line text-muted-foreground hover:border-line-strong hover:text-foreground',
    /* danger stays a hairline with red ink — never a red fill */
    danger: 'border-line text-danger hover:border-danger',
    /* the old "AI" fill is gone: nothing is purple any more */
    ai: 'border-line text-foreground hover:border-line-strong',
  };

  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`${BUTTON_BASE} ${styles[variant]} ${className}`}
    >
      {loading && <SpinnerGlyph />}
      <span>{children}</span>
    </button>
  );
}

/** 1px-stroke rotating arc — the only motion a control is allowed here. */
function SpinnerGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="animate-spin shrink-0 text-current"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({
  title,
  onClose,
  children,
  size = 'default',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'default' | 'wide' | 'full';
}) {
  const sizeClasses = {
    default: 'sm:max-w-md',
    wide: 'sm:max-w-2xl',
    full: 'sm:max-w-4xl',
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`os-enter max-h-[90vh] w-full overflow-y-auto rounded-os border border-line bg-background p-5 ${sizeClasses[size]}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="os-label pt-1">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex min-h-[40px] w-9 shrink-0 items-center justify-center rounded-os border border-transparent text-muted-foreground transition-colors hover:border-line hover:text-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="os-label mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

/** DESIGN.md §4: a bounded grid field, one display sentence, a mono hint. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="os-enter py-8">
      <GridField height={72} className="mx-auto max-w-3xl">
        <div className="flex h-full flex-col items-start justify-center gap-2 px-1">
          <p className="os-display text-[clamp(1.5rem,4vw,2rem)]">{title}</p>
          {hint && <p className="os-micro">{hint}</p>}
        </div>
      </GridField>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="os-enter mb-4 border-y border-line px-3 py-2.5 text-[13px] text-danger">
      {message}
      {message.includes('does not exist') || message.includes('schema cache') ? (
        <p className="os-micro mt-1 text-danger/80">
          Run supabase/schema.sql in the Supabase SQL Editor first.
        </p>
      ) : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string; variant?: 'default' | 'ai' }) {
  return (
    <div className="flex items-center gap-2 py-8 text-[13px] text-muted-foreground" role="status">
      <SpinnerGlyph />
      {label ?? 'Loading…'}
    </div>
  );
}

/** The one page skeleton every screen uses: eyebrow, title, mono data line. */
export function PageHeader({
  title,
  sub,
  action,
  count,
  eyebrow,
  data,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  count?: number;
  eyebrow?: string;
  data?: Array<string | null | undefined | false>;
}) {
  return (
    <div className="mb-6 border-b border-line pb-5">
      {eyebrow ? <p className="os-label">{eyebrow}</p> : null}
      <div className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-3 ${eyebrow ? 'mt-2' : ''}`}>
        <div className="min-w-0">
          <h1 className="os-title">{title}</h1>
          {sub ? <p className="mt-2 text-[13px] text-muted-foreground">{sub}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          {count != null || data?.length ? (
            <MicroData items={count != null ? [`${count} today`, ...(data ?? [])] : data ?? []} />
          ) : null}
          {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Tags are plain hairline text now — colour is reserved for state. */
export function Tag({ children }: { children: ReactNode; delay?: number }) {
  return (
    <span className="os-micro rounded-os border border-line px-1.5 py-0.5 normal-case tracking-normal">
      {children}
    </span>
  );
}

export function ProgressRing({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
