import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { StepList, type Step } from '../../../components/onboarding/StepList';
import { KnownSendersRoute } from '../KnownSendersRoute';

describe('O3 step list (§8.4)', () => {
  const steps: Step[] = [
    { key: 'connect', label: 'Connected marc@ferrum.dev', state: 'done' },
    { key: 'contacts', label: 'Read your contacts', state: 'done' },
    { key: 'history', label: 'Reading your mail history', state: 'current' },
    { key: 'senders', label: 'Working out who you know', state: 'pending' },
  ];

  afterEach(cleanup);

  it('is an ordered list, since the steps run in a fixed order', () => {
    const { container } = render(<StepList steps={steps} />);
    expect(container.querySelector('ol')).toBeTruthy();
    expect(container.querySelector('ul')).toBeNull();
  });

  it('says each step’s state in words, not only in the glyph', () => {
    render(<StepList steps={steps} />);
    const rows = screen.getAllByRole('listitem');

    expect(rows[0]).toHaveTextContent(/Connected marc@ferrum\.dev — done/);
    expect(rows[2]).toHaveTextContent(/Reading your mail history — in progress/);
    expect(rows[3]).toHaveTextContent(/Working out who you know — not started/);
  });

  it('keeps each row’s glyph out of the accessibility tree', () => {
    render(<StepList steps={steps} />);
    for (const row of screen.getAllByRole('listitem')) {
      expect(row.querySelector(':scope > [aria-hidden="true"]')).toBeTruthy();
    }
  });
});

/**
 * §5.3 — "Shift+↑/↓ extends a toggle range". Extension used to require an
 * anchor, and only Space set one, so a user who arrowed to a row and held
 * Shift+↓ just moved the cursor with nothing selected.
 */
describe('O4 range selection (§5.3)', () => {
  beforeEach(async () => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
  });

  afterEach(cleanup);

  async function renderO4() {
    render(
      <MemoryRouter>
        <KnownSendersRoute />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(3), {
      timeout: 3000,
    });
    return screen.getAllByRole('checkbox');
  }

  function tickedCount(): number {
    return screen.getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).length;
  }

  it('extends a range from the cursor without needing Space first', async () => {
    const user = userEvent.setup();
    const boxes = await renderO4();
    const before = tickedCount();

    // Untick everything so the count is unambiguous.
    for (const box of boxes) {
      if ((box as HTMLInputElement).checked) await user.click(box);
    }
    expect(tickedCount()).toBe(0);

    // The rows live in a focusable group; the keys are bound on the container.
    const list = screen.getByRole('group', { name: 'Known senders' });
    list.focus();

    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');

    // Cursor started at row 0 and extended through row 2.
    expect(tickedCount()).toBe(3);
    expect(before).toBeGreaterThan(0);
  });
});
