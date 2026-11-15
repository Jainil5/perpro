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
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 28,
      }}
      reducedMotion={reducedMotion ? 'user' : undefined}
    >
      {children}
    </MotionConfig>
  );
}