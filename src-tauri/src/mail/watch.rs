//! A second connection, whose only job is to notice.
//!
//! Pigeon polled the inbox once a minute, and the comment in `useMailRefresh`
//! said why: the engine holds one session behind a lock, so an IDLE would
//! block every other command behind it for minutes at a time. That is a reason
//! not to IDLE *on that connection*, not a reason not to IDLE — so this opens
//! its own, SELECTs INBOX, and sits there.
//!
//! What it emits is deliberately thin: "something changed in the inbox", with
//! no payload. Who the mail is from, whether that sender is approved, and
//! whether any of it is worth interrupting someone over are product rules, and
//! product rules live in TypeScript. Rust owns the socket.
//!
//! With one exception, and it is the case the whole feature exists for. When
//! the window is hidden the webview is throttled — on macOS an occluded one
//! may stop running script at all — so the notification you most want, the one
//! that arrives while you are doing something else, is exactly the one a
//! TypeScript hook cannot be relied on to post. So this posts it, using the
//! same `background::check` the iPhone wake-up runs. The hook skips whenever
//! the document is hidden; the two never both fire.

use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use imap::extensions::idle::WaitOutcome;
use imap::types::UnsolicitedResponse;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use super::background;
use super::session;

/// The event the webview listens for.
pub const INBOX_CHANGED: &str = "mail://inbox-changed";

/// How long one IDLE round lasts before it is torn down and re-issued.
///
/// RFC 2177 says re-issue within 29 minutes and the crate defaults to that.
/// Gmail is less patient — `session`'s own comment puts it at about ten
/// minutes — and this has a second job besides keeping the connection alive:
/// it is the longest the thread can take to notice it has been told to stop.
/// Four minutes is comfortably inside Gmail's limit and a tolerable wait for a
/// thread to end after a disconnect.
const ROUND: Duration = Duration::from_secs(4 * 60);

/// Backoff after a failed connection: doubling, from five seconds to five
/// minutes. A phone coming back onto a network and a laptop waking from sleep
/// both land here, and neither should hammer Gmail on the way up.
const RETRY_MIN: Duration = Duration::from_secs(5);
const RETRY_MAX: Duration = Duration::from_secs(5 * 60);

/// Which watcher is the live one.
///
/// A generation counter rather than a stop flag, because "stop" and "restart"
/// are the same operation here and both have to invalidate whatever is already
/// running. Connecting a second account, or reconnecting after a password
/// change, would otherwise leave the previous thread idling on the previous
/// credentials and emitting events about a mailbox nobody is looking at.
static EPOCH: AtomicU64 = AtomicU64::new(0);

/// Starts watching, and retires any watcher already running.
pub fn start(app: AppHandle) {
    let epoch = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || run(&app, epoch));
}

/// Retires the current watcher. It ends within one `ROUND`.
pub fn stop() {
    EPOCH.fetch_add(1, Ordering::SeqCst);
}

fn live(epoch: u64) -> bool {
    EPOCH.load(Ordering::SeqCst) == epoch
}

/// Sleeps, but in slices, so a retired watcher does not hold its socket for
/// the whole of a five-minute backoff.
fn sleep_while_live(epoch: u64, total: Duration) {
    let slice = Duration::from_secs(1);
    let mut left = total;
    while live(epoch) && !left.is_zero() {
        let step = slice.min(left);
        thread::sleep(step);
        left -= step;
    }
}

fn run(app: &AppHandle, epoch: u64) {
    let mut backoff = RETRY_MIN;
    while live(epoch) {
        match watch(app, epoch) {
            // Ended because it was retired, not because anything broke.
            Ok(()) => return,
            Err(reason) => {
                log::warn!("inbox watch dropped: {reason}");
                sleep_while_live(epoch, backoff);
                backoff = (backoff * 2).min(RETRY_MAX);
            }
        }
    }
}

/// One connection's worth of watching. Returns `Ok` only when retired.
fn watch(app: &AppHandle, epoch: u64) -> Result<(), String> {
    let mut session = session::open_stored()?;
    session.select("INBOX").map_err(|e| e.to_string())?;

    while live(epoch) {
        let outcome = {
            let mut idle = session.idle();
            idle.timeout(ROUND);
            /*
             * Without this the crate re-issues IDLE for us on timeout and
             * `wait_while` never returns until the mailbox changes — which
             * would be fine except that it also means the thread cannot be
             * asked to stop. Taking the round back gives every four minutes a
             * chance to check whether this watcher is still the live one.
             */
            idle.keepalive(false);
            idle.wait_while(mailbox_changed)
        };

        match outcome {
            Ok(WaitOutcome::MailboxChanged) => {
                // Re-checked after waking: a watcher retired mid-round must not
                // announce mail on its way out.
                if live(epoch) {
                    let _ = app.emit(INBOX_CHANGED, ());
                    announce_if_unwatched(app);
                }
            }
            Ok(WaitOutcome::TimedOut) => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

/// Whether anyone is actually looking at Pigeon.
///
/// A window that is hidden, minimized, or simply not there — the close button
/// hides rather than quits, so "no main window" is an ordinary state rather
/// than a broken one.
fn window_is_watched(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_visible().ok().zip(w.is_minimized().ok()))
        .map(|(visible, minimized)| visible && !minimized)
        .unwrap_or(false)
}

/// Posts the notification the webview cannot be trusted to post.
///
/// Runs `background::check` unconditionally so the UID mark stays current
/// whether or not anything is announced — a mark left behind while the window
/// was open would make the next hidden wake-up re-announce everything the user
/// had already read on screen.
fn announce_if_unwatched(app: &AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let Ok(Some(arrivals)) = background::check(&dir) else {
        return;
    };
    if window_is_watched(app) {
        return;
    }

    let (title, body) = arrivals.headline();
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

/// Whether an untagged response means the inbox is no longer what we listed.
///
/// `false` stops the wait — the crate's convention, and the reason this reads
/// backwards. `Exists` and `Recent` are mail arriving; `Expunge` is mail
/// leaving, including by Pigeon's own hand elsewhere in the app, which is
/// harmless: the refresh it triggers is served from a 30-second cache.
///
/// Everything else — flag changes, `OK` progress lines, Gmail's own chatter —
/// keeps the wait open. Waking the whole app because a `\Seen` flag moved is
/// how a live connection turns into a poll with extra steps.
fn mailbox_changed(response: UnsolicitedResponse) -> bool {
    !matches!(
        response,
        UnsolicitedResponse::Exists(_)
            | UnsolicitedResponse::Recent(_)
            | UnsolicitedResponse::Expunge(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrivals_and_removals_end_the_wait() {
        assert!(!mailbox_changed(UnsolicitedResponse::Exists(12)));
        assert!(!mailbox_changed(UnsolicitedResponse::Recent(1)));
        assert!(!mailbox_changed(UnsolicitedResponse::Expunge(3)));
    }

    /// The case that matters for battery: marking a thread read produces a
    /// FETCH, and waking the app for it would make this a poll with extra
    /// steps.
    #[test]
    fn a_flag_change_does_not() {
        assert!(mailbox_changed(UnsolicitedResponse::Fetch {
            id: 1,
            attributes: Vec::new(),
        }));
    }

    /*
     * `EPOCH` is one global, and cargo runs these on parallel threads — so
     * without this a claim as simple as "the epoch I just took is the live
     * one" is false whenever the other test bumps the counter between the two
     * lines. Serialised, not because the code needs a lock, but because a
     * shared counter cannot be observed by two tests at once.
     */
    static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn stopping_retires_the_running_watcher() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let epoch = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
        assert!(live(epoch));
        stop();
        assert!(!live(epoch));
    }

    /// Two starts in a row must leave exactly one live watcher — the second.
    #[test]
    fn a_restart_retires_the_previous_one() {
        let _guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let first = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
        let second = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
        assert!(!live(first));
        assert!(live(second));
        stop();
    }
}
