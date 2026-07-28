//! The IMAP session: one connection, kept warm, reconnected when it drops.
//!
//! Everything speaks to Gmail through `with_mailbox`, which owns the lock, the
//! LOGIN, the SELECT, and one retry. The retry matters more than it looks:
//! Gmail hangs up idle IMAP connections after about ten minutes, so the first
//! call after any pause would otherwise fail with an IO error that reads, to
//! the user, like their mail breaking at random.

use keyring::Entry;
use std::sync::Mutex;

use super::types::Credentials;

const HOST: &str = "imap.gmail.com";
const PORT: u16 = 993;

const KEYCHAIN_SERVICE: &str = "com.pigeonmail.pigeon";
const ACCOUNT_ENTRY: &str = "gmail-app-password";

pub type ImapSession = imap::Session<imap::Connection>;

/// What a unit of mailbox work can fail with.
///
/// The two cases have to stay apart because `with_mailbox` reconnects and
/// tries again on anything that smells like a dropped connection: `Refused` is
/// Pigeon's own words about a request that will fail again just as fast, and
/// `Imap` is whatever the wire did. These used to be one type, with our own
/// refusals dressed up as server BAD responses — imap 3 marks `Bad` and `No`
/// `#[non_exhaustive]` so only a real server answer can produce one, which is
/// the right rule and is why our refusals now say what they are.
#[derive(Debug)]
pub enum WorkError {
    Refused(String),
    Imap(imap::Error),
}

impl From<imap::Error> for WorkError {
    fn from(error: imap::Error) -> Self {
        WorkError::Imap(error)
    }
}

/// Pigeon's own refusal, in words meant for the person reading them.
pub fn refused(information: impl Into<String>) -> WorkError {
    WorkError::Refused(information.into())
}

struct Live {
    session: ImapSession,
    /// The mailbox currently SELECTed, to skip redundant round trips.
    selected: Option<String>,
    /// SPECIAL-USE names, discovered once per connection. Localised, so they
    /// cannot be hardcoded; stable, so they need not be re-LISTed per command.
    all_mail: Option<String>,
    sent: Option<String>,
}

static LIVE: Mutex<Option<Live>> = Mutex::new(None);

/* -------------------------------------------------------------------------- */
/* Credentials                                                                 */
/* -------------------------------------------------------------------------- */

fn entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, ACCOUNT_ENTRY).map_err(|e| format!("Keychain unavailable: {e}"))
}

pub fn stored_credentials() -> Option<Credentials> {
    let raw = entry().ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn store_credentials(creds: &Credentials) -> Result<(), String> {
    let encoded = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&encoded)
        .map_err(|e| format!("Couldn't save to the Keychain: {e}"))
}

pub fn forget_credentials() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
    disconnect();
}

/// Normalises what people actually paste: Google displays app passwords in
/// four groups of four, and copying keeps the spaces.
pub fn clean_password(raw: &str) -> String {
    raw.chars().filter(|c| !c.is_whitespace()).collect()
}

/* -------------------------------------------------------------------------- */
/* Errors, said usefully                                                       */
/* -------------------------------------------------------------------------- */

/// Gmail's LOGIN refusals, mapped to what the user should actually do.
/// The strings Gmail sends are documented behaviour, not guesses — an
/// ordinary Google password gets a different refusal than a wrong one.
pub fn explain_login(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("application-specific password required") {
        return "That looks like your Google password. Pigeon needs an app password — 16 characters from myaccount.google.com/apppasswords.".into();
    }
    if lower.contains("web login required") {
        return "Google wants you to sign in on the web first. Open gmail.com, sign in, then try Pigeon again.".into();
    }
    if lower.contains("authenticationfailed") || lower.contains("invalid credentials") {
        return "Google didn't accept that. Check the address, and that the app password is the 16-character one Google generated.".into();
    }
    if lower.contains("imap") && lower.contains("disabled") {
        return "IMAP is switched off for this account. Turn it on in Gmail's settings under Forwarding and POP/IMAP, then try again.".into();
    }
    format!("Gmail refused the sign-in: {error}")
}

fn connection_error(e: impl std::fmt::Display) -> String {
    format!("Couldn't reach Gmail. Check your connection and try again. ({e})")
}

/* -------------------------------------------------------------------------- */
/* Connecting                                                                  */
/* -------------------------------------------------------------------------- */

fn open(creds: &Credentials) -> Result<ImapSession, String> {
    let client = imap::ClientBuilder::new(HOST, PORT)
        .connect()
        .map_err(|e| connection_error(e))?;
    client
        .login(&creds.email, &creds.password)
        .map_err(|(e, _client)| explain_login(&e.to_string()))
}

/// A connection of its own, from the stored credentials.
///
/// `with_mailbox` holds one session behind a lock, which is right for commands
/// — they are short, and serialising them keeps the SELECTed mailbox honest.
/// It is exactly wrong for IDLE, which holds the connection open for minutes at
/// a time and would block every read and every archive behind it. The watcher
/// gets its own. Gmail allows fifteen simultaneous IMAP connections per
/// account; this makes two.
pub fn open_stored() -> Result<ImapSession, String> {
    let creds =
        stored_credentials().ok_or_else(|| "Pigeon isn't connected to Gmail.".to_string())?;
    open(&creds)
}

/// Verifies a fresh sign-in end to end, then stores it. Called from O1.
pub fn connect(email: &str, password: &str) -> Result<(), String> {
    let creds = Credentials {
        email: email.trim().to_string(),
        password: clean_password(password),
    };
    if creds.email.is_empty() || !creds.email.contains('@') {
        return Err("That doesn't look like an email address.".into());
    }
    if creds.password.len() != 16 {
        return Err(
            "An app password is 16 characters. Copy the whole thing from myaccount.google.com/apppasswords.".into(),
        );
    }

    let session = open(&creds)?;
    store_credentials(&creds)?;
    *LIVE.lock().unwrap() = Some(Live {
        session,
        selected: None,
        all_mail: None,
        sent: None,
    });
    Ok(())
}

pub fn disconnect() {
    if let Some(mut live) = LIVE.lock().unwrap().take() {
        let _ = live.session.logout();
    }
}

pub fn is_connected() -> bool {
    stored_credentials().is_some()
}

/* -------------------------------------------------------------------------- */
/* Running commands                                                            */
/* -------------------------------------------------------------------------- */

/// Well-known Gmail mailboxes. Names go through SPECIAL-USE discovery because
/// they are localised — "[Gmail]/All Mail" is "[Gmail]/Tous les messages" for
/// a French account, and hardcoding the English broke non-English accounts of
/// every mail client that ever tried.
#[derive(Clone, Copy, PartialEq)]
pub enum Special {
    AllMail,
    Sent,
    Inbox,
}

/// Whether a LIST entry's attributes mark it as the mailbox we want.
///
/// Matched on the parsed attribute, not on its `Debug` rendering. The rendering
/// worked by accident under imap-proto 0.10, where `\All` was an unrecognised
/// extension carried around as a string; 0.16 gives these their own variants,
/// whose Debug output has neither backslash nor quotes — so a substring test
/// silently stopped matching anything and every account looked like it had no
/// Sent folder. `NameAttribute` is `#[non_exhaustive]`, hence `matches!`.
fn is_special(which: Special, attributes: &[imap_proto::NameAttribute]) -> bool {
    attributes.iter().any(|attribute| {
        matches!(
            (which, attribute),
            (Special::AllMail, imap_proto::NameAttribute::All)
                | (Special::Sent, imap_proto::NameAttribute::Sent)
        )
    })
}

fn find_special(session: &mut ImapSession, which: Special) -> Result<String, String> {
    if let Special::Inbox = which {
        return Ok("INBOX".into());
    }
    let names = session
        .list(None, Some("*"))
        .map_err(|e| connection_error(e))?;
    for name in names.iter() {
        if is_special(which, name.attributes()) {
            return Ok(name.name().to_string());
        }
    }
    // A plain IMAP server (the test harness) has no special-use folders;
    // Gmail always does.
    Err(match which {
        Special::AllMail => "This account doesn't expose an All Mail folder over IMAP. In Gmail's label settings, enable Show in IMAP for All Mail.".into(),
        _ => "Couldn't find the Sent folder over IMAP.".into(),
    })
}

/// Runs `work` with `mailbox` selected, reconnecting once if the connection
/// has gone stale underneath us.
pub fn with_mailbox<T>(
    which: Special,
    work: impl Fn(&mut ImapSession) -> Result<T, WorkError>,
) -> Result<T, String> {
    let mut guard = LIVE.lock().unwrap();

    for attempt in 0..2 {
        if guard.is_none() {
            let creds = stored_credentials()
                .ok_or_else(|| "Pigeon isn't connected to Gmail.".to_string())?;
            *guard = Some(Live {
                session: open(&creds)?,
                selected: None,
                all_mail: None,
                sent: None,
            });
        }
        let live = guard.as_mut().unwrap();

        let outcome = (|| -> Result<T, WorkError> {
            let name = match which {
                Special::Inbox => "INBOX".to_string(),
                Special::AllMail | Special::Sent => {
                    let cached = match which {
                        Special::AllMail => &live.all_mail,
                        _ => &live.sent,
                    };
                    match cached {
                        Some(name) => name.clone(),
                        None => {
                            let found = find_special(&mut live.session, which).map_err(refused)?;
                            match which {
                                Special::AllMail => live.all_mail = Some(found.clone()),
                                _ => live.sent = Some(found.clone()),
                            }
                            found
                        }
                    }
                }
            };
            if live.selected.as_deref() != Some(&name) {
                live.session.select(&name)?;
                live.selected = Some(name);
            }
            work(&mut live.session)
        })();

        match outcome {
            Ok(value) => return Ok(value),
            Err(WorkError::Refused(message)) => return Err(message),
            // A server BAD is an answer, not a broken pipe — report its words
            // rather than reconnecting to hear them again.
            Err(WorkError::Imap(imap::Error::Bad(refusal))) => return Err(refusal.information),
            Err(WorkError::Imap(error)) => {
                // An IO or parse error means the connection is suspect; drop it
                // and go around once more with a fresh one.
                *guard = None;
                if attempt == 1 {
                    return Err(connection_error(error));
                }
            }
        }
    }
    unreachable!()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gmail's real LIST answer, attributes and all.
    const ALL_MAIL: &[u8] =
        b"* LIST (\\HasNoChildren \\All) \"/\" \"[Gmail]/All Mail\"\r\n";
    const SENT: &[u8] = b"* LIST (\\HasNoChildren \\Sent) \"/\" \"[Gmail]/Sent Mail\"\r\n";
    const ORDINARY: &[u8] = b"* LIST (\\HasNoChildren) \"/\" \"INBOX\"\r\n";

    fn attributes(line: &[u8]) -> Vec<imap_proto::NameAttribute<'_>> {
        match imap_proto::parser::parse_response(line) {
            Ok((_, imap_proto::Response::MailboxData(imap_proto::MailboxDatum::List {
                name_attributes,
                ..
            }))) => name_attributes,
            other => panic!("not a LIST response: {other:?}"),
        }
    }

    /// SPECIAL-USE discovery, from Gmail's bytes rather than from a hand-built
    /// attribute. The pairing of the two halves is the part that broke once:
    /// the parse said one thing and the match looked for another, and the only
    /// symptom was "Couldn't find the Sent folder over IMAP" on an account
    /// that plainly had one.
    #[test]
    fn gmails_own_list_answer_names_the_special_mailboxes() {
        assert!(is_special(Special::AllMail, &attributes(ALL_MAIL)));
        assert!(is_special(Special::Sent, &attributes(SENT)));
    }

    #[test]
    fn one_special_mailbox_is_not_another() {
        assert!(!is_special(Special::Sent, &attributes(ALL_MAIL)));
        assert!(!is_special(Special::AllMail, &attributes(SENT)));
        assert!(!is_special(Special::AllMail, &attributes(ORDINARY)));
        assert!(!is_special(Special::Sent, &attributes(ORDINARY)));
    }
}
