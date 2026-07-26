import { useUi } from '../../store/ui';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';

/**
 * D11 — exactly two actions in the whole product use a dialog: Sign out and
 * Disconnect Google account. Both are opened via `useUi().openDialog`; this
 * is the single place that dialog is rendered.
 *
 * Cancel is always the first focusable element in the dialog body, so it
 * gets initial focus via Dialog's own default (never the destructive
 * action) without needing an explicit `initialFocusRef`.
 */
export function ConfirmDialog() {
  const dialog = useUi((s) => s.dialog);
  const closeDialog = useUi((s) => s.closeDialog);

  return (
    <Dialog
      open={dialog !== null}
      onClose={closeDialog}
      title={dialog?.title ?? ''}
      actions={
        dialog && (
          <>
            <Button variant="secondary" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              variant={dialog.tone === 'destructive' ? 'secondary-destructive' : 'primary'}
              onClick={() => {
                dialog.onConfirm();
                closeDialog();
              }}
            >
              {dialog.primaryLabel}
            </Button>
          </>
        )
      }
    >
      {dialog?.body}
    </Dialog>
  );
}
