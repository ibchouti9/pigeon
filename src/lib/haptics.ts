import { invoke, isIos } from './desktop';

/**
 * A tap you can feel, on the one platform that has the hardware for it.
 *
 * §4's postmark is "stamped onto a sender card at the moment of decision" — a
 * physical metaphor the desktop can only draw. A phone can do it, and without
 * this, approving somebody feels exactly like scrolling past them.
 *
 * Three kinds and no more. A vocabulary that grows past what a hand can tell
 * apart is a vocabulary nobody learns.
 */
export type Haptic =
  /** Something was decided: a sender approved, a message sent. */
  | 'decided'
  /** Something was refused: a sender declined. Not an error — they meant it. */
  | 'refused'
  /** Something small happened: a row committed, a pull crossed its threshold. */
  | 'tick';

export function haptic(kind: Haptic): void {
  if (!isIos()) return;
  // Fire and forget. A missed haptic is not worth a caught promise, and there
  // is nothing to tell anyone if the Taptic Engine declines.
  void invoke('haptic', { kind }).catch(() => {});
}
