import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HtmlBody } from '../HtmlBody';

/**
 * C-8's blocked-images state, which was unreachable for the whole life of the
 * product: bodies rendered as plain text, so no image was ever requested and
 * there was never anything to block (PROGRESS deviation 14).
 */
describe('HtmlBody', () => {
  afterEach(cleanup);

  const pixel = '<p>Hello</p><img src="https://track.test/open.gif" width="1">';

  it('says how the images are being handled, rather than dropping them quietly', () => {
    render(<HtmlBody html={pixel} allowImages={false} fallbackText="Hello" />);
    expect(screen.getByText("Images aren't loaded.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show images' })).toBeInTheDocument();
  });

  it('loads them when asked, and stops saying they are blocked', () => {
    render(<HtmlBody html={pixel} allowImages={false} fallbackText="Hello" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show images' }));
    expect(screen.queryByText("Images aren't loaded.")).not.toBeInTheDocument();
  });

  it('says nothing at all for an established sender', () => {
    render(<HtmlBody html={pixel} allowImages fallbackText="Hello" />);
    expect(screen.queryByText("Images aren't loaded.")).not.toBeInTheDocument();
  });

  it('renders the body inside a frame that cannot run anything', () => {
    const { container } = render(
      <HtmlBody html="<p>Hello</p>" allowImages fallbackText="Hello" />,
    );
    const frame = container.querySelector('iframe');
    const sandbox = frame?.getAttribute('sandbox') ?? '';
    // The whole security argument rests on this one absence.
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-forms');
    expect(sandbox).toContain('allow-same-origin');
  });

  it('falls back to the text when the markup sanitizes down to nothing', () => {
    // A body that was one tracking pixel and no content.
    render(
      <HtmlBody
        html="<script>x()</script>"
        allowImages
        fallbackText="The text half of this message."
      />,
    );
    expect(screen.getByText('The text half of this message.')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
