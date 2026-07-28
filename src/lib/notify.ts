import { isDesktop } from './desktop';

/**
 * System notifications, behind the same seam as everything else native.
 *
 * The plugin import is dynamic for the reason every Tauri import in this file
 * tree is: a static one pulls the bridge into the web bundle for code that can
 * never run there, and makes jsdom resolve a native module that does not
 * exist.
 */

/** What Pigeon is willing to interrupt someone for. */
export interface Notice {
  title: string;
  body: string;
}

/**
 * Whether we may notify, asking once if the answer is not yet known.
 *
 * macOS and iOS both answer "default" until asked, and asking is a system
 * prompt — so this is called at the moment the first notification would go
 * out rather than at launch. A permission dialog on first run, before the
 * user has any mail to be notified about, is a dialog with no context.
 */
export async function mayNotify(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    const { isPermissionGranted, requestPermission } = await import(
      '@tauri-apps/plugin-notification'
    );
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === 'granted';
  } catch {
    // A build without the plugin, or a platform that refused. Not being able
    // to notify is not an error worth surfacing anywhere.
    return false;
  }
}

export async function notify(notice: Notice): Promise<void> {
  if (!isDesktop()) return;
  try {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    sendNotification(notice);
  } catch {
    // Same: a notification that could not be posted is not worth a toast
    // about a notification that could not be posted.
  }
}
