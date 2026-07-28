//! Opening an attachment on a phone.
//!
//! The desktop saves it: a blob URL, an `<a download>`, and the browser does
//! the rest. WKWebView ignores both halves of that — the download attribute
//! and the blob navigation — so on iOS the chip was an affordance that said it
//! worked and did nothing at all, which is precisely the state `download.ts`
//! was written to get out of.
//!
//! What a phone wants instead is the system's own previewer: tap a PDF and it
//! opens, with Share and "Open in…" already attached. That is
//! `UIDocumentInteractionController`, which is Swift's to present — so this
//! writes the bytes to a file the app owns and hands the path across.
//!
//! `tauri-plugin-opener` cannot do it: its iOS arm is
//! `UIApplication.shared.open(url)`, and iOS refuses to open a `file://` URL
//! that way.

#![cfg(target_os = "ios")]

use std::ffi::CString;

use base64::Engine;
use tauri::{AppHandle, Manager};

unsafe extern "C" {
    /// `pigeon_present_file` in `PigeonFiles.swift`. Rust calling Swift, the
    /// mirror of `ios_ffi`'s Swift calling Rust — `@_cdecl` on that side is
    /// what makes the symbol plain C.
    fn pigeon_present_file(path: *const std::ffi::c_char);
}

/// Writes an attachment somewhere iOS can open it, and asks iOS to.
///
/// The cache directory rather than documents: these are copies of something
/// that still lives in the mailbox, and a phone reclaiming the space is the
/// right outcome rather than a loss. The filename is kept because it is what
/// the previewer's title bar shows and what "Open in…" carries onward.
#[tauri::command]
pub async fn attachment_present(
    app: AppHandle,
    filename: String,
    base64: String,
) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("That attachment didn't decode: {e}"))?;

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("No cache directory: {e}"))?
        .join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    /*
     * A name from a mail header, used as a path. Anything with a separator in
     * it is either a mistake or an attempt to write outside this directory, and
     * both end the same way — the file lands where it was told, under the name
     * it was given, with nothing to say it went somewhere else.
     */
    let safe = filename.replace(['/', '\\'], "_");
    let safe = if safe.trim().is_empty() || safe.starts_with('.') {
        format!("attachment{safe}")
    } else {
        safe
    };

    let path = dir.join(safe);
    std::fs::write(&path, bytes).map_err(|e| format!("Couldn't save the attachment: {e}"))?;

    let c_path = CString::new(path.to_string_lossy().as_bytes())
        .map_err(|e| format!("That path can't cross to Swift: {e}"))?;

    // SAFETY: the pointer is valid for the duration of the call, and the Swift
    // side copies what it needs before returning.
    unsafe { pigeon_present_file(c_path.as_ptr()) };
    Ok(())
}
