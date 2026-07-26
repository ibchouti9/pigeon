import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { Thread } from '../../../types';
import { MailListColumn } from '../MailListColumn';
import { groupThreadsByDate } from '../grouping';
import rowStyles from '../ThreadRow.module.css';

const NOW = new Date('2026-07-26T18:00:00.000Z');

function iso(daysAgo: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function makeThread(id: string, subject: string, daysAgo: number): Thread {
  return {
    id,
    subject,
    place: 'inbox',
    unread: false,
    lastMessageAt: iso(daysAgo),
    messages: [
      {
        id: `${id}-m1`,
        threadId: id,
        from: { name: `Sender ${id}`, email: `${id}@example.com` },
        to: [{ name: 'Marc Ferrum', email: 'marc@ferrum.dev' }],
        cc: [],
        subject,
        body: `Body of ${subject}`,
        date: iso(daysAgo),
        attachments: [],
        isFromUser: false,
      },
    ],
  };
}

describe('groupThreadsByDate', () => {
  it('buckets threads into TODAY / YESTERDAY / weekday / month without reordering (§5.5)', () => {
    const threads = [
      makeThread('t1', 'Today one', 0),
      makeThread('t2', 'Today two', 0),
      makeThread('t3', 'Yesterday', 1),
      makeThread('t4', 'Last week', 3),
      makeThread('t5', 'Ages ago', 400),
    ];

    const groups = groupThreadsByDate(threads, { now: NOW });

    expect(groups.map((g) => g.label)).toEqual([
      'TODAY',
      'YESTERDAY',
      'THURSDAY',
      'JUNE 2025',
    ]);
    expect(groups[0].threads.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(groups[1].threads.map((t) => t.id)).toEqual(['t3']);
  });

  it('starts at THIS MONTH instead of TODAY for the Archive (§5.10)', () => {
    const threads = [makeThread('t1', 'Recent', 0)];
    const groups = groupThreadsByDate(threads, { now: NOW, archive: true });
    expect(groups[0].label).toBe('THIS MONTH');
  });
});

function renderList(threads: Thread[], overrides: Partial<Parameters<typeof MailListColumn>[0]> = {}) {
  return render(
    <MailListColumn
      place="inbox"
      title="Inbox"
      threads={threads}
      status="ready"
      online
      revoked={false}
      heldCount={0}
      unreadCount={0}
      onOpenThread={vi.fn()}
      onArchiveThread={vi.fn()}
      onArchiveMany={vi.fn()}
      onOpenScreener={vi.fn()}
      onSendTest={vi.fn()}
      onRetry={vi.fn()}
      onConnectGmail={vi.fn()}
      {...overrides}
    />,
  );
}

describe('MailListColumn keyboard cursor', () => {
  it('moves the cursor with j/k independently of the open thread (§5.5, D29)', () => {
    const threads = [
      makeThread('t1', 'First', 0),
      makeThread('t2', 'Second', 0),
      makeThread('t3', 'Third', 0),
    ];
    const { container } = renderList(threads);
    const rows = () => container.querySelectorAll('[role="listitem"]');

    expect(rows()[0]).toHaveClass(rowStyles.cursor);

    fireEvent.keyDown(window, { key: 'j' });
    expect(rows()[1]).toHaveClass(rowStyles.cursor);
    expect(rows()[0]).not.toHaveClass(rowStyles.cursor);

    fireEvent.keyDown(window, { key: 'j' });
    expect(rows()[2]).toHaveClass(rowStyles.cursor);

    fireEvent.keyDown(window, { key: 'k' });
    expect(rows()[1]).toHaveClass(rowStyles.cursor);

    fireEvent.keyDown(window, { key: 'Home' });
    expect(rows()[0]).toHaveClass(rowStyles.cursor);

    fireEvent.keyDown(window, { key: 'End' });
    expect(rows()[2]).toHaveClass(rowStyles.cursor);
  });

  it('opens the cursor row on Enter and does nothing while a text field has focus', () => {
    const threads = [makeThread('t1', 'First', 0), makeThread('t2', 'Second', 0)];
    const onOpenThread = vi.fn();
    renderList(threads, { onOpenThread });

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpenThread).toHaveBeenCalledWith('t2');

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    onOpenThread.mockClear();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onOpenThread).not.toHaveBeenCalled();
    input.remove();
  });
});
