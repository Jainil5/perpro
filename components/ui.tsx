'use client';

import { ReactNode, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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
    primary: 'bg-[var(--accent-brand)] text-white hover:bg-[var(--accent-brand-hover)]',
    secondary: 'bg-[var(--bg-elevated)] text-[var(--fg-primary)] border border-[var(--fg-subtle)] hover:bg-[var(--fg-subtle)]',
    ghost: 'border border-[var(--fg-subtle)] text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]',
    danger: 'border border-[var(--accent-critical)] bg-[var(--accent-critical)]/10 text-[var(--accent-critical)] hover:bg-[var(--accent-critical)]/20',
    ai: 'bg-[var(--accent-ai)] text-white hover:bg-[var(--accent-ai)]/90',
  };

  const isDisabled = disabled || loading;

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      whileTap={{ scale: 0.97 }}
      whileHover={!isDisabled ? { scale: 1.02 } : undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      style={loading ? { width: 'var(--button-width, auto)' } : undefined}
    >
      {loading && (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
          className="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      <span>{children}</span>
    </motion.button>
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
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.96 }}
          transition={{ duration: 0.3, type: 'spring', stiffness: 400, damping: 30 }}
          className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-[var(--fg-subtle)] bg-[var(--bg-surface)] p-5 shadow-2xl ${sizeClasses[size]}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--fg-primary)]">{title}</h2>
            <motion.button
              onClick={onClose}
              aria-label="Close"
              whileTap={{ scale: 0.9 }}
              whileHover={{ scale: 1.1 }}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </motion.button>
          </div>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <motion.label
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="block"
    >
      <span className="mb-1 block text-subheading text-[var(--fg-muted)]">{label}</span>
      {children}
    </motion.label>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-xl border border-dashed border-[var(--fg-subtle)] px-6 py-10 text-center"
    >
      <p className="text-body text-[var(--fg-muted)]">{title}</p>
      {hint && <p className="mt-1 text-body-sm text-[var(--fg-subtle)]">{hint}</p>}
    </motion.div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="mb-4 rounded-lg border border-[var(--accent-critical)] bg-[var(--accent-critical)]/10 px-4 py-3 text-body text-[var(--accent-critical)]"
    >
      {message}
      {message.includes('does not exist') || message.includes('schema cache') ? (
        <span className="mt-1 block text-body-sm text-[var(--accent-critical)]/80">
          Run supabase/schema.sql in the Supabase SQL Editor first.
        </span>
      ) : null}
    </motion.div>
  );
}

export function Spinner({ label, variant = 'default' }: { label?: string; variant?: 'default' | 'ai' }) {
  const variants = {
    default: 'border-zinc-600 border-t-[var(--accent-brand)]',
    ai: 'border-[var(--fg-subtle)] border-t-[var(--accent-ai)]',
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-2 py-8 text-sm text-[var(--fg-muted)]"
    >
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
        className={`h-4 w-4 rounded-full border-2 ${variants[variant]}`}
      />
      {label ?? 'Loading…'}
    </motion.div>
  );
}

export function PageHeader({ title, sub, action, count }: { title: string; sub?: ReactNode; action?: ReactNode; count?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="mb-6 flex flex-wrap items-center justify-between gap-3"
    >
      <div>
        <motion.h1
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="text-h1"
        >
          {title}
        </motion.h1>
        {sub && (
          <motion.p
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
            className="mt-0.5 text-body-sm text-[var(--fg-muted)]"
          >
            {sub}
          </motion.p>
        )}
        {typeof count === 'number' && (
          <motion.span
            key={count}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="ml-2 inline-flex h-5 items-center rounded-full bg-[var(--accent-brand)]/20 px-2 text-[10px] font-medium text-[var(--accent-brand)]"
          >
            {count}
          </motion.span>
        )}
      </div>
      {action}
    </motion.div>
  );
}

export function Tag({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, delay }}
      whileHover={{ scale: 1.05 }}
      className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--fg-muted)]"
    >
      {children}
    </motion.span>
  );
}

export function ProgressRing({ size = 16 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </motion.svg>
  );
}