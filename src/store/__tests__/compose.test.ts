import { beforeEach, describe, expect, it } from 'vitest';
import {
  hasUnresolvedPlaceholder,
  isCompleteAddress,
  parseAddress,
  useCompose,
} from '../compose';
import type { Draft } from '../../types';

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

/**
 * D13's draft lived in memory with no persistence at all, so quitting or
 * reloading mid-compose threw away everything typed, silently. §3.5 3e asks
 * the offline banner to warn about exactly this; §7 gives that banner one
 * sentence that cannot be added to, so not losing the draft is the other way
 * to make the warning unnecessary.
 */
describe('a draft survives a restart', () => {
  beforeEach(() => {
    localStorage.clear();
    useCompose.getState().close();
  });

  function stored(): { draft: Draft | null; droppedAttachments: number } {
    const raw = localStorage.getItem('pigeon.draft');
    return JSON.parse(raw ?? '{"state":{}}').state;
  }

  it('writes what was typed', () => {
    useCompose.getState().open();
    useCompose.getState().update({ subject: 'Contract redlines', body: 'Sending Friday.' });

    expect(stored().draft?.subject).toBe('Contract redlines');
    expect(stored().draft?.body).toBe('Sending Friday.');
  });

  it('keeps nothing for a composer that was opened and never used', () => {
    useCompose.getState().open();

    expect(stored().draft).toBeNull();
  });

  it('keeps nothing once the draft is closed', () => {
    useCompose.getState().open();
    useCompose.getState().update({ body: 'half a thought' });
    useCompose.getState().close();

    expect(stored().draft).toBeNull();
  });

  it('leaves attachments out and counts them instead', () => {
    useCompose.getState().open();
    useCompose.getState().update({
      body: 'The deck is attached.',
      attachments: [
        { id: 'a1', filename: 'deck.pdf', mimeType: 'application/pdf', size: 12, data: 'AA==' },
      ],
    });

    // 25 MB of base64 is more than any localStorage will take, and a quota
    // failure would lose the whole draft rather than just the file.
    expect(stored().draft?.attachments).toEqual([]);
    expect(stored().droppedAttachments).toBe(1);
  });
});
