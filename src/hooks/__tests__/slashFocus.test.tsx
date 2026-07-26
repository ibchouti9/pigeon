import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { useGlobalShortcuts } from '../useGlobalShortcuts';

/**
 * §5.11 gives two interactions that have to compose: "`/` focuses the field
 * from anywhere" and "`↓` from the field moves the cursor into results".
 *
 * `/` always went to the rail's field, and only Search's own query bar can move
 * a cursor into results it owns — so on that screen the pair was dead: the
 * field took focus and `↓` did nothing at all.
 */

function Harness({ withResults }: { withResults: boolean }) {
  const railRef = useRef<HTMLInputElement>(null);
  useGlobalShortcuts(railRef);

  return (
    <>
      <input ref={railRef} type="search" aria-label="Rail field" data-search-field="rail" />
      {withResults && (
        <input type="search" aria-label="Results field" data-search-field="results" />
      )}
    </>
  );
}

function renderHarness(withResults: boolean) {
  return render(
    <MemoryRouter initialEntries={['/search?q=atlas']}>
      <Harness withResults={withResults} />
    </MemoryRouter>,
  );
}

describe('the / shortcut', () => {
  it('goes to the query bar on a screen that has one', () => {
    renderHarness(true);

    fireEvent.keyDown(window, { key: '/' });

    expect(screen.getByLabelText('Results field')).toHaveFocus();
  });

  it('falls back to the rail everywhere else', () => {
    renderHarness(false);

    fireEvent.keyDown(window, { key: '/' });

    expect(screen.getByLabelText('Rail field')).toHaveFocus();
  });
});
