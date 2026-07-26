import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('shows no bulk action bar with nothing selected', () => {
    renderBulk(new Set());
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
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
