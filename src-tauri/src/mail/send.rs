//! Sending, and the sent-mail walk behind "who do you know".
//!
//! The message bytes arrive already built: `mime.ts` keeps constructing the
//! RFC 2822 payload exactly as it did for Gmail REST — same encoded-word
//! handling, same In-Reply-To/References threading — and Rust only carries it.
//! Gmail files a copy in Sent on its own when mail goes out through its SMTP,
//! so there is no APPEND to get subtly wrong.

use base64::Engine;
use lettre::address::Envelope;
use lettre::transport::smtp::authentication::Credentials as SmtpCredentials;
use lettre::{SmtpTransport, Transport};

use super::session::{stored_credentials, with_mailbox, Special};
use super::types::SentRecipient;

const SMTP_HOST: &str = "smtp.gmail.com";

pub fn send_raw(raw_base64: String, to: Vec<String>) -> Result<(), String> {
    let creds = stored_credentials().ok_or("Pigeon isn't connected to Gmail.")?;

    let raw = base64::engine::general_purpose::STANDARD
        .decode(raw_base64)
        .map_err(|_| "The message didn't survive the trip to the mailer.")?;

    let from = creds
        .email
        .parse()
        .map_err(|_| "The account address didn't parse.".to_string())?;
    let recipients = to
        .iter()
        .map(|address| address.parse())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "A recipient address didn't parse.".to_string())?;
    let envelope = Envelope::new(Some(from), recipients)
        .map_err(|e| format!("The envelope didn't hold: {e}"))?;

    let mailer = SmtpTransport::relay(SMTP_HOST)
        .map_err(|e| format!("Couldn't reach Gmail's mailer: {e}"))?
        .credentials(SmtpCredentials::new(creds.email, creds.password))
        .build();

    mailer
        .send_raw(&envelope, &raw)
        .map_err(|e| explain_send(&e.to_string()))?;
    Ok(())
}

/// SMTP refusals in words. The one worth catching precisely is the daily cap,
/// because "try again tomorrow" is real advice and "sending failed" is not.
fn explain_send(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("daily") && lower.contains("limit") {
        return "Gmail's daily sending limit is used up for this account. It resets within 24 hours.".into();
    }
    if lower.contains("authentication") || lower.contains("password") {
        return "Gmail didn't accept the app password for sending. Reconnect the account.".into();
    }
    format!("This didn't send. Your draft is safe. ({error})")
}

/// Recent sent mail's recipients with counts — D10's second half. ENVELOPE
/// only: hundreds of messages are one FETCH, and nobody's body is read.
pub fn sent_recipients(limit: u32) -> Result<Vec<SentRecipient>, String> {
    with_mailbox(Special::Sent, move |session| {
        let uids = {
            let mut u: Vec<u32> = session.uid_search("ALL")?.into_iter().collect();
            u.sort_unstable_by(|a, b| b.cmp(a));
            u.truncate(limit as usize);
            u
        };

        let mut counts: std::collections::HashMap<String, (String, u32)> =
            std::collections::HashMap::new();

        for chunk in uids.chunks(500) {
            let set = chunk
                .iter()
                .map(|u| u.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let fetched = session.uid_fetch(set, "(UID ENVELOPE)")?;
            for fetch in fetched.iter() {
                let Some(envelope) = fetch.envelope() else { continue };
                for list in [envelope.to.as_ref(), envelope.cc.as_ref()] {
                    let Some(addresses) = list else { continue };
                    for address in addresses {
                        let (Some(mailbox), Some(host)) = (&address.mailbox, &address.host)
                        else {
                            continue;
                        };
                        let email = format!(
                            "{}@{}",
                            String::from_utf8_lossy(mailbox),
                            String::from_utf8_lossy(host)
                        )
                        .to_lowercase();
                        let name = address
                            .name
                            .as_ref()
                            .map(|n| String::from_utf8_lossy(n).to_string())
                            // An RFC 2047 encoded word is worse than no name.
                            .filter(|n| !n.contains("=?"))
                            .unwrap_or_default();
                        let entry = counts.entry(email).or_insert((name.clone(), 0));
                        if entry.0.is_empty() && !name.is_empty() {
                            entry.0 = name;
                        }
                        entry.1 += 1;
                    }
                }
            }
        }

        let mut recipients: Vec<SentRecipient> = counts
            .into_iter()
            .map(|(email, (name, count))| SentRecipient { name, email, count })
            .collect();
        recipients.sort_by(|a, b| b.count.cmp(&a.count));
        Ok(recipients)
    })
}
