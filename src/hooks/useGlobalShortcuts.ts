import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUi, isTypingTarget } from '../store/ui';
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

      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

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
        case '/':
          searchRef.current?.focus();
          if (!searchRef.current) navigate('/search');
          e.preventDefault();
          break;
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
