'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import OsSearch from './OsSearch'
import OsSidebar from './OsSidebar'
import OsTopBar from './OsTopBar'
import { QuickCreateProvider } from './QuickCreate'
import { syncThemeRoots, useOsTheme } from './os-bootstrap'
import { OsToaster } from './ui/toast'
import { TooltipProvider } from './ui/tooltip'

/**
 * Client shell for every /os route: the `.os-root` wrapper the token contract
 * expects, the module rail (desktop) or drawer (mobile), the top bar, the ⌘K
 * palette, quick-create dialogs and the toast layer.
 */
export default function OsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [theme] = useOsTheme()
  const [navOpen, setNavOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Mirror the theme class onto the wrapper as soon as it exists.
  useEffect(() => {
    syncThemeRoots()
  }, [])

  // ⌘K / Ctrl+K opens the palette from anywhere; Escape closes the drawer.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        setNavOpen(false)
        return
      }
      if (event.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={300}>
      <QuickCreateProvider>
        <div className="os-root flex min-h-dvh bg-background text-foreground">
          <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-line md:flex lg:w-64">
            <OsSidebar />
          </aside>

          {navOpen ? (
            <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Navigation">
              <button
                type="button"
                aria-label="Close navigation"
                className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
                onClick={() => setNavOpen(false)}
              />
              <div className="os-enter absolute inset-y-0 left-0 w-[min(17rem,84vw)] border-r border-line bg-sidebar shadow-os-lg">
                <OsSidebar onNavigate={() => setNavOpen(false)} />
              </div>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <OsTopBar
              navOpen={navOpen}
              onToggleNav={() => setNavOpen((open) => !open)}
              onOpenPalette={() => setPaletteOpen(true)}
            />
            <main className="min-w-0 flex-1 px-3 py-4 md:px-6 md:py-6">{children}</main>
          </div>
        </div>

        <OsSearch open={paletteOpen} onOpenChange={setPaletteOpen} />
        <OsToaster theme={theme} />
      </QuickCreateProvider>
    </TooltipProvider>
  )
}
