//! Listing and hydrating conversations.
//!
//! Gmail's IMAP extensions carry the whole product model: `X-GM-THRID` is
//! Gmail's own threading, `X-GM-MSGID` its stable message identity, and
//! `X-GM-RAW` full Gmail search syntax inside SEARCH. Everything here runs
//! against All Mail, because a conversation is one unit wherever its messages
//! sit — the inbox is a *view* (`in:inbox`), not a place messages live.
//!
//! Metadata comes from one raw FETCH kept deliberately single-line — no
//! ENVELOPE, no bodies — and parsed by `parse_meta_line`, which has its own
//! tests. Bodies go through the crate's typed FETCH.
//!
//! "Raw" is only about which items we read out of the answer, and it was once
//! believed to mean the crate never looked at it. It does look:
//! `run_command_and_read_response` parses every untagged line just to find the
//! tagged terminator, so a line its grammar rejects fails the whole command —
//! not the line. On imap-proto 0.10 the X-GM-* items had no grammar, and every
//! listing on every real Gmail account failed as
//! "Couldn't reach Gmail … (Unable to parse status response)": a request that
//! reached Gmail and came back, blamed on the network. The imap 3 / imap-proto
//! 0.16 upgrade is what made this file work at all; the pin in Cargo.toml and
//! `gmails_own_metadata_answer_survives_the_response_reader` both guard it.

use std::collections::HashMap;

use super::parse::parse_message;
use super::session::{refused, with_mailbox, ImapSession, Special, WorkError};
use super::types::{ListPage, MessageJson, ThreadJson, ThreadStub};

/// One message's cheap metadata, from the single-line pass.
#[derive(Debug, Clone, PartialEq)]
pub struct Meta {
    pub uid: u32,
    pub thrid: u64,
    pub msgid: Option<u64>,
    /// ISO 8601, converted from INTERNALDATE.
    pub date: String,
    pub unread: bool,
}

/// `* 5 FETCH (UID 123 X-GM-THRID 17512 X-GM-MSGID 17513 FLAGS (\Seen)
/// INTERNALDATE "01-Jul-2024 10:00:05 +0000")` → Meta. Returns None for any
/// line that isn't a FETCH data line (tagged OK, EXISTS, and friends).
pub fn parse_meta_line(line: &str) -> Option<Meta> {
    if !line.contains(" FETCH (") {
        return None;
    }
    let uid = capture_number(line, "UID ")?;
    let thrid = capture_number(line, "X-GM-THRID ")?;
    let msgid = capture_number(line, "X-GM-MSGID ");

    let date = line
        .split("INTERNALDATE \"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .and_then(internal_date_to_iso)
        .unwrap_or_default();

    // FLAGS (\Seen \Flagged) — unread is the absence of \Seen. `\Seen` cannot
    // appear anywhere else on this line: no ENVELOPE means no free text.
    let unread = !line.contains("\\Seen");

    Some(Meta { uid: uid as u32, thrid, msgid, date, unread })
}

fn capture_number(line: &str, key: &str) -> Option<u64> {
    let rest = line.split(key).nth(1)?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// "01-Jul-2024 10:00:05 +0000" → "2024-07-01T10:00:05+00:00".
fn internal_date_to_iso(raw: &str) -> Option<String> {
    chrono::DateTime::parse_from_str(raw, "%d-%b-%Y %H:%M:%S %z")
        .ok()
        .map(|d| d.to_rfc3339())
}

/// Escapes a user's search text into one quoted IMAP string. IMAP quoted
/// strings escape `\` and `"` — everything else rides through to X-GM-RAW,
/// which is the point: D7's search semantics are Gmail's own.
pub fn quote_imap(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        // Quoted strings cannot carry CRLF; a newline in a search box means
        // nothing anyway.
        if c == '\r' || c == '\n' {
            continue;
        }
        out.push(c);
    }
    out.push('"');
    out
}

/// The Gmail query for a place. Mirrors the REST provider it replaced, which
/// mirrors §2.1: the archive is everything that is in no other place.
fn place_query(place: &str) -> &'static str {
    if place == "inbox" {
        "in:inbox"
    } else {
        "-in:inbox -in:sent -in:drafts -in:chats"
    }
}

fn run_meta_fetch(session: &mut ImapSession, uids: &[u32]) -> Result<Vec<Meta>, imap::Error> {
    let mut metas = Vec::with_capacity(uids.len());
    for chunk in uids.chunks(1000) {
        let set = chunk
            .iter()
            .map(|u| u.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let response = session.run_command_and_read_response(&format!(
            "UID FETCH {set} (UID X-GM-THRID X-GM-MSGID FLAGS INTERNALDATE)"
        ))?;
        let text = String::from_utf8_lossy(&response);
        metas.extend(text.lines().filter_map(parse_meta_line));
    }
    Ok(metas)
}

/// Groups per-message metadata into newest-first thread stubs.
pub fn group_stubs(metas: Vec<Meta>) -> Vec<ThreadStub> {
    let mut by_thread: HashMap<u64, Vec<Meta>> = HashMap::new();
    for meta in metas {
        by_thread.entry(meta.thrid).or_default().push(meta);
    }

    let mut stubs: Vec<ThreadStub> = by_thread
        .into_iter()
        .map(|(thrid, mut messages)| {
            messages.sort_by(|a, b| a.uid.cmp(&b.uid));
            let last = messages.last().unwrap();
            ThreadStub {
                id: thrid.to_string(),
                last_message_at: messages
                    .iter()
                    .map(|m| m.date.as_str())
                    .max()
                    .unwrap_or_default()
                    .to_string(),
                unread: messages.iter().any(|m| m.unread),
                message_count: messages.len() as u32,
                last_uid: last.uid,
            }
        })
        .collect();

    stubs.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at));
    stubs
}

fn search_uids(session: &mut ImapSession, query: &str) -> Result<Vec<u32>, imap::Error> {
    let found = session.uid_search(query)?;
    let mut uids: Vec<u32> = found.into_iter().collect();
    uids.sort_unstable_by(|a, b| b.cmp(a));
    Ok(uids)
}

/// Every conversation in a place, as stubs. One SEARCH plus one line-per-
/// message FETCH — cheap enough to take the whole mailbox in one call, which
/// is what makes the walk resumable: the caller hydrates bodies thread by
/// thread and can stop anywhere.
pub fn list_threads(place: String) -> Result<ListPage, String> {
    with_mailbox(Special::AllMail, |session| {
        let uids = search_uids(
            session,
            &format!("X-GM-RAW {}", quote_imap(place_query(&place))),
        )?;
        let stubs = group_stubs(run_meta_fetch(session, &uids)?);
        Ok(ListPage { total: stubs.len() as u32, threads: stubs })
    })
}

/// D7's third place runs on Gmail's own query language, quoted straight
/// through to X-GM-RAW.
pub fn search_threads(query: String) -> Result<ListPage, String> {
    with_mailbox(Special::AllMail, |session| {
        let uids = search_uids(session, &format!("X-GM-RAW {}", quote_imap(&query)))?;
        let stubs = group_stubs(run_meta_fetch(session, &uids)?);
        Ok(ListPage { total: stubs.len() as u32, threads: stubs })
    })
}

/// One whole conversation, bodies included.
pub fn get_thread(thread_id: String) -> Result<ThreadJson, String> {
    let thrid: u64 = thread_id
        .parse()
        .map_err(|_| format!("Not a thread id: {thread_id}"))?;

    with_mailbox(Special::AllMail, |session| {
        let uids = {
            let mut u = search_uids(session, &format!("X-GM-THRID {thrid}"))?;
            u.sort_unstable(); // oldest first — reading order
            u
        };
        if uids.is_empty() {
            return Err(refused("This thread didn't load. It's still in Gmail."));
        }

        let metas: HashMap<u32, Meta> = run_meta_fetch(session, &uids)?
            .into_iter()
            .map(|m| (m.uid, m))
            .collect();

        // Membership, not labels: asking Gmail "which of this thread is in
        // the inbox" (and "which is the user's own send") avoids parsing
        // X-GM-LABELS' quoting rules at all. in:sent covers alias and "send
        // mail as" sends, which comparing From addresses never can.
        let inbox_uids = session.uid_search(format!("X-GM-THRID {thrid} X-GM-RAW \"in:inbox\""))?;
        let sent_uids = session.uid_search(format!("X-GM-THRID {thrid} X-GM-RAW \"in:sent\""))?;

        let mut messages: Vec<MessageJson> = Vec::with_capacity(uids.len());
        for chunk in uids.chunks(20) {
            let set = chunk
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let fetched = session.uid_fetch(set, "(UID BODY.PEEK[])")?;
            for fetch in fetched.iter() {
                let Some(uid) = fetch.uid else { continue };
                let raw = fetch.body().unwrap_or_default();
                let meta = metas.get(&uid);
                messages.push(parse_message(
                    raw,
                    uid,
                    meta.and_then(|m| m.msgid),
                    meta.map(|m| m.date.clone()).filter(|d| !d.is_empty()),
                    meta.map(|m| m.unread).unwrap_or(false),
                    sent_uids.contains(&uid),
                ));
            }
        }
        messages.sort_by(|a, b| a.uid.cmp(&b.uid));

        Ok(ThreadJson {
            id: thread_id.clone(),
            subject: messages
                .iter()
                .map(|m| m.subject.clone())
                .find(|s| !s.is_empty())
                .unwrap_or_default(),
            in_inbox: !inbox_uids.is_empty(),
            unread: messages.iter().any(|m| m.unread),
            last_message_at: messages
                .iter()
                .map(|m| m.date.clone())
                .max()
                .unwrap_or_default(),
            messages,
        })
    })
}

/// The UIDs of one conversation, for the action layer.
pub fn thread_uids(session: &mut ImapSession, thread_id: &str) -> Result<Vec<u32>, WorkError> {
    let thrid: u64 = thread_id
        .parse()
        .map_err(|_| refused(format!("Not a thread id: {thread_id}")))?;
    let mut uids: Vec<u32> = session
        .uid_search(format!("X-GM-THRID {thrid}"))?
        .into_iter()
        .collect();
    uids.sort_unstable();
    Ok(uids)
}

/// One attachment's bytes, base64. Refetches the one message rather than
/// having every thread fetch carry every attachment it will mostly not need.
pub fn attachment(uid: u32, index: usize) -> Result<String, String> {
    with_mailbox(Special::AllMail, |session| {
        let fetched = session.uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")?;
        let raw = fetched
            .iter()
            .find(|f| f.uid == Some(uid))
            .and_then(|f| f.body())
            .ok_or_else(|| refused("This attachment didn't load."))?;
        let bytes = super::parse::attachment_bytes(raw, index)
            .ok_or_else(|| refused("This attachment didn't load."))?;
        use base64::Engine;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Write};

    const LINE: &str = r#"* 5 FETCH (UID 123 X-GM-THRID 1751234567890 X-GM-MSGID 1751234567999 FLAGS (\Seen \Flagged) INTERNALDATE "01-Jul-2024 10:00:05 +0000")"#;

    /// A socket that replays one canned server response.
    struct Canned {
        reads: Cursor<Vec<u8>>,
        wrote: Vec<u8>,
    }

    impl Read for Canned {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.reads.read(buf)
        }
    }

    impl Write for Canned {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.wrote.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// Runs the metadata FETCH against a canned response, exactly as
    /// `run_meta_fetch` does.
    fn meta_fetch_against(response: &str) -> Result<Vec<u8>, imap::Error> {
        // a1 is the LOGIN that gets us a Session; a2 is the fetch under test.
        let script = format!("a1 OK Logged in\r\n{response}");
        let stream = Canned {
            reads: Cursor::new(script.into_bytes()),
            wrote: Vec::new(),
        };
        let mut session = imap::Client::new(stream)
            .login("user", "pass")
            .map_err(|(e, _)| e)
            .expect("canned login");
        session.run_command_and_read_response(
            "UID FETCH 123 (UID X-GM-THRID X-GM-MSGID FLAGS INTERNALDATE)",
        )
    }

    /// The first-run failure, pinned offline. `run_command_and_read_response`
    /// parses every line it reads just to find the tagged terminator, so a line
    /// it cannot parse fails the whole command — and on imap-proto 0.10 the
    /// X-GM-* items have no grammar at all. Every thread listing died here, as
    /// "Couldn't reach Gmail … (Unable to parse status response)", which named
    /// the network for a request the network had already delivered.
    ///
    /// This is the response Gmail actually sends. If the dependency ever slips
    /// back below imap-proto 0.16, this test fails before a real account has to.
    #[test]
    fn gmails_own_metadata_answer_survives_the_response_reader() {
        let gmail = format!("{LINE}\r\na2 OK Success\r\n");
        let response = meta_fetch_against(&gmail).expect("Gmail's own answer did not parse");

        // Read back the way `run_meta_fetch` reads it, so the test covers the
        // whole path and not just the crate's tolerance of the line.
        let metas: Vec<Meta> = String::from_utf8_lossy(&response)
            .lines()
            .filter_map(parse_meta_line)
            .collect();
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].uid, 123);
        assert_eq!(metas[0].thrid, 1751234567890);
    }

    /// The control: standard items only, which never depended on the upgrade.
    #[test]
    fn the_same_response_without_the_gmail_items_reads_fine() {
        let plain = concat!(
            r#"* 5 FETCH (UID 123 FLAGS (\Seen \Flagged) INTERNALDATE "01-Jul-2024 10:00:05 +0000")"#,
            "\r\na2 OK Success\r\n"
        );
        assert!(meta_fetch_against(plain).is_ok());
    }

    #[test]
    fn reads_a_gmail_fetch_line() {
        let meta = parse_meta_line(LINE).expect("no meta");
        assert_eq!(meta.uid, 123);
        assert_eq!(meta.thrid, 1751234567890);
        assert_eq!(meta.msgid, Some(1751234567999));
        assert_eq!(meta.date, "2024-07-01T10:00:05+00:00");
        assert!(!meta.unread);
    }

    #[test]
    fn unread_is_the_absence_of_seen() {
        let line = LINE.replace(r"\Seen \Flagged", r"\Flagged");
        assert!(parse_meta_line(&line).unwrap().unread);
    }

    #[test]
    fn item_order_does_not_matter() {
        // Servers may answer FETCH items in any order they like.
        let line = r#"* 9 FETCH (X-GM-MSGID 42 INTERNALDATE "28-Feb-2025 23:59:59 -0800" UID 7 FLAGS () X-GM-THRID 41)"#;
        let meta = parse_meta_line(line).expect("no meta");
        assert_eq!(meta.uid, 7);
        assert_eq!(meta.thrid, 41);
        assert_eq!(meta.msgid, Some(42));
        assert!(meta.unread);
        assert!(meta.date.starts_with("2025-02-28T23:59:59"));
    }

    #[test]
    fn ignores_lines_that_are_not_fetch_data() {
        assert_eq!(parse_meta_line("a1 OK Success"), None);
        assert_eq!(parse_meta_line("* 120 EXISTS"), None);
        assert_eq!(parse_meta_line(""), None);
    }

    #[test]
    fn a_missing_msgid_is_tolerated() {
        let line = r#"* 5 FETCH (UID 123 X-GM-THRID 90 FLAGS () INTERNALDATE "01-Jul-2024 10:00:05 +0000")"#;
        let meta = parse_meta_line(line).expect("no meta");
        assert_eq!(meta.msgid, None);
    }

    #[test]
    fn groups_messages_into_newest_first_stubs() {
        let meta = |uid: u32, thrid: u64, date: &str, unread: bool| Meta {
            uid,
            thrid,
            msgid: None,
            date: date.into(),
            unread,
        };
        let stubs = group_stubs(vec![
            meta(1, 100, "2024-01-01T00:00:00+00:00", false),
            meta(9, 100, "2024-03-01T00:00:00+00:00", true),
            meta(5, 200, "2024-02-01T00:00:00+00:00", false),
        ]);

        assert_eq!(stubs.len(), 2);
        assert_eq!(stubs[0].id, "100"); // newest activity first
        assert_eq!(stubs[0].message_count, 2);
        assert_eq!(stubs[0].last_uid, 9);
        assert!(stubs[0].unread);
        assert_eq!(stubs[1].id, "200");
        assert!(!stubs[1].unread);
    }

    #[test]
    fn quotes_search_text_for_imap() {
        assert_eq!(quote_imap("from:dana coffee"), r#""from:dana coffee""#);
        assert_eq!(quote_imap(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote_imap(r"back\slash"), r#""back\\slash""#);
        assert_eq!(quote_imap("line\r\nbreak"), r#""linebreak""#);
    }
}
