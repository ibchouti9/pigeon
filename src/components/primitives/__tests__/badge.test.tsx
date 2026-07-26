import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Controls';

/**
 * C-4 existed as a component and the rail drew its own counts inline, so there
 * were two implementations of one rule and they disagreed: the component
 * truncated both variants at 99, the rail only the ring. The rail was right —
 * §6 puts the rule on the `ring` line, and the reason is geometric, the ring
 * being a fixed 24px circle while the plain variant is free-width text the
 * spec asks for tabular figures on.
 *
 * The rail now renders C-4 rather than reimplementing it, so this is the only
 * place the rule lives.
 */
describe('C-4 Badge', () => {
  it('never renders a zero', () => {
    const { container } = render(<Badge value={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count it has, on the plain variant', () => {
    render(<Badge value={342} />);
    expect(screen.getByText('342')).toBeInTheDocument();
  });

  it('keeps showing it above 99, because plain text has no width to run out of', () => {
    render(<Badge value={1247} />);
    expect(screen.getByText('1,247')).toBeInTheDocument();
  });

  it('truncates the ring at 99, because the ring is a fixed 24px circle', () => {
    render(<Badge value={120} variant="ring" />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('shows an exact 99 in the ring rather than truncating it', () => {
    render(<Badge value={99} variant="ring" />);
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('is hidden from screen readers — the nav item carries the spoken count', () => {
    render(<Badge value={7} variant="ring" />);
    expect(screen.getByText('7')).toHaveAttribute('aria-hidden', 'true');
  });
});
