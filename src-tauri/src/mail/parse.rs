//! Raw RFC 2822 bytes → the JSON the webview maps into Pigeon's `Message`.
//!
//! `mail-parser` does the hard part (MIME trees, encoded words, charsets);
//! this file decides what Pigeon keeps. Bodies stay as offered — `text` and
//! `html` side by side — because the webview already owns "prefer text, strip
//! html" and its tests, and owning it twice is how the two builds drift.

use mail_parser::{Address as MpAddress, MessageParser, MimeHeaders, PartType};

use super::types::{AddressJson, AttachmentJson, MessageJson};

fn address(addr: Option<&MpAddress>) -> AddressJson {
    let first = addr.and_then(|a| a.first());
    AddressJson {
        name: first
            .and_then(|a| a.name())
            .unwrap_or_default()
            .to_string(),
        email: first
            .and_then(|a| a.address())
            .unwrap_or_default()
            .to_string(),
    }
}

fn addresses(addr: Option<&MpAddress>) -> Vec<AddressJson> {
    let Some(addr) = addr else { return Vec::new() };
    addr.iter()
        .filter_map(|a| {
            let email = a.address()?.to_string();
            Some(AddressJson {
                name: a.name().unwrap_or_default().to_string(),
                email,
            })
        })
        .collect()
}

/// `uid` and `internal_date` come from the FETCH, not the message: the UID is
/// the handle every later action needs, and INTERNALDATE is when the server
/// received the mail — the Date header lies often enough that Gmail itself
/// sorts by the server's clock.
pub fn parse_message(
    raw: &[u8],
    uid: u32,
    gm_msgid: Option<u64>,
    internal_date: Option<String>,
    unread: bool,
    from_user: bool,
) -> MessageJson {
    let parsed = MessageParser::default().parse(raw);

    let Some(message) = parsed else {
        // A message so broken the parser gave up still happened: show that it
        // exists rather than silently shortening the conversation.
        return MessageJson {
            id: gm_msgid.map(|id| id.to_string()).unwrap_or_else(|| uid.to_string()),
            uid,
            subject: String::new(),
            from: AddressJson { name: String::new(), email: String::new() },
            to: Vec::new(),
            cc: Vec::new(),
            date: internal_date.unwrap_or_default(),
            text: Some("(Pigeon couldn't read this message.)".into()),
            html: None,
            attachments: Vec::new(),
            message_id: None,
            unread,
            from_user,
        };
    };

    // The webview's body handling — splitQuoted above all — works in `\n`,
    // and RFC 2822 bodies arrive in `\r\n`.
    let text = message
        .text_bodies()
        .filter_map(|part| match &part.body {
            PartType::Text(text) => Some(text.as_ref()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
        .replace("\r\n", "\n");
    let html = message
        .html_bodies()
        .filter_map(|part| match &part.body {
            PartType::Html(html) => Some(html.as_ref()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
        .replace("\r\n", "\n");

    let attachments = message
        .attachments()
        .enumerate()
        .map(|(index, part)| AttachmentJson {
            id: index.to_string(),
            filename: part
                .attachment_name()
                .unwrap_or("attachment")
                .to_string(),
            size: part.contents().len() as u64,
            mime_type: part
                .content_type()
                .map(|ct| match ct.subtype() {
                    Some(sub) => format!("{}/{}", ct.ctype(), sub),
                    None => ct.ctype().to_string(),
                })
                .unwrap_or_else(|| "application/octet-stream".to_string()),
        })
        .collect();

    let date = internal_date.or_else(|| {
        message
            .date()
            .map(|d| d.to_rfc3339())
    });

    MessageJson {
        id: gm_msgid.map(|id| id.to_string()).unwrap_or_else(|| uid.to_string()),
        uid,
        subject: message.subject().unwrap_or_default().to_string(),
        from: address(message.from()),
        to: addresses(message.to()),
        cc: addresses(message.cc()),
        date: date.unwrap_or_default(),
        text: if text.is_empty() { None } else { Some(text) },
        html: if html.is_empty() { None } else { Some(html) },
        attachments,
        message_id: message.message_id().map(|id| id.to_string()),
        unread,
        from_user,
    }
}

/// The bytes of one attachment, by the index `parse_message` labelled it with.
pub fn attachment_bytes(raw: &[u8], index: usize) -> Option<Vec<u8>> {
    let message = MessageParser::default().parse(raw)?;
    let part = message.attachments().nth(index)?;
    Some(part.contents().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN: &[u8] = b"From: Dana Lumen <dana@lumen.com>\r\n\
To: Me <me@example.com>\r\n\
Cc: Casey <casey@example.com>, No Name <bare@example.com>\r\n\
Subject: Coffee?\r\n\
Message-ID: <abc-123@lumen.com>\r\n\
Date: Mon, 1 Jul 2024 10:00:00 +0000\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Tomorrow at nine?\r\n";

    #[test]
    fn reads_the_headers_pigeon_shows() {
        let m = parse_message(PLAIN, 7, Some(99), Some("2024-07-01T10:00:05Z".into()), true, false);
        assert_eq!(m.subject, "Coffee?");
        assert_eq!(m.from.name, "Dana Lumen");
        assert_eq!(m.from.email, "dana@lumen.com");
        assert_eq!(m.cc.len(), 2);
        assert_eq!(m.cc[1].email, "bare@example.com");
        assert_eq!(m.message_id.as_deref(), Some("abc-123@lumen.com"));
        assert_eq!(m.text.as_deref(), Some("Tomorrow at nine?\n"));
        assert!(m.unread);
    }

    #[test]
    fn the_fetch_identity_wins_over_the_message() {
        let m = parse_message(PLAIN, 7, Some(99), Some("2024-07-01T10:00:05Z".into()), false, false);
        // X-GM-MSGID is the id; INTERNALDATE is the date. The header date and
        // UID are fallbacks, not the truth.
        assert_eq!(m.id, "99");
        assert_eq!(m.uid, 7);
        assert_eq!(m.date, "2024-07-01T10:00:05Z");

        let without = parse_message(PLAIN, 7, None, None, false, false);
        assert_eq!(without.id, "7");
        // Falls back to the Date header, kept as ISO.
        assert!(without.date.starts_with("2024-07-01T10:00:00"));
    }

    #[test]
    fn html_only_mail_keeps_its_html_for_the_webview_to_strip() {
        let raw = b"From: a@b.c\r\nSubject: Hi\r\n\
Content-Type: text/html; charset=utf-8\r\n\r\n\
<p>Hello <b>there</b></p>\r\n";
        let m = parse_message(raw, 1, None, None, false, false);
        assert!(m.text.is_none());
        assert!(m.html.as_deref().unwrap_or("").contains("<b>there</b>"));
    }

    #[test]
    fn multipart_alternative_offers_both_bodies() {
        let raw = b"From: a@b.c\r\nSubject: Hi\r\n\
Content-Type: multipart/alternative; boundary=X\r\n\r\n\
--X\r\nContent-Type: text/plain\r\n\r\nplain words\r\n\
--X\r\nContent-Type: text/html\r\n\r\n<p>rich words</p>\r\n\
--X--\r\n";
        let m = parse_message(raw, 1, None, None, false, false);
        assert!(m.text.as_deref().unwrap_or("").contains("plain words"));
        assert!(m.html.as_deref().unwrap_or("").contains("rich words"));
    }

    #[test]
    fn encoded_word_names_arrive_decoded() {
        let raw = b"From: =?UTF-8?B?SsO8cmdlbg==?= <j@example.de>\r\n\
Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=\r\n\
Content-Type: text/plain\r\n\r\nhallo\r\n";
        let m = parse_message(raw, 1, None, None, false, false);
        assert_eq!(m.from.name, "Jürgen");
        assert_eq!(m.subject, "Grüße");
    }

    #[test]
    fn attachments_are_listed_and_fetchable_by_index() {
        let raw = b"From: a@b.c\r\nSubject: File\r\n\
Content-Type: multipart/mixed; boundary=X\r\n\r\n\
--X\r\nContent-Type: text/plain\r\n\r\nsee attached\r\n\
--X\r\nContent-Type: application/pdf; name=\"notes.pdf\"\r\n\
Content-Disposition: attachment; filename=\"notes.pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\r\n\
JVBERi0xLjQ=\r\n\
--X--\r\n";
        let m = parse_message(raw, 1, None, None, false, false);
        assert_eq!(m.attachments.len(), 1);
        assert_eq!(m.attachments[0].filename, "notes.pdf");
        assert_eq!(m.attachments[0].mime_type, "application/pdf");

        let bytes = attachment_bytes(raw, 0).expect("attachment missing");
        assert_eq!(bytes, b"%PDF-1.4");
    }

    /**
     * mail-parser is lenient by design and parses almost anything, so the
     * "couldn't read" fallback is for a case that may never occur. What must
     * hold either way: garbage bytes still yield a message with its identity
     * intact, so the conversation is never silently shorter than it is.
     */
    #[test]
    fn unreadable_bytes_still_show_as_a_message() {
        let m = parse_message(b"\xff\xfe\x00garbage", 3, None, Some("2024-01-01T00:00:00Z".into()), false, false);
        assert_eq!(m.uid, 3);
        assert_eq!(m.id, "3");
        assert_eq!(m.date, "2024-01-01T00:00:00Z");
    }
}
