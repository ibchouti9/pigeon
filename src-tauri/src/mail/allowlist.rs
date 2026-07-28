//! Who may interrupt you, in a form a background wake-up can read.
//!
//! §2.3's rule — approved reaches the inbox, unknown waits in the Screener —
//! is decided in TypeScript, against `localStorage` and a cutoff date, and
//! Gmail knows nothing about it: the INBOX on the server holds everyone.
//!
//! That is fine while Pigeon is open, and useless the moment it is not. iOS
//! wakes the app into a *fresh process* with no webview and no `localStorage`,
//! and something has to decide whether the message that just arrived is worth
//! a notification. So the answer is mirrored down here as a flat set of
//! addresses, rewritten whenever the senders change.
//!
//! It is a projection of the rule, not the rule. The full test also involves
//! the screening cutoff and a thread's own start date, which are not worth
//! reimplementing across the boundary — so an address that is not in this set
//! simply gets no notification, and the mail waits in the Screener where it
//! was going anyway. Being wrong in that direction costs a notification.
//! Being wrong in the other costs the entire promise of the product.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

const FILE: &str = "notify-allowlist.json";

/*
 * A directory, not an `AppHandle`.
 *
 * The reader of this file is a process iOS started to run a background task,
 * where there may be no Tauri app to ask for anything — the Swift side knows
 * its own container path and passes it in. The foreground resolves the same
 * directory through `AppHandle` and hands it down, so both halves read one
 * file without the background half depending on the app existing.
 */
fn path(dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    Ok(dir.join(FILE))
}

/// Replaces the stored set.
///
/// Addresses are lowercased on the way in so the background check never has to
/// remember to: mail headers are mixed case, and `Dana@` failing to match
/// `dana@` would be a silence nobody could explain.
pub fn store(dir: &Path, emails: &[String]) -> Result<(), String> {
    let normalised: Vec<String> = emails
        .iter()
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect();
    let json = serde_json::to_string(&normalised).map_err(|e| e.to_string())?;
    std::fs::write(path(dir)?, json).map_err(|e| e.to_string())
}

/// The stored set, or an empty one.
///
/// Empty means nothing is notified about — the honest failure, and the same
/// answer this gives before the app has ever been opened. A wake-up that
/// cannot read the file says nothing, rather than everything.
pub fn load(dir: &Path) -> HashSet<String> {
    let Ok(file) = path(dir) else {
        return HashSet::new();
    };
    let Ok(raw) = std::fs::read_to_string(file) else {
        return HashSet::new();
    };
    serde_json::from_str::<Vec<String>>(&raw)
        .map(|list| list.into_iter().collect())
        .unwrap_or_default()
}

/// Forgets the set. Called when the account is disconnected, so a background
/// wake-up after a sign-out has nobody it is allowed to announce.
pub fn clear(dir: &Path) {
    if let Ok(file) = path(dir) {
        let _ = std::fs::remove_file(file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory of this test's own, so the two halves of the round trip are
    /// not reading whatever the last run left behind.
    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pigeon-allowlist-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn stores_and_reads_back_lowercased() {
        let dir = temp();
        store(&dir, &["Dana@LumenPartners.com".into(), " priya@atlasgrid.dev ".into()]).unwrap();
        let set = load(&dir);
        assert!(set.contains("dana@lumenpartners.com"));
        assert!(set.contains("priya@atlasgrid.dev"));
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn a_missing_file_allows_nobody() {
        assert!(load(&temp()).is_empty());
    }

    /// The failure that matters: unreadable must mean silence, never "notify
    /// about everything".
    #[test]
    fn unreadable_contents_allow_nobody() {
        let dir = temp();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE), "{ this is not a list }").unwrap();
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn clearing_leaves_nobody() {
        let dir = temp();
        store(&dir, &["dana@lumenpartners.com".into()]).unwrap();
        clear(&dir);
        assert!(load(&dir).is_empty());
    }
}
