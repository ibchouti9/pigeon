//! Changing mail: places, read state, and D7's silencing label.
//!
//! Everything is a label operation on Gmail. "Archive" is not a folder you
//! move mail into — it is the absence of the \Inbox label — so acting on a
//! conversation means STOREing X-GM-LABELS changes against its UIDs in All
//! Mail. The `imap` crate has no vocabulary for X-GM-LABELS, so these go as
//! raw commands whose only interesting answer is OK.

use super::fetch::thread_uids;
use super::session::{with_mailbox, ImapSession, Special};

const DECLINED_LABEL: &str = "Pigeon/Declined";

fn store(
    session: &mut ImapSession,
    uids: &[u32],
    change: &str,
) -> Result<(), imap::Error> {
    if uids.is_empty() {
        return Ok(());
    }
    let set = uids
        .iter()
        .map(|u| u.to_string())
        .collect::<Vec<_>>()
        .join(",");
    session
        .run_command_and_check_ok(&format!("UID STORE {set} {change}"))
}

/// §2.1 — exactly one place. Inbox is the \Inbox label; archive is its absence.
pub fn set_place(thread_id: String, place: String) -> Result<(), String> {
    with_mailbox(Special::AllMail, |session| {
        let uids = thread_uids(session, &thread_id)?;
        let change = if place == "inbox" {
            r#"+X-GM-LABELS ("\Inbox")"#
        } else {
            r#"-X-GM-LABELS ("\Inbox")"#
        };
        store(session, &uids, change)
    })
}

pub fn mark_read(thread_id: String, read: bool) -> Result<(), String> {
    with_mailbox(Special::AllMail, |session| {
        let uids = thread_uids(session, &thread_id)?;
        let change = if read { r"+FLAGS (\Seen)" } else { r"-FLAGS (\Seen)" };
        store(session, &uids, change)
    })
}

/// D7 — a declined sender's mail leaves the inbox under `Pigeon/Declined`,
/// in Gmail itself, so the user's real mailbox honours the decision too.
/// `silence` false is §3.2 3c's undo putting everything back.
pub fn silence(thread_id: String, silence: bool) -> Result<(), String> {
    with_mailbox(Special::AllMail, |session| {
        // Gmail refuses to STORE a label that doesn't exist; CREATE is
        // idempotent enough once "already exists" is not an error.
        if silence {
            if let Err(imap::Error::No(message)) = session.create(DECLINED_LABEL) {
                if !message.to_lowercase().contains("already") {
                    return Err(imap::Error::No(message));
                }
            }
        }

        let uids = thread_uids(session, &thread_id)?;
        // Two STOREs: adding one label and removing another are separate
        // commands in IMAP, whatever they are in Gmail's UI.
        if silence {
            store(session, &uids, &format!(r#"+X-GM-LABELS ("{DECLINED_LABEL}")"#))?;
            store(session, &uids, r#"-X-GM-LABELS ("\Inbox")"#)
        } else {
            store(session, &uids, &format!(r#"-X-GM-LABELS ("{DECLINED_LABEL}")"#))?;
            store(session, &uids, r#"+X-GM-LABELS ("\Inbox")"#)
        }
    })
}
