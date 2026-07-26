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

/// The cheap pass: one line of metadata per message, no bodies, no envelopes.
/// The TypeScript provider lists with these and hydrates bodies thread by
/// thread — nothing from a stub is ever rendered, so it carries identity and
/// freshness and nothing else.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStub {
    pub id: String,
    pub last_message_at: String,
    pub unread: bool,
    pub message_count: u32,
    /// Highest UID in the thread — with `message_count`, the body-cache key:
    /// either changes whenever the conversation does.
    pub last_uid: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPage {
    pub threads: Vec<ThreadStub>,
    /// How many threads the query matches in total, for D34's counters.
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
