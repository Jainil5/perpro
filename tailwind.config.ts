import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/**
 * MyOS maps semantic utilities onto the `--os-*` CSS variables declared in
 * app/os.css (scoped to `.os-root`), so light/dark is a class swap rather than a
 * rewrite — the same mechanism shadcn/ui uses. Because the variables only exist
 * under `.os-root`, these utilities are inert on the PerPro screens, which keep
 * their own tokens from app/globals.css.
 *
 * MyOS components therefore write `bg-card`, `text-muted-foreground`,
 * `border-line`, `text-success`, … and never a raw hex value.
 */
const token = (name: string) => `hsl(var(--os-${name}) / <alpha-value>)`

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: token('background'),
        foreground: token('foreground'),
        card: token('card'),
        'card-foreground': token('foreground'),
        elevated: token('elevated'),
        popover: token('popover'),
        'popover-foreground': token('foreground'),
        sidebar: token('sidebar'),

        primary: token('primary'),
        'primary-foreground': token('primary-foreground'),
        secondary: token('secondary'),
        'secondary-foreground': token('foreground'),
        muted: token('muted'),
        'muted-foreground': token('muted-foreground'),
        accent: token('accent'),
        'accent-foreground': token('foreground'),

        border: token('line'),
        'border-strong': token('line-strong'),
        line: token('line'),
        'line-strong': token('line-strong'),
        faint: token('faint'),
        input: token('input'),
        ring: token('ring'),

        destructive: token('danger'),
        'destructive-foreground': token('on-danger'),
        danger: token('danger'),
        success: token('success'),
        warning: token('warn'),
        info: token('info'),
        ai: token('ai'),
      },
      borderRadius: {
        os: 'var(--os-radius)',
        'os-lg': 'calc(var(--os-radius) + 4px)',
        'os-sm': 'calc(var(--os-radius) - 2px)',
      },
      fontFamily: {
        'os-display': ['var(--os-font-display)'],
        'os-body': ['var(--os-font-body)'],
        'os-mono': ['var(--os-font-mono)'],
      },
      boxShadow: {
        os: 'var(--os-shadow)',
        'os-lg': 'var(--os-shadow-lg)',
      },
    },
  },
  // the shipped type declaration for tailwindcss-animate is intentionally minimal
  plugins: [animate as unknown as NonNullable<Config['plugins']>[number]],
}

export default config
