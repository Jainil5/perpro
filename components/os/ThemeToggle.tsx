'use client'

import { Monitor } from 'lucide-react'
import { useId } from 'react'

import { cn } from '@/lib/os/cn'
import { HalfDisc } from './marks'
import { IconButton } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { THEME_STORAGE_KEY, useOsTheme, type OsTheme } from './os-bootstrap'

const OPTIONS: { theme: OsTheme; label: string; hint: string }[] = [
  { theme: 'dark', label: 'Dark', hint: 'The default console look' },
  { theme: 'light', label: 'Light', hint: 'For bright rooms and printing' },
]

/**
 * The theme control as the reference's half-disc: one circle, half ink, half
 * void, sitting on the header hairline. It is the only place the two themes are
 * ever shown at once, so no Sun/Moon glyph is needed. The menu keeps Radix's
 * keyboard contract; the chosen theme is named in the accessible label and the
 * tooltip, and marked in the list with ink + `aria-current` rather than a pill.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useOsTheme()
  const id = useId()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`Theme: ${theme}. Change appearance`}
          variant="ghost"
          className={cn('text-muted-foreground hover:text-foreground', className)}
        >
          <HalfDisc className="shrink-0" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-labelledby={id} className="w-56">
        <DropdownMenuLabel id={id}>Appearance</DropdownMenuLabel>
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.theme}
            onSelect={() => setTheme(option.theme)}
            aria-current={theme === option.theme ? 'true' : undefined}
            className={cn(theme === option.theme && 'text-foreground')}
          >
            <HalfDisc className={cn('shrink-0', option.theme === 'light' && 'rotate-180')} />
            <span className="flex-1">{option.label}</span>
            <span className="os-micro max-w-[7rem] truncate">{option.hint}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            // "System" forgets the choice and follows prefers-color-scheme again.
            try {
              window.localStorage.removeItem(THEME_STORAGE_KEY)
            } catch {
              /* ignore */
            }
            const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches
            setTheme(prefersLight ? 'light' : 'dark')
          }}
        >
          <Monitor />
          <span className="flex-1">Use system setting</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
