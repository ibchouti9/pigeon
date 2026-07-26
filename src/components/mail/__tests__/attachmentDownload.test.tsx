import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMail } from '../../../store/mail';
import { useToasts } from '../../../store/toast';
import { MockMailProvider } from '../../../data/mock/mockProvider';
import { MailError } from '../../../data/provider';
import type { Message } from '../../../types';
import { MessageBlock } from '../MessageBlock';

/**
 * D20 — attachments are "receive, preview by filename, download", and §5.6 says
 * of the chip: "click downloads". The chip carried an accessible name reading
 * "Download plans-rev3.pdf" and no handler at all, which is worse than having
 * no affordance: it told the user it would work.
 */
describe('downloading an attachment (D20)', () => {
  let message: Message;
  let clicked: { download: string; href: string }[];
  let realClick: typeof HTMLAnchorElement.prototype.click;

  beforeEach(async () => {
    localStorage.clear();
    MockMailProvider.reset();
    useMail.getState().setProvider(new MockMailProvider());
    useToasts.setState({ toasts: [] });
    await useMail.getState().loadThreads('inbox');

    message = useMail
      .getState()
      .inbox.flatMap((t) => t.messages)
      .find((m) => m.attachments.length > 0)!;

    clicked = [];
    realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    };
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    HTMLAnchorElement.prototype.click = realClick;
    cleanup();
  });

  function renderBlock() {
    render(
      <MessageBlock
        message={message}
        senderName="Ines Carvalho"
        showAddress
        recipientsLabel="to you"
        collapsed={false}
        collapsible={false}
        onToggleCollapse={vi.fn()}
        quotedOpen={false}
        onToggleQuoted={vi.fn()}
      />,
    );
    const attachment = message.attachments[0];
    return screen.getByRole('button', { name: new RegExp(`^Download ${attachment.filename}`) });
  }

  it('saves the file under its own name', async () => {
    const user = userEvent.setup();
    const chip = renderBlock();

    await user.click(chip);

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0].download).toBe(message.attachments[0].filename);
  });

  it('asks the provider for the bytes of that attachment', async () => {
    const user = userEvent.setup();
    const download = vi.spyOn(useMail.getState().provider, 'downloadAttachment');
    const chip = renderBlock();

    await user.click(chip);

    await waitFor(() =>
      expect(download).toHaveBeenCalledWith(message.id, message.attachments[0].id),
    );
  });

  it('offers a retry when the download fails, and says where the file still is', async () => {
    const user = userEvent.setup();
    vi.spyOn(useMail.getState().provider, 'downloadAttachment').mockRejectedValue(
      new MailError('nope', 'not-found'),
    );
    const chip = renderBlock();

    await user.click(chip);

    await waitFor(() => expect(useToasts.getState().toasts).toHaveLength(1));
    const toast = useToasts.getState().toasts[0];
    expect(toast.message).toBe("This attachment didn't download. It's still in Gmail.");
    expect(toast.action?.label).toBe('Try again');
    expect(clicked).toHaveLength(0);
  });

  it('ignores a second click while the first is still running', async () => {
    const user = userEvent.setup();
    const releases: ((value: string) => void)[] = [];
    const download = vi
      .spyOn(useMail.getState().provider, 'downloadAttachment')
      .mockImplementation(() => new Promise<string>((r) => releases.push(r)));
    const chip = renderBlock();

    await user.click(chip);
    await user.click(chip);

    // The guard is on the request, not on the save: a second in-flight fetch
    // would download the same file twice the moment both resolved.
    expect(download).toHaveBeenCalledTimes(1);

    releases.forEach((r) => r(btoa('bytes')));
    await waitFor(() => expect(clicked).toHaveLength(1));
  });
});
