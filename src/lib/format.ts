/** Formatting rules from §4 and §7. All timestamps are IBM Plex Mono, tabular. */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days between two dates, ignoring the time of day. */
function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

function clockTime(d: Date): string {
  let hours = d.getHours();
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes} ${meridiem}`;
}

/**
 * D32 — today → `2:14 PM`; this calendar year → `Jul 12`; older → `Jul 12, 2025`.
 */
export function formatListTimestamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (daysBetween(d, now) === 0) return clockTime(d);
  if (d.getFullYear() === now.getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Reading-pane timestamp: `Jul 22, 9:14 AM`. */
export function formatMessageTimestamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const datePart =
    d.getFullYear() === now.getFullYear()
      ? `${MONTHS[d.getMonth()]} ${d.getDate()}`
      : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  return `${datePart}, ${clockTime(d)}`;
}

/** Spoken form for aria-labels: `July 22 at 9:14 AM`. */
export function formatTimestampSpoken(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()} at ${clockTime(d)}`;
}

/** Postmark date line: `JUL 25`. */
export function formatPostmarkDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()].toUpperCase()} ${d.getDate()}`;
}

/** Postmark spoken form: `July 25`. */
export function formatPostmarkDateSpoken(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
}

/**
 * §5.5 — TODAY, YESTERDAY, weekday name for the last 7 days, `MMMM YYYY` beyond.
 * Archive starts at THIS MONTH instead of TODAY (§5.10).
 */
export function dateGroupLabel(
  iso: string,
  opts: { archive?: boolean; now?: Date } = {},
): string {
  const now = opts.now ?? new Date();
  const d = new Date(iso);
  const delta = daysBetween(d, now);

  if (opts.archive) {
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
      return 'THIS MONTH';
    }
    return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`.toUpperCase();
  }

  if (delta === 0) return 'TODAY';
  if (delta === 1) return 'YESTERDAY';
  if (delta > 1 && delta < 7) return WEEKDAYS[d.getDay()].toUpperCase();
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`.toUpperCase();
}

/** "Connected 2 days ago" / "2 minutes ago". */
export function relativeTime(iso: string, now = new Date()): string {
  // A clock skew or a future-dated message reads as "just now", not "in -3 days".
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Numbers as numerals with thousands separators (§7 voice rules). */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** `240 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** `$1.84`. */
export function formatSpend(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Display name for an address, falling back to the address itself. */
export function displayName(a: { name?: string; email: string }): string {
  return a.name && a.name.trim() ? a.name : a.email;
}

/** Oxford-free participant list: "Dana Whitlock, you, Sana Sethi". */
export function joinNames(names: string[]): string {
  return names.join(', ');
}

/** Pluralise a noun against a count: `1 sender` / `9 senders`. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : pluralForm}`;
}
