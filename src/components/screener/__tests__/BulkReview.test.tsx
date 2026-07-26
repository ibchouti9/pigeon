import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMail } from '../../../store/mail';
import { useUi } from '../../../store/ui';
import { BulkReview } from '../BulkReview';
import { makeHeldList } from './fixtures';

afterEach(() => {
  cleanup();
  useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
});

const HELD = makeHeldList(['s0', 's1', 's2']);

function renderBulk(checked: Set<string>, onCheckedChange = vi.fn()) {
  useMail.setState({ decideMany: vi.fn().mockResolvedValue({ ok: [], failed: [] }) });
  render(
    <BulkReview
      held={HELD}
      status="ready"
      reads={{}}
      online={true}
      checked={checked}
      onCheckedChange={onCheckedChange}
      onToggleView={vi.fn()}
      onOpenSheet={vi.fn()}
    />,
  );
  return { onCheckedChange };
}

describe('BulkReview — select all', () => {
  it('is unchecked and not indeterminate with nothing selected', () => {
    renderBulk(new Set());
    const selectAll = screen.getByRole('checkbox', { name: 'Select all (3)' }) as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('is indeterminate when some, but not all, rows are checked', () => {
    renderBulk(new Set(['s0']));
    const selectAll = screen.getByRole('checkbox', { name: 'Select all (3)' }) as HTMLInputElement;
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(true);
  });

  it('is checked and not indeterminate when every row is checked', () => {
    renderBulk(new Set(['s0', 's1', 's2']));
    const selectAll = screen.getByRole('checkbox', { name: 'Select all (3)' }) as HTMLInputElement;
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);
  });

  it('checks every row when clicked from empty', async () => {
    const user = userEvent.setup();
    const { onCheckedChange } = renderBulk(new Set());
    await user.click(screen.getByRole('checkbox', { name: 'Select all (3)' }));
    expect(onCheckedChange).toHaveBeenCalledWith(new Set(['s0', 's1', 's2']));
  });

  it('clears the selection when clicked from fully checked', async () => {
    const user = userEvent.setup();
    const { onCheckedChange } = renderBulk(new Set(['s0', 's1', 's2']));
    await user.click(screen.getByRole('checkbox', { name: 'Select all (3)' }));
    expect(onCheckedChange).toHaveBeenCalledWith(new Set());
  });

  it('shows the bulk action bar with the selected count once something is checked', () => {
    renderBulk(new Set(['s0']));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar).toBeInTheDocument();
    // Scoped to the bar: the same words also live in the status region below.
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
  });

  it('shows no bulk action bar with nothing selected', () => {
    renderBulk(new Set());
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });
});

/**
 * §8.4 — "the status region announces '9 selected' on selection change". The
 * count used to be an `aria-live` on the visible text inside the action bar,
 * and the bar only exists once something is selected — so the region and its
 * first content entered the DOM in the same mutation, which is the case screen
 * readers skip. The announcement that mattered most, 0 to 1, was the one least
 * likely to be heard.
 */
describe('BulkReview — selection announcements (§8.4)', () => {
  function statusRegion(): HTMLElement {
    return screen.getByRole('status');
  }

  it('keeps the status region mounted with nothing selected', () => {
    renderBulk(new Set());
    expect(statusRegion()).toBeInTheDocument();
    expect(statusRegion()).toHaveTextContent('');
  });

  it('announces the count once a selection exists', () => {
    renderBulk(new Set(['s0', 's1', 's2']));
    expect(statusRegion()).toHaveTextContent('3 selected');
  });

  /**
   * Once a bulk decision is running, the selection is being consumed and §3.3
   * step 3's toast announces the outcome. This region used to keep saying
   * "9 selected" over the top of it — two live regions, one describing a state
   * that had just ended.
   */
  it('goes quiet while a decision is in flight', async () => {
    const user = userEvent.setup();
    renderBulk(new Set(['s0', 's1']));
    expect(statusRegion()).toHaveTextContent('2 selected');

    await user.click(screen.getByRole('button', { name: /Approve senders/ }));

    await waitFor(() => expect(statusRegion()).toHaveTextContent(''));
  });

  it('does not double-announce from the visible bar', () => {
    renderBulk(new Set(['s0']));
    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    // Nothing inside the visible bar is a live region; the status region below
    // is what speaks, and two of them would say the count twice.
    expect(bar.querySelectorAll('[aria-live]')).toHaveLength(0);
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
  });
});

describe('BulkReview — row selection', () => {
  it('toggling a single row checkbox adds it to the selection', async () => {
    const user = userEvent.setup();
    const { onCheckedChange } = renderBulk(new Set());
    await user.click(screen.getByRole('checkbox', { name: `Select ${HELD[0].sender.name}` }));
    expect(onCheckedChange).toHaveBeenCalledWith(new Set(['s0']));
  });
});
