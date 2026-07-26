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

use std::collections::{HashMap, HashSet};

use super::parse::parse_message;
use super::session::{refused, with_mailbox, ImapSession, Special, WorkError};
use super::types::{ListPage, MessageJson, ThreadJson, ThreadStub};

/// How much of one message's body a preview line reads. Two kilobytes is more
/// than a row can show and less than a newsletter's stylesheet.
const PREVIEW_BYTES: u32 = 2048;

/// Preview lengths, after decoding. The row shows ~140 characters; the slack is
/// for the quoted-history split, which runs on the webview side.
const PREVIEW_TEXT_CHARS: usize = 400;
/// Html has to survive `htmlToText` before anything is readable, so it gets
/// more room — most of it is markup.
const PREVIEW_HTML_CHARS: usize = 4000;

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

/// Groups per-message metadata into newest-first thread stubs. `sent` is the
/// place's `in:sent` UIDs, which is how a thread's newest *incoming* message is
/// found — Gmail's own verdict, so aliases and "send mail as" identities count
/// as the user the same way they do inside a conversation.
pub fn group_stubs(
    metas: Vec<Meta>,
    sent: &HashSet<u32>,
    inbox: &HashSet<u32>,
) -> Vec<ThreadStub> {
    let mut by_thread: HashMap<u64, Vec<Meta>> = HashMap::new();
    for meta in metas {
        by_thread.entry(meta.thrid).or_default().push(meta);
    }

    let mut stubs: Vec<ThreadStub> = by_thread
        .into_iter()
        .map(|(thrid, mut messages)| {
            messages.sort_by(|a, b| a.uid.cmp(&b.uid));
            let last = messages.last().unwrap();
            let incoming = messages.iter().rev().find(|m| !sent.contains(&m.uid));
            let dates = || messages.iter().map(|m| m.date.as_str()).filter(|d| !d.is_empty());
            ThreadStub {
                id: thrid.to_string(),
                last_message_at: dates().max().unwrap_or_default().to_string(),
                first_message_at: dates().min().unwrap_or_default().to_string(),
                unread: messages.iter().any(|m| m.unread),
                message_count: messages.len() as u32,
                in_inbox: messages.iter().any(|m| inbox.contains(&m.uid)),
                last_uid: last.uid,
                preview_uid: incoming.unwrap_or(last).uid,
                from_user: incoming.is_none(),
                from: None,
                subject: None,
                snippet_text: None,
                snippet_html: None,
            }
        })
        .collect();

    stubs.sort_by(|a, b| b.last_message_at.cmp(&a.last_message_at));
    stubs
}

/// Trims a preview to length on a character boundary. `BODY[TEXT]<0.2048>` cuts
/// wherever 2048 bytes fall, so the tail can be half a UTF-8 sequence; lossy
/// decoding leaves a replacement character there, and a row should not end in
/// one.
fn cut(text: &str, limit: usize) -> Option<String> {
    let trimmed: String = text.trim().chars().take(limit).collect();
    let cleaned = trimmed.trim_end_matches('\u{FFFD}').trim_end();
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

/// A header section and the first bytes of a body, read as the truncated
/// message they are.
///
/// A truncated message is still a message: `parse_message` walks the MIME tree,
/// picks the text part out of a multipart, decodes the transfer encoding and
/// the charset, and keeps whatever the cut left behind. The alternative was
/// fetching `BODY[1]` and decoding it here, which means reimplementing base64,
/// quoted-printable, charsets and nested boundaries against 2 KB of guesswork.
///
/// `HEADER.FIELDS (FROM SUBJECT)` would be the cheaper request, and is not
/// available: imap-proto 0.16's FETCH grammar has no such section, and a line
/// its grammar rejects fails the whole command — the same trap this module's
/// comment describes for the X-GM-* items. Whole headers it is.
///
/// Only `from`, `subject` and the bodies are read off the result. Dates, flags
/// and identity come from the metadata pass, which is Gmail's own answer, and
/// `attachments` is not trusted at all: the body this saw stops after 2 KB.
fn parse_preview(header: &[u8], text: &[u8], uid: u32) -> MessageJson {
    let mut raw = header.to_vec();
    if !header.ends_with(b"\r\n\r\n") {
        if !header.ends_with(b"\r\n") {
            raw.extend_from_slice(b"\r\n");
        }
        raw.extend_from_slice(b"\r\n");
    }
    raw.extend_from_slice(&close_open_parts(text));
    parse_message(&raw, uid, None, None, false, false)
}

/// Closes the MIME parts a truncated body left open.
///
/// mail-parser decodes a part's transfer encoding only once the part *ends* —
/// on its terminating boundary. A body cut at 2 KB almost always ends in the
/// middle of the first part, and that part comes back as literal
/// `Caf=C3=A9 at ten` or a screenful of base64. Appending the delimiters the
/// cut swallowed is the whole fix, and it costs nothing on the wire.
///
/// The boundaries come out of the body itself: `BODY[TEXT]` of a multipart
/// message opens on its own delimiter line, and a nested multipart opens on
/// another further in. They are closed innermost-first, which is the order they
/// have to close in. A body line that merely looks like a delimiter ("-- " above
/// a signature) yields a closer that matches no boundary and is ignored, which
/// is exactly what happened before this existed.
fn close_open_parts(text: &[u8]) -> Vec<u8> {
    let body = String::from_utf8_lossy(text);
    let mut boundaries: Vec<&str> = Vec::new();
    for line in body.split('\n') {
        let line = line.trim_end_matches('\r');
        // A delimiter is `--boundary`; `--boundary--` already closes one.
        if line.len() < 3 || !line.starts_with("--") || line.ends_with("--") {
            continue;
        }
        if !boundaries.contains(&line) {
            boundaries.push(line);
        }
        // multipart/mixed wrapping multipart/alternative wrapping the text is
        // as deep as real mail goes.
        if boundaries.len() == 3 {
            break;
        }
    }

    let mut out = text.to_vec();
    for boundary in boundaries.iter().rev() {
        out.extend_from_slice(b"\r\n");
        out.extend_from_slice(boundary.as_bytes());
        out.extend_from_slice(b"--\r\n");
    }
    out
}

/// Fills in what a row renders — sender, subject, preview — for a window of
/// stubs, in bulk.
///
/// The whole listing costs one FETCH per 200 threads here, against one
/// `mail_get_thread` *per thread* before: five round trips and every byte of
/// every message, attachments included, to end up rendering a name and a
/// subject line.
fn enrich(session: &mut ImapSession, stubs: &mut [ThreadStub]) -> Result<(), imap::Error> {
    // Two threads can name the same preview UID only if Gmail rethreaded
    // underneath us, but the index is a map of *lists* so that case fills both
    // rows instead of leaving one blank forever.
    let mut index: HashMap<u32, Vec<usize>> = HashMap::new();
    for (i, stub) in stubs.iter().enumerate() {
        index.entry(stub.preview_uid).or_default().push(i);
    }
    let uids: Vec<u32> = index.keys().copied().collect();

    for chunk in uids.chunks(200) {
        let set = chunk
            .iter()
            .map(|u| u.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let fetched = session.uid_fetch(
            set,
            format!("(UID BODY.PEEK[HEADER] BODY.PEEK[TEXT]<0.{PREVIEW_BYTES}>)"),
        )?;

        for fetch in fetched.iter() {
            let Some(uid) = fetch.uid else { continue };
            let Some(targets) = index.get(&uid) else { continue };

            let parsed = parse_preview(
                fetch.header().unwrap_or_default(),
                fetch.text().unwrap_or_default(),
                uid,
            );
            let text = parsed.text.as_deref().and_then(|t| cut(t, PREVIEW_TEXT_CHARS));
            let html = match &text {
                Some(_) => None,
                None => parsed.html.as_deref().and_then(|h| cut(h, PREVIEW_HTML_CHARS)),
            };

            for &i in targets {
                stubs[i].from = Some(parsed.from.clone());
                stubs[i].subject = Some(parsed.subject.clone());
                stubs[i].snippet_text = text.clone();
                stubs[i].snippet_html = html.clone();
            }
        }
    }
    Ok(())
}

/// The UIDs matching one Gmail search, as a set. Two of these answer questions
/// every stub in a listing needs — is this message the user's own send, and is
/// it still in the inbox — for one round trip each, against one `mail_get_thread`
/// per thread before.
fn uid_set(session: &mut ImapSession, query: &str) -> Result<HashSet<u32>, imap::Error> {
    Ok(session.uid_search(query)?.into_iter().collect())
}

/// One SEARCH and one metadata pass over the whole place, then enrichment of
/// the requested window only.
fn page(
    session: &mut ImapSession,
    query: &str,
    offset: u32,
    limit: u32,
) -> Result<ListPage, WorkError> {
    let uids = search_uids(session, query)?;
    let sent = uid_set(session, "X-GM-RAW \"in:sent\"")?;
    let inbox = uid_set(session, "X-GM-RAW \"in:inbox\"")?;
    let all = group_stubs(run_meta_fetch(session, &uids)?, &sent, &inbox);
    let total = all.len() as u32;

    let start = (offset as usize).min(all.len());
    let end = start.saturating_add(limit as usize).min(all.len());
    let mut window = all[start..end].to_vec();
    enrich(session, &mut window)?;

    Ok(ListPage { total, threads: window })
}

fn search_uids(session: &mut ImapSession, query: &str) -> Result<Vec<u32>, imap::Error> {
    let found = session.uid_search(query)?;
    let mut uids: Vec<u32> = found.into_iter().collect();
    uids.sort_unstable_by(|a, b| b.cmp(a));
    Ok(uids)
}

/// One window of a place's conversations, newest first, ready to render.
///
/// The counting pass covers the whole place however large it is — a SEARCH and
/// one line-per-message FETCH per thousand messages, which is cheap in bytes
/// and is what keeps D34's totals honest. Only the window is enriched, and no
/// bodies are read at all: the caller opens a conversation to get those.
pub fn list_threads(place: String, offset: u32, limit: u32) -> Result<ListPage, String> {
    with_mailbox(Special::AllMail, |session| {
        let query = format!("X-GM-RAW {}", quote_imap(place_query(&place)));
        page(session, &query, offset, limit)
    })
}

/// D7's third place runs on Gmail's own query language, quoted straight
/// through to X-GM-RAW.
pub fn search_threads(query: String, limit: u32) -> Result<ListPage, String> {
    with_mailbox(Special::AllMail, |session| {
        let query = format!("X-GM-RAW {}", quote_imap(&query));
        page(session, &query, 0, limit)
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

    fn meta(uid: u32, thrid: u64, date: &str, unread: bool) -> Meta {
        Meta { uid, thrid, msgid: None, date: date.into(), unread }
    }

    #[test]
    fn groups_messages_into_newest_first_stubs() {
        let stubs = group_stubs(
            vec![
                meta(1, 100, "2024-01-01T00:00:00+00:00", false),
                meta(9, 100, "2024-03-01T00:00:00+00:00", true),
                meta(5, 200, "2024-02-01T00:00:00+00:00", false),
            ],
            &HashSet::new(),
            &HashSet::new(),
        );

        assert_eq!(stubs.len(), 2);
        assert_eq!(stubs[0].id, "100"); // newest activity first
        assert_eq!(stubs[0].message_count, 2);
        assert_eq!(stubs[0].last_uid, 9);
        assert!(stubs[0].unread);
        assert_eq!(stubs[1].id, "200");
        assert!(!stubs[1].unread);
    }

    /// The dates §2.3 reasons about: a thread is one unit, so a rule about
    /// "before Pigeon was set up" is about when the conversation started, not
    /// when its latest reply landed.
    #[test]
    fn a_stub_carries_both_ends_of_the_conversation() {
        let stubs = group_stubs(
            vec![
                meta(4, 100, "2021-05-02T09:00:00+00:00", false),
                meta(7, 100, "2026-07-20T09:00:00+00:00", false),
                meta(6, 100, "2023-01-01T09:00:00+00:00", false),
            ],
            &HashSet::new(),
            &HashSet::new(),
        );
        assert_eq!(stubs[0].first_message_at, "2021-05-02T09:00:00+00:00");
        assert_eq!(stubs[0].last_message_at, "2026-07-20T09:00:00+00:00");
    }

    /// The row names the person who wrote to you, not you. The newest message
    /// in a live conversation is very often the user's own reply, and taking it
    /// as the thread's sender put the user's own address on their own rows —
    /// and, through §2.3, into their own Screener.
    #[test]
    fn the_preview_is_the_newest_message_that_is_not_the_users_own() {
        let sent = HashSet::from([9]);
        let stubs = group_stubs(
            vec![
                meta(3, 100, "2026-07-01T00:00:00+00:00", false),
                meta(9, 100, "2026-07-02T00:00:00+00:00", false),
            ],
            &sent,
            &HashSet::new(),
        );
        assert_eq!(stubs[0].last_uid, 9);
        assert_eq!(stubs[0].preview_uid, 3);
        assert!(!stubs[0].from_user);
    }

    /// A thread the user started and nobody answered has no incoming message
    /// to fall back to, and says so rather than pretending the send was one.
    #[test]
    fn a_thread_with_nothing_incoming_is_marked_as_the_users_own() {
        let sent = HashSet::from([3, 9]);
        let stubs = group_stubs(
            vec![
                meta(3, 100, "2026-07-01T00:00:00+00:00", false),
                meta(9, 100, "2026-07-02T00:00:00+00:00", false),
            ],
            &sent,
            &HashSet::new(),
        );
        assert_eq!(stubs[0].preview_uid, 9);
        assert!(stubs[0].from_user);
    }

    /// INTERNALDATE can come back unparseable, and an empty string sorts below
    /// every real date — taking the minimum blindly dated every such thread to
    /// the beginning of time, which is the wrong side of any cutoff.
    #[test]
    fn an_unreadable_date_does_not_become_the_start_of_the_thread() {
        let stubs = group_stubs(
            vec![
                meta(1, 100, "", false),
                meta(2, 100, "2026-07-20T09:00:00+00:00", false),
            ],
            &HashSet::new(),
            &HashSet::new(),
        );
        assert_eq!(stubs[0].first_message_at, "2026-07-20T09:00:00+00:00");
    }

    /// The shape Gmail actually returns for a newsletter: quoted-printable text
    /// inside a multipart, cut mid-part by `<0.2048>`. Nothing here is
    /// hand-decoded — if this passes, `parse_message` did all of it.
    #[test]
    fn a_truncated_multipart_still_yields_a_preview() {
        let header = concat!(
            "From: Dana Whitlock <dana@lumen.com>\r\n",
            "Subject: =?utf-8?Q?Coffee_on_Thursday=3F?=\r\n",
            "Content-Type: multipart/alternative; boundary=\"b1\"\r\n",
            "\r\n"
        );
        // Quoted-printable, with a soft line break, and no closing boundary —
        // exactly what a cut at 2048 bytes leaves behind.
        let text = concat!(
            "--b1\r\n",
            "Content-Type: text/plain; charset=utf-8\r\n",
            "Content-Transfer-Encoding: quoted-printable\r\n",
            "\r\n",
            "Caf=C3=A9 at ten? I can bring the =\r\n",
            "notes."
        );

        let parsed = parse_preview(header.as_bytes(), text.as_bytes(), 42);
        assert_eq!(parsed.from.email, "dana@lumen.com");
        assert_eq!(parsed.from.name, "Dana Whitlock");
        // The encoded word is decoded, so a subject is a subject and not "=?utf-8?Q?".
        assert_eq!(parsed.subject, "Coffee on Thursday?");
        let body = parsed.text.unwrap_or_default();
        assert!(body.contains("Café at ten?"), "charset lost: {body}");
        assert!(body.contains("bring the notes."), "soft break lost: {body}");
    }

    /// The nested case — multipart/mixed around multipart/alternative — cut
    /// inside the innermost text part. Both levels have to close, innermost
    /// first, or the decode never happens.
    #[test]
    fn a_truncated_nested_multipart_still_yields_a_preview() {
        let header = concat!(
            "From: a@b.com\r\n",
            "Content-Type: multipart/mixed; boundary=\"outer\"\r\n",
            "\r\n"
        );
        let text = concat!(
            "--outer\r\n",
            "Content-Type: multipart/alternative; boundary=\"inner\"\r\n",
            "\r\n",
            "--inner\r\n",
            "Content-Type: text/plain; charset=utf-8\r\n",
            "Content-Transfer-Encoding: quoted-printable\r\n",
            "\r\n",
            "Caf=C3=A9 at ten."
        );
        let parsed = parse_preview(header.as_bytes(), text.as_bytes(), 1);
        assert_eq!(parsed.text.unwrap_or_default().trim(), "Café at ten.");
    }

    /// base64 is the case that is unreadable rather than merely ugly when the
    /// part is left open.
    #[test]
    fn a_truncated_base64_part_is_decoded() {
        let header = "From: a@b.com\r\nContent-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n";
        let text = concat!(
            "--b1\r\n",
            "Content-Type: text/plain\r\n",
            "Content-Transfer-Encoding: base64\r\n",
            "\r\n",
            "Q29mZmVlIG9uIFRodXJzZGF5Lg=="
        );
        let parsed = parse_preview(header.as_bytes(), text.as_bytes(), 1);
        assert_eq!(parsed.text.unwrap_or_default().trim(), "Coffee on Thursday.");
    }

    /// A body that was short enough to arrive whole already carries its own
    /// closing delimiter; the synthetic one lands after it, as an epilogue
    /// nobody reads.
    #[test]
    fn an_untruncated_body_is_left_readable() {
        let header = "From: a@b.com\r\nContent-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n";
        let text = concat!(
            "--b1\r\n",
            "Content-Type: text/plain\r\n",
            "\r\n",
            "Short and complete.\r\n",
            "--b1--\r\n"
        );
        let parsed = parse_preview(header.as_bytes(), text.as_bytes(), 1);
        assert_eq!(parsed.text.unwrap_or_default().trim(), "Short and complete.");
    }

    /// A plain-text signature delimiter is not a boundary. It yields a closer
    /// that matches nothing, and the message reads the same as it always did.
    #[test]
    fn a_signature_dash_line_is_not_mistaken_for_a_boundary() {
        let parsed = parse_preview(
            b"From: a@b.com\r\nContent-Type: text/plain\r\n\r\n",
            b"See you then.\r\n-- \r\nDana",
            1,
        );
        assert!(parsed.text.unwrap_or_default().contains("See you then."));
    }

    /// The html-only case, which the webview flattens with `htmlToText`. Rust
    /// offers both and picks neither, same as it does for a whole message.
    #[test]
    fn an_html_only_preview_comes_back_as_html() {
        let header = "From: a@b.com\r\nContent-Type: text/html\r\n\r\n";
        let parsed = parse_preview(header.as_bytes(), b"<p>Hello <b>you</b>", 1);
        assert!(parsed.text.unwrap_or_default().is_empty());
        assert!(parsed.html.unwrap_or_default().contains("Hello"));
    }

    /// `BODY[HEADER]` is specified to include the blank line that ends the
    /// header section, but a message with no body at all can come back without
    /// one — and then the first body line would be read as another header.
    #[test]
    fn a_header_section_missing_its_blank_line_is_still_a_message() {
        let parsed = parse_preview(b"From: a@b.com\r\nSubject: Hi", b"Body text here", 1);
        assert_eq!(parsed.subject, "Hi");
        assert!(parsed.text.unwrap_or_default().contains("Body text here"));
    }

    /// §2.1's one place, from the same rule `ThreadJson` uses: any message
    /// still labelled \Inbox puts the whole conversation in the inbox. Search
    /// results span both places, and a row has to say which without opening
    /// the conversation to find out.
    #[test]
    fn a_thread_is_in_the_inbox_if_any_of_it_is() {
        let metas = || {
            vec![
                meta(1, 100, "2026-07-01T00:00:00+00:00", false),
                meta(2, 100, "2026-07-02T00:00:00+00:00", false),
            ]
        };
        let archived = group_stubs(metas(), &HashSet::new(), &HashSet::new());
        assert!(!archived[0].in_inbox);

        let one_labelled = group_stubs(metas(), &HashSet::new(), &HashSet::from([2]));
        assert!(one_labelled[0].in_inbox);
    }

    #[test]
    fn a_preview_is_cut_on_a_character_boundary() {
        assert_eq!(cut("  hello  ", 400).as_deref(), Some("hello"));
        assert_eq!(cut("héllo wörld", 5).as_deref(), Some("héllo"));
        assert_eq!(cut("   ", 400), None);
        // What a mid-UTF-8 cut leaves behind after lossy decoding.
        assert_eq!(cut("done\u{FFFD}", 400).as_deref(), Some("done"));
    }

    #[test]
    fn quotes_search_text_for_imap() {
        assert_eq!(quote_imap("from:dana coffee"), r#""from:dana coffee""#);
        assert_eq!(quote_imap(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote_imap(r"back\slash"), r#""back\\slash""#);
        assert_eq!(quote_imap("line\r\nbreak"), r#""linebreak""#);
    }
}

