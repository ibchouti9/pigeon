import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasUnresolvedPlaceholder,
  isCompleteAddress,
  parseAddress,
  useCompose,
} from '../compose';

describe('useCompose', () => {
  beforeEach(() => {
    useCompose.setState({ draft: null, minimized: false, expanded: false, pulse: 0 });
  });

  it('opens one draft', () => {
    useCompose.getState().open();
    expect(useCompose.getState().draft).not.toBeNull();
  });

  it('focuses the existing draft rather than opening a second (D13)', () => {
    useCompose.getState().open({ subject: 'First' });
    const first = useCompose.getState().draft;
    const pulseBefore = useCompose.getState().pulse;

    useCompose.getState().open({ subject: 'Second' });

    expect(useCompose.getState().draft).toBe(first);
    expect(useCompose.getState().draft?.subject).toBe('First');
    expect(useCompose.getState().pulse).toBe(pulseBefore + 1);
  });

  it('restores a minimized draft when compose is pressed again (§3.5 1a)', () => {
    useCompose.getState().open();
    useCompose.getState().setMinimized(true);
    useCompose.getState().open();
    expect(useCompose.getState().minimized).toBe(false);
  });

  it('preserves content when minimized (§3.5 3b)', () => {
    useCompose.getState().open();
    useCompose.getState().update({ body: 'half written' });
    useCompose.getState().setMinimized(true);
    expect(useCompose.getState().draft?.body).toBe('half written');
  });

  it('clears everything on close', () => {
    useCompose.getState().open();
    useCompose.getState().close();
    expect(useCompose.getState().draft).toBeNull();
    expect(useCompose.getState().expanded).toBe(false);
  });
});

describe('hasUnresolvedPlaceholder', () => {
  it('detects a placeholder (D26)', () => {
    expect(hasUnresolvedPlaceholder('Does [confirm: a time on Thursday] work?')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(hasUnresolvedPlaceholder('[CONFIRM: a price]')).toBe(true);
  });

  it('ignores ordinary brackets', () => {
    expect(hasUnresolvedPlaceholder('See [1] and [the appendix].')).toBe(false);
  });

  it('ignores the word confirm in prose', () => {
    expect(hasUnresolvedPlaceholder('Please confirm the time.')).toBe(false);
  });
});

describe('isCompleteAddress', () => {
  it.each([
    ['dana@lumenpartners.com', true],
    ['marc.jr@ferrum.dev', true],
    ['dana@lumen', false],
    ['dana', false],
    ['@lumen.com', false],
    ['dana @lumen.com', false],
  ])('%s → %s', (input, expected) => {
    expect(isCompleteAddress(input)).toBe(expected);
  });
});

describe('parseAddress', () => {
  it('splits a display name from the address', () => {
    expect(parseAddress('Dana Whitlock <dana@lumen.com>')).toEqual({
      name: 'Dana Whitlock',
      email: 'dana@lumen.com',
    });
  });

  it('leaves a bare address alone', () => {
    expect(parseAddress('  dana@lumen.com  ')).toEqual({ name: '', email: 'dana@lumen.com' });
  });
});
