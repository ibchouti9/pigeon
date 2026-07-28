//! What crosses the bridge. Everything here serialises to the camelCase JSON
//! the TypeScript provider maps into Pigeon's domain types — Rust owns the
//! wire and MIME; the webview keeps the product rules it already tests.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressJson {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentJson {
    /// The MIME part index within its message, as a string — stable for one
    /// message body, which is all the download path needs.
    pub id: String,
    pub filename: String,
    pub size: u64,
    pub mime_type: String,
}

/// One parsed message. `text`/`html` are both offered; the TypeScript side
/// prefers text and strips html, exactly as it did for Gmail REST payloads.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageJson {
    /// X-GM-MSGID when Gmail provides it, else the UID — stable either way.
    pub id: String,
    pub uid: u32,
    pub subject: String,
    pub from: AddressJson,
    pub to: Vec<AddressJson>,
    pub cc: Vec<AddressJson>,
    /// ISO 8601. INTERNALDATE, which is when the server received it — the
    /// Date header lies often enough that Gmail itself sorts by this.
    pub date: String,
    pub text: Option<String>,
    pub html: Option<String>,
    pub attachments: Vec<AttachmentJson>,
    /// RFC 5322 Message-ID, for reply threading.
    pub message_id: Option<String>,
    pub unread: bool,
    /// Whether the message carries a `List-Unsubscribe` header.
    ///
    /// The single strongest "this is bulk" signal there is, and the lane
    /// classifier has always read it — from a field nothing ever set, so it
    /// was permanently absent and lanes ran on body regexes alone.
    pub list_unsubscribe: bool,
    /// Gmail says this is the user's own send (`in:sent` membership). Real
    /// accounts send from aliases and "send mail as" identities, so matching
    /// the From address alone reads the user's own mail as incoming — which
    /// once put a user in their own Screener.
    pub from_user: bool,
}

/// A whole conversation, grouped by X-GM-THRID out of All Mail.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadJson {
    pub id: String,
    pub subject: String,
    /// Any message still carrying the \Inbox label puts the thread in the
    /// inbox; a thread nowhere is the archive (§2.1: exactly one place).
    pub in_inbox: bool,
    pub unread: bool,
    pub last_message_at: String,
    pub messages: Vec<MessageJson>,
}

/// The cheap pass: one line of metadata per message, no bodies. A stub used to
/// carry identity and freshness and nothing else, and the provider turned each
/// one into a `mail_get_thread` — five round trips and every byte of every
/// message — before it could draw a single row. On a 40,000-thread account
/// that is a walk measured in hours, spent almost entirely on learning who
/// each conversation is from.
///
/// So a stub now carries what a row renders. The fields below `last_uid` are
/// filled by the enrichment pass, in bulk, for the window being listed;
/// bodies are fetched when a conversation is opened and not before.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStub {
    pub id: String,
    pub last_message_at: String,
    /// When the conversation started. §2.3's rules are all about the thread
    /// rather than its latest message, and a listing no longer holds the
    /// messages to derive this from — "did this start before Pigeon was set
    /// up?" is exactly what the screening cutoff asks.
    pub first_message_at: String,
    pub unread: bool,
    pub message_count: u32,
    /// Any message still carrying the \Inbox label puts the thread in the
    /// inbox; a thread nowhere is the archive (§2.1: exactly one place). Same
    /// rule as `ThreadJson`, so a row and the conversation it opens agree —
    /// and search, whose results span both places, can say which is which
    /// without opening anything.
    pub in_inbox: bool,
    /// Highest UID in the thread — with `message_count`, the body-cache key:
    /// either changes whenever the conversation does.
    pub last_uid: u32,
    /// The newest message that isn't the user's own send: who the row is from,
    /// and who §2.3 judges. The newest message full stop is very often the
    /// user's own reply, which would name the user as the thread's sender.
    pub preview_uid: u32,
    /// True when the thread holds nothing incoming at all — a conversation the
    /// user started and nobody answered.
    pub from_user: bool,
    pub from: Option<AddressJson>,
    pub subject: Option<String>,
    /// The row's preview line. Text and html are offered exactly as
    /// `MessageJson` offers them, because the webview owns "prefer text, strip
    /// html" and tests it there.
    pub snippet_text: Option<String>,
    pub snippet_html: Option<String>,
    /// `List-Unsubscribe` on the row's own message. The enrichment pass
    /// already fetches the whole header block, so this costs nothing on the
    /// wire — and lanes sort *rows*, which is where it has to be available.
    pub list_unsubscribe: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPage {
    /// The requested window, newest first.
    pub threads: Vec<ThreadStub>,
    /// How many threads the query matches in total, for D34's counters — not
    /// how many this page carries. A listing windows what it renders; it never
    /// shortens what it reports.
    pub total: u32,
}

/// An address seen in sent mail, with how often — D10's "people you have
/// written to" half of the known-sender set.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SentRecipient {
    pub name: String,
    pub email: String,
    pub count: u32,
}
