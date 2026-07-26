import { describe, expect, it } from 'vitest';
import {
  dateGroupLabel,
  formatBytes,
  formatListTimestamp,
  formatPostmarkDate,
  plural,
} from '../format';

const NOW = new Date('2026-07-26T15:00:00');

function at(iso: string): string {
  return new Date(iso).toISOString();
}

describe('formatListTimestamp (D32)', () => {
  it('shows a clock time for today', () => {
    expect(formatListTimestamp(at('2026-07-26T14:14:00'), NOW)).toBe('2:14 PM');
  });

  it('shows month and day for this calendar year', () => {
    expect(formatListTimestamp(at('2026-07-12T09:00:00'), NOW)).toBe('Jul 12');
  });

  it('shows the year for anything older', () => {
    expect(formatListTimestamp(at('2025-07-12T09:00:00'), NOW)).toBe('Jul 12, 2025');
  });

  it('treats yesterday as a date, not a time, even a few hours back', () => {
    expect(formatListTimestamp(at('2026-07-25T23:30:00'), NOW)).toBe('Jul 25');
  });

  it('renders midnight as 12:00 AM, not 0:00', () => {
    expect(formatListTimestamp(at('2026-07-26T00:05:00'), NOW)).toBe('12:05 AM');
  });

  it('renders noon as 12:00 PM', () => {
    expect(formatListTimestamp(at('2026-07-26T12:00:00'), NOW)).toBe('12:00 PM');
  });
});

describe('dateGroupLabel (§5.5)', () => {
  it.each([
    ['2026-07-26T09:00:00', 'TODAY'],
    ['2026-07-25T09:00:00', 'YESTERDAY'],
    ['2026-07-22T09:00:00', 'WEDNESDAY'],
    ['2026-07-01T09:00:00', 'JULY 2026'],
    ['2025-12-01T09:00:00', 'DECEMBER 2025'],
  ])('%s → %s', (iso, expected) => {
    expect(dateGroupLabel(at(iso), { now: NOW })).toBe(expected);
  });

  it('starts at THIS MONTH in the Archive (§5.10)', () => {
    expect(dateGroupLabel(at('2026-07-26T09:00:00'), { archive: true, now: NOW })).toBe(
      'THIS MONTH',
    );
    expect(dateGroupLabel(at('2026-07-01T09:00:00'), { archive: true, now: NOW })).toBe(
      'THIS MONTH',
    );
    expect(dateGroupLabel(at('2026-06-30T09:00:00'), { archive: true, now: NOW })).toBe(
      'JUNE 2026',
    );
  });
});

describe('formatPostmarkDate (§4.2)', () => {
  it('renders the two-line date as uppercase month and day', () => {
    expect(formatPostmarkDate(at('2026-07-25T09:00:00'))).toBe('JUL 25');
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [245_760, '240 KB'],
    [1_258_291, '1.2 MB'],
    [18_874_368, '18 MB'],
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('plural', () => {
  it('keeps the singular at one', () => {
    expect(plural(1, 'sender')).toBe('1 sender');
  });

  it('groups thousands', () => {
    expect(plural(11908, 'thread')).toBe('11,908 threads');
  });
});
