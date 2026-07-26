import { useEffect, useState } from 'react';

/**
 * §5 — desktop ≥ 1080px, tablet 880–1079 (compact rail),
 * narrow tablet 720–879 (single mail column), below 720 the width message.
 */
export type Breakpoint = 'desktop' | 'tablet' | 'narrow' | 'too-narrow';

function classify(width: number): Breakpoint {
  if (width < 720) return 'too-narrow';
  if (width < 880) return 'narrow';
  if (width < 1080) return 'tablet';
  return 'desktop';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    typeof window === 'undefined' ? 'desktop' : classify(window.innerWidth),
  );

  useEffect(() => {
    const onResize = () => setBp(classify(window.innerWidth));
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return bp;
}
