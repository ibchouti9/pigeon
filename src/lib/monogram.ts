/** C-3 Monogram tile — deterministic initials and feather-ramp fill. */

/**
 * One letter for a single-word name, two for multi-word; falls back to the
 * first letter of the address.
 */
export function initialsFor(name: string | undefined, email: string): string {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w));

  if (words.length === 0) {
    const first = email.trim()[0];
    return (first ?? '?').toUpperCase();
  }
  if (words.length === 1) {
    return words[0][0].toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Stable 32-bit string hash (FNV-1a). Same address always gets the same tone. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** `hash(lowercased email) % 6` over the fixed feather ramp (D16). */
export function monogramTone(email: string): number {
  return (hashString(email.trim().toLowerCase()) % 6) + 1;
}
