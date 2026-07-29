import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useKeyboardOpen } from '../useKeyboardOpen';

function field(tag: 'input' | 'textarea' | 'div' = 'input') {
  const el = document.createElement(tag);
  if (tag === 'div') {
    el.tabIndex = 0;
    Object.defineProperty(el, 'isContentEditable', { value: true });
  }
  document.body.append(el);
  return el as HTMLElement;
}

describe('useKeyboardOpen', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is closed with focus on nothing in particular', () => {
    expect(renderHook(() => useKeyboardOpen()).result.current).toBe(false);
  });

  it('opens when a text field takes focus', () => {
    const input = field();
    const { result } = renderHook(() => useKeyboardOpen());

    act(() => input.focus());
    expect(result.current).toBe(true);
  });

  it('opens for a textarea and for anything contenteditable', () => {
    const area = field('textarea');
    const { result } = renderHook(() => useKeyboardOpen());

    act(() => area.focus());
    expect(result.current).toBe(true);

    const editable = field('div');
    act(() => editable.focus());
    expect(result.current).toBe(true);
  });

  /* A button raises no keyboard, and the tab bar has to survive being tapped. */
  it('stays closed for a button', () => {
    const button = document.createElement('button');
    document.body.append(button);
    const { result } = renderHook(() => useKeyboardOpen());

    act(() => button.focus());
    expect(result.current).toBe(false);
  });

  it('closes when the field lets go', async () => {
    const input = field();
    const { result } = renderHook(() => useKeyboardOpen());

    act(() => input.focus());
    act(() => input.blur());
    await waitFor(() => expect(result.current).toBe(false));
  });

  /*
   * The reason `focusout` is deferred a frame. Read synchronously it sees
   * `<body>` between two fields, and the tab bar flickers back on every time
   * the user moves from To to Subject.
   */
  it('stays open moving straight from one field to the next', async () => {
    const to = field();
    const subject = field();
    const { result } = renderHook(() => useKeyboardOpen());

    act(() => to.focus());
    act(() => subject.focus());
    expect(result.current).toBe(true);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('starts open when a field already had focus', () => {
    const input = field();
    input.focus();
    expect(renderHook(() => useKeyboardOpen()).result.current).toBe(true);
  });
});
