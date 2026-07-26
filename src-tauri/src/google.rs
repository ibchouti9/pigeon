//! Google sign-in for an installed app.
//!
//! The web build uses Google Identity Services, which hands the browser a
//! one-hour access token and no refresh token — so a web user re-consents
//! whenever the hour lapses, and Google's own guidance is that the renewal
//! needs a user gesture behind it.
//!
//! A desktop app gets the better flow. Google calls it the "installed app"
//! flow: PKCE, the *system* browser rather than an embedded webview (which
//! Google rejects outright with `disallowed_useragent`), and a redirect back
//! to a loopback port that this process is listening on. It returns a refresh
//! token, which lives in the macOS Keychain and never reaches the webview.
//!
//! The loopback redirect is also why the desktop client type is worth the
//! switch on its own: installed-app clients need no registered redirect URI,
//! so the "authorised origin doesn't match" dead end simply cannot happen.

use base64::Engine;
use keyring::Entry;
use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const AUTH_URI: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URI: &str = "https://oauth2.googleapis.com/revoke";

const KEYCHAIN_SERVICE: &str = "com.pigeonmail.pigeon";
const CLIENT_ENTRY: &str = "google-oauth-client";
const REFRESH_ENTRY: &str = "google-refresh-token";

/// The permissions Pigeon asks for. `contacts.readonly` is the only optional
/// one — when the People API is switched off the provider falls back to who
/// you have written to, which is why the setup guide marks that step optional.
const SCOPES: [&str; 4] = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
];

/// How long the loopback listener waits for the user to finish with Google.
const CONSENT_TIMEOUT: Duration = Duration::from_secs(300);

/* -------------------------------------------------------------------------- */
/* Stored client credentials                                                   */
/* -------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientCredentials {
    pub client_id: String,
    /// Google issues one for desktop clients but documents it as *not*
    /// confidential — an installed app cannot keep a secret, which is the whole
    /// reason PKCE exists. Absent is fine; the exchange just omits it.
    #[serde(default)]
    pub client_secret: String,
}

/// The shape Google's "Download JSON" button produces.
#[derive(Deserialize)]
struct DownloadedJson {
    installed: Option<ClientBlock>,
    web: Option<ClientBlock>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(Deserialize)]
struct ClientBlock {
    client_id: String,
    #[serde(default)]
    client_secret: String,
}

/// Reads the file Google hands over, and says precisely what is wrong when it
/// is the wrong one. Every branch here is a mistake a real person makes at
/// three minutes past midnight: the credentials page offers several buttons and
/// only one of them is right.
pub fn parse_credentials(raw: &str) -> Result<ClientCredentials, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("That file was empty.".into());
    }

    // A bare client ID, pasted rather than dropped. Accept it: the exchange
    // works without a secret, and refusing would be pedantry.
    if !trimmed.starts_with('{') {
        if trimmed.ends_with(".apps.googleusercontent.com") && !trimmed.contains(char::is_whitespace)
        {
            return Ok(ClientCredentials {
                client_id: trimmed.to_string(),
                client_secret: String::new(),
            });
        }
        if trimmed.starts_with("GOCSPX-") {
            return Err("That's the client secret, not the client ID. Pigeon needs the JSON file — use Download JSON on the credentials page.".into());
        }
        return Err("That doesn't look like a Google client. Use Download JSON on the credentials page and drop the file here.".into());
    }

    let parsed: DownloadedJson = serde_json::from_str(trimmed)
        .map_err(|_| "That file isn't valid JSON. Download it again from the credentials page.".to_string())?;

    if let Some(block) = parsed.installed {
        if block.client_id.is_empty() {
            return Err("That file has no client ID in it. Download it again from the credentials page.".into());
        }
        return Ok(ClientCredentials {
            client_id: block.client_id,
            client_secret: block.client_secret,
        });
    }

    if parsed.web.is_some() {
        return Err("That's a Web application client. Pigeon needs a Desktop app client — create one under Credentials → Create credentials → OAuth client ID, and pick Desktop app.".into());
    }

    if parsed.kind.as_deref() == Some("service_account") {
        return Err("That's a service account key. Service accounts can't read your own mail — create an OAuth client ID of type Desktop app instead.".into());
    }

    Err("That file isn't a Google OAuth client. Use Download JSON on the credentials page — the button at the end of the row.".into())
}

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, name).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn read_secret(name: &str) -> Option<String> {
    entry(name).ok()?.get_password().ok().filter(|s| !s.is_empty())
}

fn write_secret(name: &str, value: &str) -> Result<(), String> {
    entry(name)?
        .set_password(value)
        .map_err(|e| format!("Couldn't save to the Keychain: {e}"))
}

fn delete_secret(name: &str) {
    if let Ok(e) = entry(name) {
        let _ = e.delete_credential();
    }
}

pub fn stored_credentials() -> Option<ClientCredentials> {
    serde_json::from_str(&read_secret(CLIENT_ENTRY)?).ok()
}

pub fn store_credentials(creds: &ClientCredentials) -> Result<(), String> {
    let encoded = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    write_secret(CLIENT_ENTRY, &encoded)
}

pub fn forget_credentials() {
    delete_secret(CLIENT_ENTRY);
    delete_secret(REFRESH_ENTRY);
}

pub fn has_refresh_token() -> bool {
    read_secret(REFRESH_ENTRY).is_some()
}

/* -------------------------------------------------------------------------- */
/* PKCE                                                                        */
/* -------------------------------------------------------------------------- */

struct Pkce {
    verifier: String,
    challenge: String,
}

fn pkce() -> Pkce {
    let verifier: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    Pkce { verifier, challenge }
}

fn random_state() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

/* -------------------------------------------------------------------------- */
/* The loopback leg                                                            */
/* -------------------------------------------------------------------------- */

/// What the browser came back with.
enum Callback {
    Code(String),
    Denied(String),
}

/// Serves exactly one OAuth redirect on a port the OS picks for us, then stops.
///
/// Blocking, so callers run it off the main thread. The loop matters: a browser
/// will also ask for `/favicon.ico`, and an earlier version treated that first
/// stray request as the callback and gave up with "no code".
fn await_callback(listener: TcpListener, expected_state: &str) -> Result<Callback, String> {
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Couldn't listen for Google's reply: {e}"))?;
    let deadline = Instant::now() + CONSENT_TIMEOUT;

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();

                let mut line = String::new();
                if BufReader::new(&stream).read_line(&mut line).is_err() {
                    continue;
                }

                // "GET /?code=…&state=… HTTP/1.1"
                let target = line.split_whitespace().nth(1).unwrap_or("");
                let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
                let mut code = None;
                let mut error = None;
                let mut state = None;
                for pair in query.split('&') {
                    let Some((key, value)) = pair.split_once('=') else {
                        continue;
                    };
                    let value = urlencoding::decode(value).unwrap_or_default().into_owned();
                    match key {
                        "code" => code = Some(value),
                        "error" => error = Some(value),
                        "state" => state = Some(value),
                        _ => {}
                    }
                }

                if code.is_none() && error.is_none() {
                    // Not the callback — a favicon probe, or the user reloading.
                    let _ = stream.write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    );
                    continue;
                }

                let outcome = if let Some(err) = error {
                    Callback::Denied(err)
                } else if state.as_deref() != Some(expected_state) {
                    // Someone else's redirect landed on our port.
                    Callback::Denied("state_mismatch".into())
                } else {
                    Callback::Code(code.unwrap_or_default())
                };

                let body = landing_page(matches!(outcome, Callback::Code(_)));
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                );
                let _ = stream.flush();
                return Ok(outcome);
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("Pigeon stopped waiting for Google. Try connecting again.".into());
                }
                std::thread::sleep(Duration::from_millis(80));
            }
            Err(e) => return Err(format!("Couldn't listen for Google's reply: {e}")),
        }
    }
}

fn landing_page(ok: bool) -> String {
    let (title, line) = if ok {
        ("Pigeon is connected", "You can close this tab and go back to Pigeon.")
    } else {
        ("Pigeon didn't connect", "Go back to Pigeon — it will tell you what happened.")
    };
    format!(
        "<!doctype html><meta charset=utf-8><title>{title}</title>\
         <body style=\"font:16px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#1a1a1a;background:#faf9f7\">\
         <main style=\"text-align:center\"><h1 style=\"font-size:20px;font-weight:600;margin:0 0 8px\">{title}</h1>\
         <p style=\"margin:0;color:#6b6b6b\">{line}</p></main>"
    )
}

/* -------------------------------------------------------------------------- */
/* Token exchange                                                              */
/* -------------------------------------------------------------------------- */

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

/// What the webview is given: an access token and when it dies. The refresh
/// token stays on this side of the bridge.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub access_token: String,
    /// Epoch milliseconds, so the JS side can compare against `Date.now()`.
    pub expires_at: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn post_token(form: Vec<(&str, String)>) -> Result<TokenResponse, String> {
    let response = reqwest::Client::new()
        .post(TOKEN_URI)
        .form(&form)
        .send()
        .await
        .map_err(|_| "Couldn't reach Google. Check your connection and try again.".to_string())?;

    response
        .json::<TokenResponse>()
        .await
        .map_err(|_| "Google's reply didn't make sense. Try connecting again.".to_string())
}

/// Google's error codes, said in words a user can act on.
fn explain(error: &str, description: Option<&str>) -> String {
    match error {
        // Google returns this both when the user clicks Cancel and when the
        // account is not on the client's test-user list. The second is by far
        // the more likely one during setup, and the least guessable.
        "access_denied" => "Google refused. If you didn't cancel, the account you picked isn't on your client's test-user list — add it under Audience on the OAuth consent screen, then try again.".into(),
        "admin_policy_enforced" => "Your Google Workspace admin blocks apps like Pigeon from reading mail. You'll need their approval, or a personal account.".into(),
        "invalid_client" => "Google didn't recognise that client. Download the JSON again from the credentials page and drop it into Pigeon.".into(),
        "invalid_grant" => "That sign-in has expired. Connect Gmail again.".into(),
        "state_mismatch" => "Something else answered on Pigeon's port. Try connecting again.".into(),
        "org_internal" => "That client is limited to one Google Workspace organisation, and this account isn't in it.".into(),
        other => match description {
            Some(d) if !d.is_empty() => format!("Google said: {d}"),
            _ => format!("Google refused with \"{other}\". Try connecting again."),
        },
    }
}

fn session_from(response: TokenResponse) -> Result<Session, String> {
    if let Some(error) = response.error {
        return Err(explain(&error, response.error_description.as_deref()));
    }
    let access_token = response
        .access_token
        .ok_or_else(|| "Google didn't return an access token. Try connecting again.".to_string())?;

    // Only the interactive leg returns one; a refresh keeps the token it has.
    if let Some(refresh) = response.refresh_token {
        write_secret(REFRESH_ENTRY, &refresh)?;
    }

    Ok(Session {
        access_token,
        expires_at: now_ms() + response.expires_in.unwrap_or(3600) * 1000,
    })
}

/// The whole interactive flow: consent in the system browser, then exchange.
pub async fn sign_in<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Session, String> {
    let creds = stored_credentials().ok_or_else(|| {
        "Pigeon doesn't have a Google client yet. Set one up first — it takes about five minutes."
            .to_string()
    })?;

    // Port 0 means the OS picks a free one. Installed-app clients accept any
    // loopback port, so there is nothing to register and nothing to mismatch.
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Couldn't open a local port for Google's reply: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Couldn't open a local port for Google's reply: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let Pkce { verifier, challenge } = pkce();
    let state = random_state();

    let url = format!(
        "{AUTH_URI}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        urlencoding::encode(&creds.client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&SCOPES.join(" ")),
        urlencoding::encode(&challenge),
        urlencoding::encode(&state),
    );

    // The system browser, not a webview: Google rejects embedded user agents,
    // and the user's existing Google session is in their real browser anyway.
    tauri_plugin_opener::OpenerExt::opener(app)
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Couldn't open your browser: {e}"))?;

    let callback = tauri::async_runtime::spawn_blocking(move || await_callback(listener, &state))
        .await
        .map_err(|e| format!("Sign-in stopped unexpectedly: {e}"))??;

    let code = match callback {
        Callback::Code(code) => code,
        Callback::Denied(error) => return Err(explain(&error, None)),
    };

    let mut form = vec![
        ("code", code),
        ("client_id", creds.client_id.clone()),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code".to_string()),
        ("redirect_uri", redirect_uri),
    ];
    if !creds.client_secret.is_empty() {
        form.push(("client_secret", creds.client_secret.clone()));
    }

    session_from(post_token(form).await?)
}

/// Trades the stored refresh token for a fresh access token.
pub async fn refresh() -> Result<Session, String> {
    let creds = stored_credentials()
        .ok_or_else(|| "Pigeon doesn't have a Google client yet.".to_string())?;
    let refresh_token = read_secret(REFRESH_ENTRY)
        .ok_or_else(|| "Pigeon isn't signed in to Google.".to_string())?;

    let mut form = vec![
        ("refresh_token", refresh_token),
        ("client_id", creds.client_id.clone()),
        ("grant_type", "refresh_token".to_string()),
    ];
    if !creds.client_secret.is_empty() {
        form.push(("client_secret", creds.client_secret.clone()));
    }

    let response = post_token(form).await?;

    // A refresh token that Google has retired is the seven-day expiry biting,
    // and the only cure is consent again. Drop it so the app stops retrying.
    if response.error.as_deref() == Some("invalid_grant") {
        delete_secret(REFRESH_ENTRY);
        return Err("Google's permission has run out — its test-mode grants last seven days. Connect Gmail again.".into());
    }

    session_from(response)
}

pub async fn sign_out() {
    if let Some(token) = read_secret(REFRESH_ENTRY) {
        let _ = reqwest::Client::new()
            .post(REVOKE_URI)
            .form(&[("token", token)])
            .send()
            .await;
    }
    delete_secret(REFRESH_ENTRY);
}
