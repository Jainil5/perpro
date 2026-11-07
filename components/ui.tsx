'use client';

import { ReactNode } from 'react';

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
    ghost: 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800',
    danger: 'border border-red-900 text-red-400 hover:bg-red-950',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`max-h-[90vh] w-full overflow-y-auto rounded-t-2xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
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
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 px-6 py-10 text-center">
      <p className="text-sm text-zinc-400">{title}</p>
      {hint && <p className="mt-1 text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
      {message}
      {message.includes('does not exist') || message.includes('schema cache') ? (
        <span className="mt-1 block text-xs text-red-400/80">
          Run supabase/schema.sql in the Supabase SQL Editor first.
        </span>
      ) : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-zinc-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-indigo-500" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-zinc-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">{children}</span>
  );
}