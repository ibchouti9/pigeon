//! Does the capability file actually admit the requests the app makes?
//!
//! The HTTP plugin's scope is a list of URL patterns in
//! `capabilities/default.json`, and a request outside it fails with an error
//! the adapters can only render as "Couldn't reach" — indistinguishable, on
//! screen, from being offline. That is exactly what a wrong pattern looks
//! like: nothing in a build or a webview test touches it, and the first
//! symptom is a working API key that appears not to work.
//!
//! So this test runs the *shipped* patterns against the *actual* URLs the
//! adapters request, through the same matching the plugin uses:
//! `parse_url_pattern` below is copied verbatim from
//! tauri-plugin-http 2.5.9's `src/scope.rs` (the function is private there),
//! and the crate versions are pinned by the same lockfile.

use urlpattern::{UrlPattern, UrlPatternMatchInput};

/// Verbatim from tauri-plugin-http 2.5.9 `src/scope.rs`. If a plugin update
/// changes that file, update this copy to match.
fn parse_url_pattern(s: &str) -> Result<UrlPattern, urlpattern::quirks::Error> {
    let mut init = urlpattern::UrlPatternInit::parse_constructor_string::<regex::Regex>(s, None)?;
    if init.search.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        init.search.replace("*".to_string());
    }
    if init.hash.as_ref().map(|p| p.is_empty()).unwrap_or(true) {
        init.hash.replace("*".to_string());
    }
    if init
        .pathname
        .as_ref()
        .map(|p| p.is_empty() || p == "/")
        .unwrap_or(true)
    {
        init.pathname.replace("*".to_string());
    }
    UrlPattern::parse(init, Default::default())
}

/// The `http:default` allow patterns, straight out of the shipped file.
fn shipped_patterns() -> Vec<String> {
    let raw = include_str!("../capabilities/default.json");
    let parsed: serde_json::Value = serde_json::from_str(raw).expect("capability file parses");
    let permissions = parsed["permissions"].as_array().expect("permissions array");

    let http = permissions
        .iter()
        .find(|p| p["identifier"] == "http:default")
        .expect("an http:default permission");
    http["allow"]
        .as_array()
        .expect("http allow list")
        .iter()
        .map(|entry| {
            entry["url"]
                .as_str()
                .expect("allow entry with a url")
                .to_string()
        })
        .collect()
}

fn allowed(patterns: &[String], url: &str) -> bool {
    let url = url::Url::parse(url).expect("test url parses");
    patterns.iter().any(|pattern| {
        parse_url_pattern(pattern)
            .unwrap_or_else(|e| panic!("`{pattern}` is not a valid URL pattern: {e:?}"))
            .test(UrlPatternMatchInput::Url(url.clone()))
            .unwrap_or_default()
    })
}

/// Every URL an adapter actually requests. One entry per call site in
/// `src/ai/adapters/` — if an adapter grows an endpoint, it belongs here.
const REQUESTS: &[&str] = &[
    // anthropic.ts
    "https://api.anthropic.com/v1/messages",
    // openai.ts
    "https://api.openai.com/v1/chat/completions",
    // google.ts
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    // local.ts — Ollama's default port, and LM Studio's
    "http://localhost:11434/api/tags",
    "http://localhost:11434/api/chat",
    "http://localhost:1234/api/tags",
    "http://127.0.0.1:11434/api/chat",
];

#[test]
fn every_adapter_request_is_inside_the_shipped_scope() {
    let patterns = shipped_patterns();
    let refused: Vec<&str> = REQUESTS
        .iter()
        .filter(|url| !allowed(&patterns, url))
        .copied()
        .collect();

    assert!(
        refused.is_empty(),
        "the shipped capability scope refuses these requests: {refused:#?}\n\
         patterns: {patterns:#?}"
    );
}

#[test]
fn the_scope_still_refuses_what_it_should() {
    let patterns = shipped_patterns();
    // No pattern should quietly become allow-everything.
    assert!(!allowed(&patterns, "https://example.com/steal"));
    assert!(!allowed(&patterns, "https://api.anthropic.com.evil.example/v1/messages"));
}
