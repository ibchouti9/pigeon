import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { highlightTerms } from '../highlight';

function renderHighlight(text: string, query: string) {
  return render(<p data-testid="out">{highlightTerms(text, query, 'mark')}</p>);
}

describe('highlightTerms', () => {
  it('marks a matched term', () => {
    renderHighlight('Intro to the Atlas team', 'atlas');
    const marks = screen.getByTestId('out').querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('Atlas');
  });

  it('is case-insensitive but preserves the original casing', () => {
    renderHighlight('ATLAS and atlas', 'Atlas');
    const marks = screen.getByTestId('out').querySelectorAll('mark');
    expect([...marks].map((m) => m.textContent)).toEqual(['ATLAS', 'atlas']);
  });

  it('marks every term in a multi-word query', () => {
    renderHighlight('Atlas integration work', 'atlas integration');
    expect(screen.getByTestId('out').querySelectorAll('mark')).toHaveLength(2);
  });

  it('ignores one-character terms', () => {
    renderHighlight('a b atlas', 'a atlas');
    const marks = screen.getByTestId('out').querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('atlas');
  });

  it('treats regex metacharacters as literal text', () => {
    renderHighlight('Cost is $500 (net)', '$500');
    const marks = screen.getByTestId('out').querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('$500');
  });

  it('leaves the text intact when nothing matches', () => {
    renderHighlight('Contract redlines', 'atlas');
    expect(screen.getByTestId('out').querySelectorAll('mark')).toHaveLength(0);
    expect(screen.getByTestId('out').textContent).toBe('Contract redlines');
  });

  it('returns the text unchanged for an empty query', () => {
    renderHighlight('Contract redlines', '   ');
    expect(screen.getByTestId('out').textContent).toBe('Contract redlines');
  });
});
