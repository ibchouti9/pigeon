import { useNavigate } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { AiBlock, DegradedAiBlock } from '../primitives/AiBlock';
import { Button } from '../primitives/Button';
import { Chip } from '../primitives/Controls';
import { formatCount, plural } from '../../lib/format';
import type { TriageView } from '../../ai/useTriage';
import styles from './ScreenerDigest.module.css';

export interface ScreenerDigestProps {
  heldCount: number;
  triage: TriageView;
  /** A provider is connected at all (§5.13c Provider block). */
  hasProvider: boolean;
  /** The "Read new senders for the Screener" toggle (§5.13c Behaviour block). */
  readsEnabled: boolean;
  /** A group chip was clicked — switch to Bulk review with those senders checked. */
  onSelectGroup: (senderIds: string[]) => void;
}

/**
 * §5.7's block above the Screener, saying what Pigeon would do with the queue.
 *
 * It used to hold a model-written digest sentence — "12 senders held: 9 junk,
 * 2 recruiters" — and that call is gone. The prompt handed the model a user
 * message opening "12 senders are waiting:" and got back a completion of that
 * exact line with everyone listed underneath, so the block rendered a dangling
 * colon and nothing else. More to the point, a sentence was a worse answer
 * than a count you can act on.
 *
 * The counts are arithmetic over per-sender verdicts, so they cannot
 * contradict the rows below and cost no call of their own. The model's work is
 * in the verdicts; this adds them up.
 *
 * The chips select. They do not decide — that is still the action bar in bulk
 * review, with the eight seconds of undo it always had.
 */
export function ScreenerDigest({
  heldCount,
  triage,
  hasProvider,
  readsEnabled,
  onSelectGroup,
}: ScreenerDigestProps) {
  const navigate = useNavigate();
  const plainCount = `${plural(heldCount, 'sender')} waiting.`;

  if (!hasProvider) {
    return (
      <DegradedAiBlock
        className={styles.wrap}
        headline={plainCount}
        body="Connect a provider and Pigeon will say what it would do with each of them."
        action={
          <Button variant="tertiary" size="sm" onClick={() => navigate('/settings/assistant')}>
            Connect a provider
          </Button>
        }
      />
    );
  }

  if (!readsEnabled) {
    return <DegradedAiBlock className={styles.wrap} headline={plainCount} />;
  }

  const groups = [
    { key: 'decline' as const, label: 'Decline', ids: triage.decline },
    { key: 'approve' as const, label: 'Approve', ids: triage.approve },
  ].filter((g) => g.ids.length > 0);

  /*
   * Nothing suggested is not a failure, and gets no [Try again]: the model was
   * asked and preferred to say nothing, which is what the triage prompt is
   * written to prefer. A plain count is the honest surface for that.
   */
  if (groups.length === 0) {
    return (
      <DegradedAiBlock
        className={styles.wrap}
        headline={plainCount}
        body={triage.thinking ? 'Reading them now.' : 'None of them are an obvious call.'}
      />
    );
  }

  /*
   * The remainder, named rather than left to arithmetic.
   *
   * "12 senders waiting. Pigeon would decline 5 and approve 1." accounts for
   * six of twelve and says nothing about the rest, which is the majority — and
   * the triage prompt is written to *prefer* unsure, so the majority is the
   * normal case rather than a bad run. Leaving it out reads as the model
   * having failed on them instead of having declined to guess.
   */
  const suggested = groups.reduce((n, g) => n + g.ids.length, 0);
  const unsure = Math.max(0, heldCount - suggested);

  const sentence = `${plainCount} Pigeon would ${groups
    .map((g) => `${g.label.toLowerCase()} ${formatCount(g.ids.length)}`)
    .join(' and ')}${unsure > 0 ? `, and isn't sure about ${formatCount(unsure)}` : ''}.`;

  return (
    <AiBlock
      className={styles.wrap}
      kind="digest"
      state={triage.thinking ? 'loading' : 'ready'}
      content={sentence}
      footer={
        <div className={styles.chips} role="group" aria-label="Select a group">
          {groups.map((g) => (
            <Chip
              key={g.key}
              kind="filter"
              label={g.label}
              count={g.ids.length}
              onClick={() => onSelectGroup(g.ids)}
            />
          ))}
          {/*
            Spelled out, because a chip reading "Decline (5)" could otherwise
            be taken for the action rather than the selection it is.
          */}
          <span className={cn('t-xs', styles.note)}>Selects them. Nothing is decided yet.</span>
        </div>
      }
    />
  );
}
