import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUi, isTypingTarget, shortcutsBlocked } from '../store/ui';
import { useCompose } from '../store/compose';
import { useToasts } from '../store/toast';

/**
 * §8.1 "Anywhere in the app". Single keys are disabled while focus is inside a
 * text field; Esc, ⌘Enter and ⌘J still reach their handlers.
 */
export function useGlobalShortcuts(searchRef: React.RefObject<HTMLInputElement | null>) {
  const navigate = useNavigate();
  const pendingG = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const ui = useUi.getState();
      const compose = useCompose.getState();
      const typing = isTypingTarget(e.target);

      // ⌘Z / Ctrl+Z — undo the newest available action.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        if (useToasts.getState().undoNewest()) e.preventDefault();
        return;
      }

      // Esc closes the topmost layer: dialog → sheet → composer → search.
      if (e.key === 'Escape') {
        if (ui.dialog) {
          ui.closeDialog();
          e.preventDefault();
        } else if (ui.shortcutsOpen) {
          ui.setShortcutsOpen(false);
          e.preventDefault();
        } else if (ui.heldSheetSenderId) {
          ui.closeHeldSheet();
          e.preventDefault();
        } else if (compose.draft && !compose.minimized) {
          compose.setMinimized(true);
          e.preventDefault();
        }
        return;
      }

      // Below here everything is an unmodified single key, so the modal layers
      // block it: `c` must not open a composer behind an open dialog, and
      // `g i` must not navigate out from under the held-message sheet.
      if (shortcutsBlocked(e)) return;

      // `g` then i / s / a / ,
      if (pendingG.current) {
        pendingG.current = false;
        if (gTimer.current) clearTimeout(gTimer.current);
        const target = { i: '/inbox', s: '/screener', a: '/archive', ',': '/settings' }[
          e.key.toLowerCase()
        ];
        if (target) {
          navigate(target);
          e.preventDefault();
          return;
        }
      }

      switch (e.key) {
        case 'g':
          pendingG.current = true;
          gTimer.current = setTimeout(() => {
            pendingG.current = false;
          }, 1200);
          e.preventDefault();
          break;
        case '/': {
          /*
           * §5.11 gives two interactions that have to compose: "`/` focuses the
           * field from anywhere" and "`↓` from the field moves the cursor into
           * results". Search renders its own query bar as a real input, and
           * only that one can move a cursor into results it owns — so on that
           * screen `/` belongs there. Sending it to the rail instead made the
           * pair dead: the field took focus and `↓` did nothing.
           */
          const onScreen = document.querySelector<HTMLInputElement>(
            '[data-search-field="results"]',
          );
          const field = onScreen ?? searchRef.current;
          field?.focus();
          if (!field) navigate('/search');
          e.preventDefault();
          break;
        }
        case 'c':
          compose.open();
          e.preventDefault();
          break;
        case '?':
          ui.setShortcutsOpen(true);
          e.preventDefault();
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, searchRef]);
}
