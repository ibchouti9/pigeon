import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useMail } from '../../../store/mail';
import { useCompose } from '../../../store/compose';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { ComposeDock } from '../ComposeDock';

/**
 * The composer collected attachments and the provider signature accepted them,
 * but neither send() call site passed them along — so every file was silently
 * dropped between the chip in the UI and the message on the wire. Nothing but
 * actually attaching a file and sending it could catch that.
 */
describe('composing with attachments (D20)', () => {
  let provider: MockMailProvider;

  beforeEach(() => {
    localStorage.clear();
    MockMailProvider.reset();
    provider = new MockMailProvider();
    useMail.getState().setProvider(provider);
    useCompose.getState().close();
  });

  function renderDock() {
    return render(
      <MemoryRouter>
        <ComposeDock />
      </MemoryRouter>,
    );
  }

  /**
   * A File that claims to be 26 MB without allocating it. The size check runs
   * before anything is read, so the bytes never matter — and materialising 26 MB
   * in jsdom is slow enough to destabilise the test.
   */
  function oversized(name: string, type: string): File {
    const file = new File(['x'], name, { type });
    Object.defineProperty(file, 'size', { value: 26 * 1024 * 1024 });
    return file;
  }

  async function attach(user: ReturnType<typeof userEvent.setup>, file: File) {
    // The input is display:none by design, so upload() has to target it directly.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
  }

  it('sends the attached file with the message', async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(provider, 'send');

    useCompose.getState().open({
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
      body: 'Redlines attached.',
    });
    renderDock();

    await attach(
      user,
      new File(['redline bytes'], 'contract-v3.pdf', { type: 'application/pdf' }),
    );

    await screen.findByText('contract-v3.pdf');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(send).toHaveBeenCalled());
    const sent = send.mock.calls[0][0];
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments?.[0]).toMatchObject({
      filename: 'contract-v3.pdf',
      mimeType: 'application/pdf',
    });
    expect(sent.attachments?.[0].data.length).toBeGreaterThan(0);

    // send() closes the dock asynchronously; let it settle inside this test
    // rather than leaking a close() into the next one.
    await waitFor(() => expect(useCompose.getState().draft).toBeNull());
  });

  it('carries the attachment onto the stored message', async () => {
    const user = userEvent.setup();

    useCompose.getState().open({
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
      body: 'Redlines attached.',
    });
    renderDock();

    await attach(user, new File(['bytes'], 'notes.txt', { type: 'text/plain' }));
    await screen.findByText('notes.txt');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(useCompose.getState().draft).toBeNull());
    const threads = await provider.listThreads('inbox');
    const message = threads
      .flatMap((t) => t.messages)
      .find((m) => m.isFromUser && m.body === 'Redlines attached.');
    expect(message?.attachments.map((a) => a.filename)).toEqual(['notes.txt']);
  });

  it('refuses a file that would push the message past 25 MB (D20)', async () => {
    const user = userEvent.setup();

    useCompose.getState().open({
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
    });
    renderDock();

    await attach(user, oversized('huge.mov', 'video/quicktime'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Attachments are limited to 25 MB/,
    );
    expect(screen.queryByText('huge.mov')).not.toBeInTheDocument();
  });

  it('drops a removed attachment before send', async () => {
    const user = userEvent.setup();
    const send = vi.spyOn(provider, 'send');

    useCompose.getState().open({
      to: [{ name: 'Dana Whitlock', email: 'dana@lumenpartners.com' }],
    });
    renderDock();

    await attach(user, new File(['a'], 'keep.txt', { type: 'text/plain' }));
    await attach(user, new File(['b'], 'drop.txt', { type: 'text/plain' }));
    await screen.findByText('drop.txt');

    await user.click(screen.getByRole('button', { name: 'Remove drop.txt' }));
    await waitFor(() => expect(screen.queryByText('drop.txt')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0][0].attachments?.map((a) => a.filename)).toEqual(['keep.txt']);
    await waitFor(() => expect(useCompose.getState().draft).toBeNull());
  });
});
