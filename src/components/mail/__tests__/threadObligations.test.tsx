import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadObligations } from '../ThreadObligations';
import { useLedger } from '../../../store/ledger';
import type { Obligation } from '../../../store/ledger';

function obligation(over: Partial<Obligation> = {}): Obligation {
  return {
    id: 't1:decide the liability cap',
    threadId: 't1',
    kind: 'you-promised',
    what: 'decide the liability cap',
    who: 'Dana Whitlock',
    due: 'end of day',
    subject: 'Contract redlines back from legal',
    at: '2026-07-28T09:00:00.000Z',
    ...over,
  };
}

/**
 * The Ledger's reading, shown in the conversation it came from. Nothing here
 * asks a model anything — it is the same answer, in the place it applies.
 */
describe('ThreadObligations', () => {
  beforeEach(() => {
    act(() => useLedger.setState({ found: {}, readAt: {}, done: [] }));
  });

  it('shows nothing for a thread the ledger has not read', () => {
    const { container } = render(<ThreadObligations threadId="t1" />);
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * "Read, owes nothing" is the ledger's most common answer and is stored as
   * an empty array. It must render as silence, not as an empty box.
   */
  it('shows nothing for a thread that was read and owes nothing', () => {
    act(() => useLedger.setState({ found: { t1: [] } }));
    const { container } = render(<ThreadObligations threadId="t1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leads with the frame and then the thing to be done', () => {
    act(() => useLedger.setState({ found: { t1: [obligation()] } }));
    render(<ThreadObligations threadId="t1" />);

    expect(screen.getByText(/You said you would/)).toBeInTheDocument();
    expect(screen.getByText(/decide the liability cap/)).toBeInTheDocument();
    expect(screen.getByText('end of day')).toBeInTheDocument();
  });

  it('names the kind it is', () => {
    act(() =>
      useLedger.setState({
        found: { t1: [obligation({ id: 'a', kind: 'needs-you', what: 'send the notes' })] },
      }),
    );
    render(<ThreadObligations threadId="t1" />);
    expect(screen.getByText(/They asked you to/)).toBeInTheDocument();
  });

  /*
   * Waiting-on is somebody else's move. A checkbox there would mean "they
   * replied", which is a claim the mailbox can make for itself.
   */
  it('offers no tick for something you are waiting on', () => {
    act(() =>
      useLedger.setState({
        found: { t1: [obligation({ id: 'b', kind: 'waiting-on', what: 'the signed copy' })] },
      }),
    );
    render(<ThreadObligations threadId="t1" />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('ticks one off, and the ledger agrees', async () => {
    act(() => useLedger.setState({ found: { t1: [obligation()] } }));
    render(<ThreadObligations threadId="t1" />);

    await userEvent.click(screen.getByRole('checkbox'));
    expect(useLedger.getState().isDone('t1:decide the liability cap')).toBe(true);
  });

  it('hides what has already been ticked off elsewhere', () => {
    act(() =>
      useLedger.setState({
        found: { t1: [obligation()] },
        done: ['t1:decide the liability cap'],
      }),
    );
    const { container } = render(<ThreadObligations threadId="t1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
