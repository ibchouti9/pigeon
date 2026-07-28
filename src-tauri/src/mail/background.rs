//! One wake-up's worth of work.
//!
//! iOS gives a background app roughly thirty seconds and no webview, so this
//! is the whole of what Pigeon does with them: open a connection, ask what
//! arrived since last time, keep the messages from people the user has
//! approved, and hand back one line to notify with.
//!
//! Everything here is deliberately cheap. No bodies are fetched, no threads
//! are grouped, nothing is cached for the foreground to reuse — a wake-up that
//! runs out of time is a wake-up iOS schedules less often, and the budget is
//! better spent finishing than on work the app will redo anyway when someone
//! actually opens it.

use std::path::{Path, PathBuf};

use mail_parser::MessageParser;

use super::allowlist;
use super::session;

/// The most arrivals worth reading headers for in one wake-up.
///
/// A mailbox that gathered four hundred messages while the phone was in a
/// pocket does not need four hundred `From` headers parsed to produce the
/// sentence "12 new messages" — and the wake-up that tried would be killed
/// halfway. The count stays honest; only the names come from this many.
const HEADER_CAP: usize = 40;

/// What one wake-up found. `None` from [`check`] means nothing to say.
#[derive(Debug, Clone, PartialEq)]
pub struct Arrivals {
    /// How many messages arrived from allowed senders.
    pub count: u32,
    /// Distinct sender names, newest first, capped by `HEADER_CAP`.
    pub names: Vec<String>,
    /// The subject, when there is exactly one message to describe.
    pub subject: Option<String>,
}

fn mark_path(dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    Ok(dir.join("last-seen-uid"))
}

fn read_mark(dir: &Path) -> Option<u32> {
    std::fs::read_to_string(mark_path(dir).ok()?)
        .ok()?
        .trim()
        .parse()
        .ok()
}

fn write_mark(dir: &Path, uid: u32) {
    if let Ok(path) = mark_path(dir) {
        let _ = std::fs::write(path, uid.to_string());
    }
}

/// The address a message is from, lowercased, and the name to show for it.
fn sender(header: &[u8]) -> Option<(String, String)> {
    let parsed = MessageParser::default().parse(header)?;
    let first = parsed.from().and_then(|a| a.first())?;
    let email = first.address()?.trim().to_lowercase();
    if email.is_empty() {
        return None;
    }
    let name = first
        .name()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| email.clone());
    Some((email, name))
}

fn subject_of(header: &[u8]) -> Option<String> {
    let parsed = MessageParser::default().parse(header)?;
    parsed
        .subject()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Looks for mail worth waking someone for. `Ok(None)` means there is none.
pub fn check(dir: &Path) -> Result<Option<Arrivals>, String> {
    /*
     * An empty set is the answer before the app has ever been opened, and the
     * answer after a sign-out. Both mean the same thing here — there is nobody
     * this process is allowed to announce — and asking Gmail anyway would spend
     * the whole budget learning that.
     */
    let allowed = allowlist::load(dir);
    if allowed.is_empty() {
        return Ok(None);
    }

    let mut session = session::open_stored()?;
    session.select("INBOX").map_err(|e| e.to_string())?;

    let mark = read_mark(dir);

    /*
     * `UID n:*` and not `UNSEEN`.
     *
     * Unread is a state, not an event: it stays true for every message the
     * user has not opened, so a search on it would rediscover the same
     * fortnight of mail at every wake-up and notify about all of it again. A
     * UID high-water mark asks the question that was meant — what has arrived
     * since I last looked.
     */
    let from_uid = mark.map(|m| m.saturating_add(1)).unwrap_or(1);
    let found = session
        .uid_search(format!("UID {from_uid}:*"))
        .map_err(|e| e.to_string())?;

    /*
     * IMAP's `n:*` is a range, not a filter: when the mailbox's highest UID is
     * below `n` the server still returns that highest one, because a range
     * whose ends are reversed is read as `*:n`. Without this line every
     * wake-up on a quiet mailbox re-announces the newest message forever.
     */
    let mut uids: Vec<u32> = found.into_iter().filter(|uid| *uid >= from_uid).collect();
    uids.sort_unstable();

    let Some(highest) = uids.last().copied() else {
        return Ok(None);
    };

    /*
     * The first wake-up is a baseline, not news — the same rule the foreground
     * notice follows, and for the same reason. Without it, the first refresh
     * after installing announces the whole inbox.
     */
    if mark.is_none() {
        write_mark(dir, highest);
        return Ok(None);
    }

    // Newest first: if the cap bites, the names kept are the recent ones.
    let newest: Vec<u32> = uids.iter().rev().take(HEADER_CAP).copied().collect();
    let set = newest
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let fetched = session
        .uid_fetch(set, "(UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])")
        .map_err(|e| e.to_string())?;

    let mut names: Vec<String> = Vec::new();
    let mut count = 0u32;
    let mut only_subject = None;

    for message in fetched.iter() {
        let Some(header) = message.header() else {
            continue;
        };
        let Some((email, name)) = sender(header) else {
            continue;
        };
        if !allowed.contains(&email) {
            continue;
        }
        count += 1;
        if count == 1 {
            only_subject = subject_of(header);
        }
        if !names.contains(&name) {
            names.push(name);
        }
    }

    /*
     * The mark moves past everything examined, not just everything announced.
     * Leaving it behind on a message from someone unapproved would make every
     * later wake-up re-read that message, and the mailbox would slowly become
     * a growing range that never clears.
     */
    write_mark(dir, highest);

    if count == 0 {
        return Ok(None);
    }

    Ok(Some(Arrivals {
        count,
        names,
        subject: if count == 1 { only_subject } else { None },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &[u8] =
        b"From: Dana Whitlock <Dana@LumenPartners.com>\r\nSubject: Contract redlines\r\n\r\n";

    #[test]
    fn reads_the_sender_and_lowercases_the_address() {
        let (email, name) = sender(HEADER).expect("a From header");
        // Lowercased, because the allowlist is — and `Dana@` failing to match
        // `dana@` would be a silence nobody could explain.
        assert_eq!(email, "dana@lumenpartners.com");
        assert_eq!(name, "Dana Whitlock");
    }

    #[test]
    fn falls_back_to_the_address_when_there_is_no_display_name() {
        let (_, name) = sender(b"From: dana@lumenpartners.com\r\n\r\n").expect("a From header");
        assert_eq!(name, "dana@lumenpartners.com");
    }

    #[test]
    fn reads_the_subject() {
        assert_eq!(subject_of(HEADER).as_deref(), Some("Contract redlines"));
    }

    #[test]
    fn an_empty_subject_is_none_rather_than_an_empty_line() {
        assert_eq!(subject_of(b"From: a@b.com\r\nSubject:  \r\n\r\n"), None);
    }

    #[test]
    fn a_header_with_no_from_yields_nothing() {
        assert!(sender(b"Subject: orphan\r\n\r\n").is_none());
    }
}
