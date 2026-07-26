import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMail } from '../../../store/mail';
import { useUi } from '../../../store/ui';
import { CardStack } from '../CardStack';
import { BEHIND_INSETS } from '../stack';
import { makeHeldList } from './fixtures';

afterEach(() => {
  cleanup();
  useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
});

function renderStack(count: number, decide = vi.fn().mockResolvedValue(true)) {
  useMail.setState({ decide });
  const held = makeHeldList(Array.from({ length: count }, (_, i) => `s${i}`));
  render(
    <CardStack
      held={held}
      status="ready"
      reads={{}}
      online={true}
      onRead={vi.fn()}
      onToggleView={vi.fn()}
    />,
  );
  return { held, decide };
}

describe('CardStack — geometry (§5.7 acceptance check)', () => {
  it('renders exactly 2 behind cards with the spec-exact opposing insets when 3+ senders remain', () => {
    renderStack(5);

    const behind1 = screen.getByTestId('card-behind-1');
    const behind2 = screen.getByTestId('card-behind-2');

    expect(behind1.style.left).toBe(`${BEHIND_INSETS[0].left}px`);
    expect(behind1.style.right).toBe(`${BEHIND_INSETS[0].right}px`);
    expect(behind1.style.top).toBe(`${BEHIND_INSETS[0].top}px`);
    expect(behind1.style.bottom).toBe(`${BEHIND_INSETS[0].bottom}px`);

    expect(behind2.style.left).toBe(`${BEHIND_INSETS[1].left}px`);
    expect(behind2.style.right).toBe(`${BEHIND_INSETS[1].right}px`);
    expect(behind2.style.top).toBe(`${BEHIND_INSETS[1].top}px`);
    expect(behind2.style.bottom).toBe(`${BEHIND_INSETS[1].bottom}px`);

    // Never a fixed height on the behind cards (§5.7) — they must stay auto
    // so they track the live card at any content height.
    expect(behind1.style.height).toBe('');
    expect(behind2.style.height).toBe('');

    // Exactly the spec's insets, so a future change can't silently drift.
    expect(BEHIND_INSETS).toEqual([
      { left: 32, right: 32, top: -12, bottom: 12 },
      { left: 44, right: 44, top: -24, bottom: 24 },
    ]);
  });

  it('renders at most 3 cards total (1 live + 2 behind), never more', () => {
    renderStack(12);
    // Only the top card is a heading (h2 = sender name) — behind cards carry
    // no content per §5.7, so this also proves there's exactly one live card.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByTestId('card-behind-1')).toBeInTheDocument();
    expect(screen.getByTestId('card-behind-2')).toBeInTheDocument();
    expect(screen.queryByTestId('card-behind-3')).not.toBeInTheDocument();
  });

  it('renders only what exists when fewer than 3 senders remain', () => {
    renderStack(2);
    expect(screen.getByTestId('card-behind-1')).toBeInTheDocument();
    expect(screen.queryByTestId('card-behind-2')).not.toBeInTheDocument();
  });

  it('renders no behind cards for a single held sender', () => {
    renderStack(1);
    expect(screen.queryByTestId('card-behind-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-behind-2')).not.toBeInTheDocument();
  });
});

describe('CardStack — decisions', () => {
  it('clicking "Approve sender" calls decide with the top sender id and "approved"', async () => {
    const user = userEvent.setup();
    const { held, decide } = renderStack(3);

    await user.click(screen.getByRole('button', { name: 'Approve sender' }));

    expect(decide).toHaveBeenCalledWith(held[0].sender.id, 'approved');
  });

  it('clicking "Decline sender" calls decide with the top sender id and "declined"', async () => {
    const user = userEvent.setup();
    const { held, decide } = renderStack(3);

    await user.click(screen.getByRole('button', { name: 'Decline sender' }));

    expect(decide).toHaveBeenCalledWith(held[0].sender.id, 'declined');
  });

  it('the `a` keyboard shortcut approves the top card', async () => {
    const user = userEvent.setup();
    const { held, decide } = renderStack(3);

    await user.keyboard('a');

    expect(decide).toHaveBeenCalledWith(held[0].sender.id, 'approved');
  });

  it('announces the outcome, remaining count, and next sender after a decision (§8.4)', async () => {
    const user = userEvent.setup();
    const { held } = renderStack(3);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('');

    await user.click(screen.getByRole('button', { name: 'Approve sender' }));

    await within(region).findByText(
      `Approved ${held[0].sender.name}. 2 senders waiting. Now showing ${held[1].sender.name}.`,
    );
  });

  it('does not call decide when offline', async () => {
    const user = userEvent.setup();
    const decide = vi.fn().mockResolvedValue(true);
    useMail.setState({ decide });
    const held = makeHeldList(['s0', 's1']);
    render(
      <CardStack held={held} status="ready" reads={{}} online={false} onRead={vi.fn()} onToggleView={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Approve sender' }));
    expect(decide).not.toHaveBeenCalled();
  });
});
