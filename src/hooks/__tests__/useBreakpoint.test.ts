import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBreakpoint } from '../useBreakpoint';
import { setViewportWidth } from '../../test/setup';

afterEach(() => setViewportWidth(1440));

describe('useBreakpoint (§5)', () => {
  it.each([
    [640, 'too-narrow'],
    [719, 'too-narrow'],
    [720, 'narrow'],
    [879, 'narrow'],
    [880, 'tablet'],
    [1079, 'tablet'],
    [1080, 'desktop'],
    [2560, 'desktop'],
  ])('%dpx → %s', (width, expected) => {
    setViewportWidth(width);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe(expected);
  });

  it('reads the viewport, not the scroll width', () => {
    // The bug this guards: reading window.innerWidth meant a layout one pane
    // too wide inflated the number it was measured against, so it reported a
    // viewport wide enough to justify that pane and never recovered.
    setViewportWidth(760);
    Object.defineProperty(document.documentElement, 'scrollWidth', {
      value: 1400,
      configurable: true,
    });

    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('narrow');
  });
});
