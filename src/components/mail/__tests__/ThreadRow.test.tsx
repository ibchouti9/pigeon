import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ThreadRow, type ThreadRowProps } from '../ThreadRow';
import rowStyles from '../ThreadRow.module.css';

function baseProps(overrides: Partial<ThreadRowProps> = {}): ThreadRowProps {
  return {
    sender: 'Dana Whitlock',
    senderEmail: 'dana@lumenpartners.com',
    subject: 'Contract redlines back from legal',
    snippet: 'Legal returned the MSA with three changes',
    timestamp: '2:14 PM',
    timestampSpoken: '2 hours ago',
    unread: false,
    messageCount: 1,
    hasAttachment: false,
    isNewlyApproved: false,
    checked: false,
    cursor: false,
    open: false,
    place: 'inbox',
    online: true,
    tabIndex: 0,
    onOpen: vi.fn(),
    onToggleCheck: vi.fn(),
    onArchive: vi.fn(),
    ...overrides,
  };
}

describe('ThreadRow', () => {
  it('renders the unread dot and 600-weight subject only when unread (D17)', () => {
    const { container, rerender } = render(<ThreadRow {...baseProps({ unread: false })} />);
    expect(container.querySelector(`.${rowStyles.dot}`)).not.toBeInTheDocument();
    expect(container.querySelector(`.${rowStyles.subjectUnread}`)).not.toBeInTheDocument();
    expect(container.querySelector(`.${rowStyles.subject}`)).toBeInTheDocument();

    rerender(<ThreadRow {...baseProps({ unread: true })} />);
    expect(container.querySelector(`.${rowStyles.dot}`)).toBeInTheDocument();
    expect(container.querySelector(`.${rowStyles.subjectUnread}`)).toBeInTheDocument();
  });

  it('keeps cursor, open and checked individually legible when all three are true (D29)', () => {
    const { container } = render(
      <ThreadRow {...baseProps({ cursor: true, open: true, checked: true })} />,
    );
    const row = container.querySelector('[role="listitem"]');
    expect(row).not.toBeNull();
    // outline (cursor), fill (checked wins over open's fill) and the open left
    // bar must all be present at once — none of the three may be dropped.
    expect(row).toHaveClass(rowStyles.cursor);
    expect(row).toHaveClass(rowStyles.fillChecked);
    expect(row).toHaveClass(rowStyles.hasBar);
    expect(row?.querySelector('button[aria-current]')).not.toBeNull();
  });

  it('reflects each state independently when only one is true', () => {
    const { container: cursorOnly } = render(<ThreadRow {...baseProps({ cursor: true })} />);
    const cursorRow = cursorOnly.querySelector('[role="listitem"]');
    expect(cursorRow).toHaveClass(rowStyles.cursor);
    expect(cursorRow).not.toHaveClass(rowStyles.fillOpen);
    expect(cursorRow).not.toHaveClass(rowStyles.fillChecked);
    expect(cursorRow).not.toHaveClass(rowStyles.hasBar);

    const { container: openOnly } = render(<ThreadRow {...baseProps({ open: true })} />);
    const openRow = openOnly.querySelector('[role="listitem"]');
    expect(openRow).toHaveClass(rowStyles.fillOpen);
    expect(openRow).toHaveClass(rowStyles.hasBar);
    expect(openRow).not.toHaveClass(rowStyles.cursor);

    const { container: checkedOnly } = render(<ThreadRow {...baseProps({ checked: true })} />);
    const checkedRow = checkedOnly.querySelector('[role="listitem"]');
    expect(checkedRow).toHaveClass(rowStyles.fillChecked);
    expect(checkedRow).not.toHaveClass(rowStyles.hasBar);
  });

  it('gives the row button an accessible name of "{sender}, {subject}, {relative time}[, unread]"', () => {
    const { getByRole } = render(<ThreadRow {...baseProps({ unread: true })} />);
    const button = getByRole('button', {
      name: 'Dana Whitlock, Contract redlines back from legal, 2 hours ago, unread',
    });
    expect(button).toBeInTheDocument();
  });
});
