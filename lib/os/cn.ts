import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware className join used by every MyOS primitive. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
