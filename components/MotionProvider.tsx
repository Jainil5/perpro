'use client';

import { MotionConfig } from 'framer-motion';
import { useEffect, useState } from 'react';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

export default function MotionProvider({ children }: { children: React.ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(reducedMotionQuery);
    setReducedMotion(mql.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, []);

  return (
    <MotionConfig
      /* docs/DESIGN.md rule 7: one short ease, no springs. Nothing in this
         language bounces or overshoots; movement is a 150ms opacity/colour move
         on the same curve app/os.css gives every hover. */
      transition={{
        duration: 0.15,
        ease: [0.2, 0.8, 0.2, 1],
      }}
      reducedMotion={reducedMotion ? 'user' : 'never'}
    >
      {children}
    </MotionConfig>
  );
}