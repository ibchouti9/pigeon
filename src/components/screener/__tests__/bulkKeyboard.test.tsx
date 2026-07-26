import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUi } from '../../../store/ui';
import { BulkReview } from '../BulkReview';
import { makeHeldList } from './fixtures';

/**
 * §8.1 puts bulk review in the thread-list scope, which binds `Enter`/`o`,
 * `Home`/`End` and `Shift+J`/`Shift+K` alongside `j`/`k`/`x`. Only the latter
 * were bound, so there was no keyboard path to the held-message sheet at all
 * and range selection was mouse-only.
 */
describe('bulk review keyboard (§8.1)', () => {
  const held = makeHeldList(['a', 'b', 'c', 'd']);
  const ids = held.map((h) => h.sender.id);

  let checked: Set<string>;
  let onOpenSheet: ReturnType<typeof vi.fn<(senderId: string) => void>>;

  function renderBulk() {
    const onCheckedChange = vi.fn((next: Set<string>) => {
      checked = next;
      rerender();
    });
    const props = {
      held,
      status: 'ready' as const,
      reads: {},
      online: true,
      onCheckedChange,
      onToggleView: vi.fn(),
      onOpenSheet,
    };
    const view = render(<BulkReview {...props} checked={checked} />);
    function rerender() {
      view.rerender(<BulkReview {...props} checked={checked} />);
    }
    return { onCheckedChange };
  }

  beforeEach(() => {
    checked = new Set();
    onOpenSheet = vi.fn<(senderId: string) => void>();
    useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
    // jsdom has no layout, so scrollIntoView is not implemented on elements.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it('opens the cursor row on Enter and on o', async () => {
    const user = userEvent.setup();
    renderBulk();

    await user.keyboard('j');
    await user.keyboard('{Enter}');
    expect(onOpenSheet).toHaveBeenCalledWith(ids[0]);

    onOpenSheet.mockClear();
    await user.keyboard('j');
    await user.keyboard('o');
    expect(onOpenSheet).toHaveBeenCalledWith(ids[1]);
  });

  it('jumps to the first and last rows on Home and End', async () => {
    const user = userEvent.setup();
    renderBulk();

    await user.keyboard('{End}');
    await user.keyboard('{Enter}');
    expect(onOpenSheet).toHaveBeenCalledWith(ids[ids.length - 1]);

    onOpenSheet.mockClear();
    await user.keyboard('{Home}');
    await user.keyboard('{Enter}');
    expect(onOpenSheet).toHaveBeenCalledWith(ids[0]);
  });

  it('extends the selection with Shift+J and Shift+K', async () => {
    const user = userEvent.setup();
    renderBulk();

    await user.keyboard('j'); // cursor on row 0
    await user.keyboard('{Shift>}J{/Shift}');
    expect([...checked].sort()).toEqual([ids[0], ids[1]].sort());

    await user.keyboard('{Shift>}J{/Shift}');
    expect([...checked].sort()).toEqual([ids[0], ids[1], ids[2]].sort());

    await user.keyboard('{Shift>}K{/Shift}');
    // Extending back keeps what it already gathered — Shift never deselects.
    expect([...checked].sort()).toEqual([ids[0], ids[1], ids[2]].sort());
  });

  it('moves the cursor on the arrow keys too', async () => {
    const user = userEvent.setup();
    renderBulk();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onOpenSheet).toHaveBeenCalledWith(ids[1]);
  });

  it('marks the cursor row distinctly from hover (D29)', async () => {
    const user = userEvent.setup();
    renderBulk();

    await user.keyboard('j');
    const cursorRows = document.querySelectorAll('[class*="_cursor_"]');
    expect(cursorRows).toHaveLength(1);
    expect(screen.getAllByRole('listitem')[0].className).toMatch(/_cursor_/);
  });
});
