import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useMail } from '../store/mail';
import { useUi } from '../store/ui';
import { useCompose } from '../store/compose';
import { useSettings } from '../store/settings';
import { MockMailProvider } from '../data/mock/mockProvider';
import { ComposeDock } from '../components/compose/ComposeDock';
import { BulkReview } from '../components/screener/BulkReview';
import { AssistantSettings } from '../routes/settings/AssistantSettings';
import { ThreadRow } from '../components/mail/ThreadRow';
import { HeldMessageSheet } from '../components/screener/HeldMessageSheet';
import { useMinimumVisible } from '../hooks/useMinimumVisible';
import { makeHeldList } from '../components/screener/__tests__/fixtures';

function resetStores() {
  localStorage.clear();
  MockMailProvider.reset();
  useMail.getState().setProvider(new MockMailProvider());
  useUi.setState({ heldSheetSenderId: null, dialog: null, shortcutsOpen: false });
  useCompose.getState().close();
}

/**
 * §5.12 binds send to ⌘Enter. A single text input inside a form means the
 * browser submits it on Enter, so leaving the subject line — close to a reflex —
 * sent the message, recoverable only inside the 8s undo window.
 */
describe('Enter in the subject line (§5.12)', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('moves to the body instead of sending', async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(useMail.getState().provider, 'send');

    useCompose.getState().open({ to: [{ name: 'Dana', email: 'dana@lumen.com' }] });
    render(
      <MemoryRouter>
        <ComposeDock />
      </MemoryRouter>,
    );

    const subject = screen.getByLabelText('Subject');
    await user.click(subject);
    await user.keyboard('Redlines{Enter}');

    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Message body' })).toHaveFocus();
    expect(useCompose.getState().draft).not.toBeNull();
  });
});

/**
 * §4.7 requires a visually hidden prefix on every AI surface, and §8.5 item 6
 * makes it a quality gate. The bulk row had the glyph and nothing else — and
 * because the read sits inside the row button, the button's accessible name ran
 * the AI sentence straight on from the subject with no provenance at all.
 */
describe('the bulk row AI read carries its prefix (§4.7)', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it('names Pigeon in the accessible text', () => {
    const held = makeHeldList(['a', 'b']);
    render(
      <BulkReview
        held={held}
        status="ready"
        reads={{ [held[0].sender.id]: 'Cold sales mail from a list — no reply history.' }}
        online
        checked={new Set()}
        onCheckedChange={vi.fn()}
        onToggleView={vi.fn()}
        onOpenSheet={vi.fn()}
      />,
    );

    const row = screen.getAllByRole('listitem')[0];
    expect(row.textContent).toContain("Pigeon's read of this sender:");
    expect(row.textContent).toContain('Cold sales mail from a list');
  });
});

/**
 * §5.13c gives the pill three states. Only "Connected" was ever rendered, gated
 * on whether a key string existed rather than on whether it worked — so a
 * revoked key showed green while every AI surface silently failed.
 */
describe('the provider status pill (§5.13c)', () => {
  beforeEach(() => {
    resetStores();
    useSettings.setState({
      provider: { provider: 'anthropic', apiKey: 'sk-ant-test', baseUrl: '', model: 'claude-sonnet-5' },
    });
  });
  afterEach(cleanup);

  function renderSettings() {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<AssistantSettings />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('says Connected after a good test', () => {
    useSettings.setState({ connection: 'connected' });
    renderSettings();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('says Key rejected after a bad one', () => {
    useSettings.setState({ connection: 'rejected' });
    renderSettings();
    expect(screen.getByText('Key rejected')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('says Not connected before any test', () => {
    useSettings.setState({ connection: 'unknown' });
    renderSettings();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });
});

/**
 * §4.2 — the arrival ring shows "for 24 hours". It was keyed on the presence of
 * an approval date alone, so it never came off.
 */
describe('the arrival ring expires (§4.2)', () => {
  afterEach(cleanup);

  function renderRow(approvedAt: string | undefined) {
    render(
      <ThreadRow
        sender="Dana Whitlock"
        senderEmail="dana@lumen.com"
        subject="Contract redlines"
        snippet="Back from legal."
        timestamp="1:47 AM"
        timestampSpoken="an hour ago"
        unread={false}
        messageCount={1}
        hasAttachment={false}
        isNewlyApproved={Boolean(
          approvedAt && Date.now() - new Date(approvedAt).getTime() < 24 * 60 * 60 * 1000,
        )}
        checked={false}
        cursor={false}
        open={false}
        place="inbox"
        online
        tabIndex={0}
        onOpen={vi.fn()}
        onToggleCheck={vi.fn()}
        onArchive={vi.fn()}
      />,
    );
  }

  const label = 'First message since you approved this sender';

  it('shows the ring within 24 hours, under the spec’s own label', () => {
    renderRow(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('drops it after 24 hours', () => {
    renderRow(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  });
});

/** C-21 — "rendered for a minimum of 200ms once shown, to avoid a flash". */
describe('useMinimumVisible (C-21)', () => {
  it('holds a skeleton that would otherwise flash', async () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ active }) => useMinimumVisible(active, 200), {
        initialProps: { active: true },
      });
      expect(result.current).toBe(true);

      // Answered in 40ms — far too fast to have been seen.
      act(() => void vi.advanceTimersByTime(40));
      rerender({ active: false });
      expect(result.current).toBe(true);

      act(() => void vi.advanceTimersByTime(200));
      expect(result.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a slow load finish immediately', async () => {
    const { result, rerender } = renderHook(({ active }) => useMinimumVisible(active, 1), {
      initialProps: { active: true },
    });

    await new Promise((r) => setTimeout(r, 20));
    rerender({ active: false });
    await waitFor(() => expect(result.current).toBe(false));
  });
});

/**
 * §5.9's loading state. Deep-linking to /screener/s/:id on a cold start fell
 * straight through to "This message didn't load." while the held list was still
 * on its way — a false error, on the one path where the sheet is the first
 * thing a user sees.
 */
describe('the held sheet while the list is still loading (§5.9)', () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  function renderSheet() {
    render(
      <MemoryRouter>
        <HeldMessageSheet />
      </MemoryRouter>,
    );
  }

  it('shows skeleton bars, not an error', () => {
    useMail.setState((s) => ({ held: [], status: { ...s.status, held: 'loading' } }));
    useUi.getState().openHeldSheet('s-held-0');
    renderSheet();

    expect(screen.getByText('Loading message')).toBeInTheDocument();
    expect(screen.queryByText(/didn't load/)).not.toBeInTheDocument();
  });

  it('shows the error once the list has arrived without it', () => {
    useMail.setState((s) => ({ held: [], status: { ...s.status, held: 'ready' } }));
    useUi.getState().openHeldSheet('gone');
    renderSheet();

    expect(screen.getByText(/didn't load/)).toBeInTheDocument();
  });

  it('keeps the decision buttons in the error state', () => {
    useMail.setState((s) => ({ held: [], status: { ...s.status, held: 'ready' } }));
    useUi.getState().openHeldSheet('gone');
    renderSheet();

    expect(screen.getByRole('button', { name: 'Decline sender' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve sender' })).toBeEnabled();
  });
});
