import { useNavigate } from 'react-router-dom';
import type { Digest } from '../../types';
import { AiBlock, DegradedAiBlock } from '../primitives/AiBlock';
import { Button } from '../primitives/Button';
import { Chip } from '../primitives/Controls';
import { plural } from '../../lib/format';
import { CATEGORY_LABEL } from './digest';
import styles from './ScreenerDigest.module.css';

export interface ScreenerDigestProps {
  heldCount: number;
  digest?: Digest;
  state: 'loading' | 'ready' | 'failed';
  /** A provider is connected at all (§5.13c Provider block). */
  hasProvider: boolean;
  /** The "Read new senders for the Screener" toggle (§5.13c Behaviour block). */
  readsEnabled: boolean;
  onRetry: () => void;
  /** A grouping chip was clicked — switch to Bulk review with those senders checked. */
  onSelectGroup: (senderIds: string[]) => void;
}

/**
 * §5.7 digest block (C-10 `AiBlock kind="digest"`). Degrades per C-28 when no
 * provider is connected, and to a bare count (no body/action) when the user
 * has switched the Screener-reads toggle off (§5.13c) — both distinct from
 * the "Digest failed" state, which keeps the same plain count plus
 * [Try again] (§7.6). The AI call itself lives in `src/ai/useScreenerAi`;
 * this component only renders what it's given.
 */
export function ScreenerDigest({
  heldCount,
  digest,
  state,
  hasProvider,
  readsEnabled,
  onRetry,
  onSelectGroup,
}: ScreenerDigestProps) {
  const navigate = useNavigate();
  const plainCount = `${plural(heldCount, 'sender')} waiting.`;

  if (!hasProvider) {
    return (
      <DegradedAiBlock
        className={styles.wrap}
        headline={plainCount}
        body="Connect a provider to get a weekly read on who's waiting."
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

  if (state === 'failed') {
    return (
      <DegradedAiBlock
        className={styles.wrap}
        headline={plainCount}
        action={
          <Button variant="tertiary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <AiBlock
      className={styles.wrap}
      kind="digest"
      state={state}
      content={digest?.sentence}
      footer={
        state === 'ready' && digest && digest.groups.length > 0 ? (
          <div className={styles.chips} role="group" aria-label="Filter by category">
            {digest.groups.map((g) => (
              <Chip
                key={g.category}
                kind="filter"
                label={CATEGORY_LABEL[g.category]}
                count={g.count}
                onClick={() => onSelectGroup(g.senderIds)}
              />
            ))}
          </div>
        ) : undefined
      }
    />
  );
}
