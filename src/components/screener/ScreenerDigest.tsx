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
  hasProvider: boolean;
  onRetry: () => void;
  /** A grouping chip was clicked — switch to Bulk review with those senders checked. */
  onSelectGroup: (senderIds: string[]) => void;
}

/**
 * §5.7 digest block (C-10 `AiBlock kind="digest"`), degrading per C-28 when
 * no provider is connected and per §7.6 "Digest failed" when the assistant
 * call itself errors. The AI call that produces `digest` lives in
 * `useScreenerDigest`; this component only renders what it's given.
 */
export function ScreenerDigest({
  heldCount,
  digest,
  state,
  hasProvider,
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
