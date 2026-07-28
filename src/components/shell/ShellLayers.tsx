import { ComposeDock } from '../compose/ComposeDock';
import { HeldMessageSheet } from '../screener/HeldMessageSheet';
import { ShortcutsDialog } from './ShortcutsDialog';
import { AgentPanel } from '../agent/AgentPanel';
import { ToastStack } from './ToastStack';

/**
 * The five things that float over whatever screen is open, in the order they
 * stack.
 *
 * Both shells mount exactly this set, which is the point of it being one
 * component: the held-message sheet reached the Screener alone once, and a
 * held result opened from Search opened nothing at all while the app's whole
 * keyboard went dead behind a sheet the user could not see. That is the shape
 * of bug a second shell would otherwise reintroduce.
 */
export function ShellLayers() {
  return (
    <>
      <ComposeDock />
      <HeldMessageSheet />
      <ShortcutsDialog />
      <AgentPanel />
      <ToastStack />
    </>
  );
}
