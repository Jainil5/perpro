import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/**
 * The app maps semantic utilities onto the `--os-*` CSS variables declared in
 * app/os.css, which components/Shell.tsx scopes with the `os-root` / `os-light`
 * classes — so light/dark is a class swap rather than a rewrite, the same
 * mechanism shadcn/ui uses, and MyOS and PerPro/legacy screens read one palette.
 *
 * Components write `bg-card`, `text-muted-foreground`, `border-line`,
 * `text-success`, … and never a raw hex value. Per docs/DESIGN.md the palette
 * is black/white/grey: `bg-primary` is white ink on canvas, the only hues left
 * are the three semantic tokens, and radius is 2px with no shadows — which is
 * why rounded-os-lg resolves to the same 2px as rounded-os rather than growing.
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
        'canvas-deep': token('canvas-deep'),

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
        'line-faint': token('line-faint'),
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
      /**
       * `border` / `divide-y` with no colour class resolve to the hairline
       * rather than currentColor. Doing it here is why app/os.css no longer
       * needs a `.os-root *{border-color}` rule: that rule out-specified every
       * `border-transparent` / `border-foreground` utility a component wrote.
       */
      borderColor: { DEFAULT: token('line') },
      divideColor: { DEFAULT: token('line') },
      borderRadius: {
        os: 'var(--os-radius)',
        'os-lg': 'var(--os-radius)',
        'os-sm': 'var(--os-radius)',
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
