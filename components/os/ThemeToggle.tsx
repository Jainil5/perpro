'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useId } from 'react'

import { cn } from '@/lib/os/cn'
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

export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useOsTheme()
  const id = useId()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`Theme: ${theme}. Change appearance`}
          variant="ghost"
          className={cn('text-muted-foreground', className)}
        >
          {theme === 'light' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-labelledby={id} className="w-52">
        <DropdownMenuLabel id={id}>Appearance</DropdownMenuLabel>
        {OPTIONS.map((option) => {
          const Icon = option.theme === 'light' ? Sun : Moon
          return (
            <DropdownMenuItem
              key={option.theme}
              onSelect={() => setTheme(option.theme)}
              className={cn(theme === option.theme && 'bg-accent text-accent-foreground')}
            >
              <Icon />
              <span className="flex-1">{option.label}</span>
              <span className="text-[11px] text-faint">{option.hint}</span>
            </DropdownMenuItem>
          )
        })}
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
