import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { isSingleColumn, useBreakpoint } from '../useBreakpoint';
import { setViewportWidth } from '../../test/setup';

afterEach(() => setViewportWidth(1440));

describe('useBreakpoint (§5)', () => {
  it.each([
    [375, 'phone'],
    [430, 'phone'],
    [719, 'phone'],
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

  /*
   * Landscape on a phone is 812 by 375, which is past the 720px width and took
   * the rail — a vertical column of eleven controls in an `overflow: hidden`
   * box 375px tall. Everything from Drafts downward was off the screen.
   */
  it.each([
    [812, 375, 'phone'],
    [932, 430, 'phone'],
    [667, 375, 'phone'],
    // Upright, no phone is under 450px tall, so the height clause never fires.
    [430, 932, 'phone'],
    [1440, 900, 'desktop'],
  ])('%d×%d → %s', (width, height, expected) => {
    setViewportWidth(width, height);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe(expected);
  });

  describe('isSingleColumn', () => {
    it('is true at both widths that stack the list and the reader', () => {
      expect(isSingleColumn('phone')).toBe(true);
      expect(isSingleColumn('narrow')).toBe(true);
    });

    it('is false wherever the reader has a column of its own', () => {
      expect(isSingleColumn('tablet')).toBe(false);
      expect(isSingleColumn('desktop')).toBe(false);
    });
  });
});
