//! The IMAP session: one connection, kept warm, reconnected when it drops.
//!
//! Everything speaks to Gmail through `with_mailbox`, which owns the lock, the
//! LOGIN, the SELECT, and one retry. The retry matters more than it looks:
//! Gmail hangs up idle IMAP connections after about ten minutes, so the first
//! call after any pause would otherwise fail with an IO error that reads, to
//! the user, like their mail breaking at random.

use keyring::Entry;
use native_tls::{TlsConnector, TlsStream};
use std::net::TcpStream;
use std::sync::Mutex;

use super::types::Credentials;

const HOST: &str = "imap.gmail.com";
const PORT: u16 = 993;

const KEYCHAIN_SERVICE: &str = "com.pigeonmail.pigeon";
const ACCOUNT_ENTRY: &str = "gmail-app-password";

pub type ImapSession = imap::Session<TlsStream<TcpStream>>;

struct Live {
    session: ImapSession,
    /// The mailbox currently SELECTed, to skip redundant round trips.
    selected: Option<String>,
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
    let tls = TlsConnector::builder()
        .build()
        .map_err(|e| connection_error(e))?;
    let client = imap::connect((HOST, PORT), HOST, &tls).map_err(|e| connection_error(e))?;
    client
        .login(&creds.email, &creds.password)
        .map_err(|(e, _client)| explain_login(&e.to_string()))
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
    *LIVE.lock().unwrap() = Some(Live { session, selected: None });
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

fn find_special(session: &mut ImapSession, which: Special) -> Result<String, String> {
    if let Special::Inbox = which {
        return Ok("INBOX".into());
    }
    let attribute = match which {
        Special::AllMail => "\\All",
        Special::Sent => "\\Sent",
        Special::Inbox => unreachable!(),
    };
    let names = session
        .list(None, Some("*"))
        .map_err(|e| connection_error(e))?;
    for name in names.iter() {
        let has = name
            .attributes()
            .iter()
            .any(|a| format!("{a:?}").contains(attribute));
        if has {
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
    work: impl Fn(&mut ImapSession) -> Result<T, imap::Error>,
) -> Result<T, String> {
    let mut guard = LIVE.lock().unwrap();

    for attempt in 0..2 {
        if guard.is_none() {
            let creds = stored_credentials()
                .ok_or_else(|| "Pigeon isn't connected to Gmail.".to_string())?;
            *guard = Some(Live { session: open(&creds)?, selected: None });
        }
        let live = guard.as_mut().unwrap();

        let outcome = (|| -> Result<T, imap::Error> {
            let name = match which {
                Special::Inbox => "INBOX".to_string(),
                _ => find_special(&mut live.session, which).map_err(imap::Error::Bad)?,
            };
            if live.selected.as_deref() != Some(&name) {
                live.session.select(&name)?;
                live.selected = Some(name);
            }
            work(&mut live.session)
        })();

        match outcome {
            Ok(value) => return Ok(value),
            Err(imap::Error::Bad(message)) => return Err(message),
            Err(error) => {
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
