//! The door Swift knocks on.
//!
//! iOS schedules background work through `BGTaskScheduler`, which is Swift's
//! to register and Swift's to complete. Tauri's plugin bridge runs the other
//! way — the webview calls into Rust — and in a background wake-up there is no
//! webview to do the calling. So the engine exposes a C symbol instead, and
//! `PigeonBackground.swift` calls it directly out of the task handler. The
//! Rust library is linked into the app as a staticlib, so there is nothing to
//! load and nothing to find at runtime.
//!
//! Two rules hold across this boundary and both are absolute:
//!
//! A panic must not cross it. Unwinding into Swift is undefined behaviour, and
//! the thing most likely to panic here is a poisoned lock in a process iOS
//! killed halfway through the last wake-up — exactly the case this has to
//! survive. Everything is wrapped.
//!
//! And Rust owns what Rust allocated. The string handed back is freed by
//! `pigeon_string_free` and by nothing else; Swift copies it and gives it
//! back.

#![cfg(target_os = "ios")]

use std::ffi::{c_char, CStr, CString};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;

use super::mail;

/// Looks for mail worth a notification.
///
/// `dir` is the app's data directory — `Library/Application Support` joined
/// with the bundle identifier, which is what Tauri's `app_data_dir()` resolves
/// to on iOS and therefore where the foreground left the allowlist and the UID
/// mark. Swift computes the same path; if the two ever disagree the background
/// check reads an empty allowlist and says nothing, which is quiet rather than
/// wrong.
///
/// Returns JSON — `{"count":2,"names":["Dana Whitlock"],"subject":null}` — or
/// null for "nothing to say", which covers both no mail and any failure. The
/// caller must free a non-null result with [`pigeon_string_free`].
///
/// # Safety
///
/// `dir` must be a valid, NUL-terminated C string for the duration of the
/// call.
#[no_mangle]
pub unsafe extern "C" fn pigeon_background_check(dir: *const c_char) -> *mut c_char {
    let result = catch_unwind(AssertUnwindSafe(|| {
        if dir.is_null() {
            return None;
        }
        let path = CStr::from_ptr(dir).to_str().ok()?;
        let arrivals = mail::background_check(Path::new(path)).ok()??;
        let json = serde_json::to_string(&arrivals).ok()?;
        CString::new(json).ok()
    }));

    match result {
        Ok(Some(json)) => json.into_raw(),
        // A failure and an empty mailbox are the same answer to the only
        // question Swift is asking: is there anything to tell them about.
        _ => std::ptr::null_mut(),
    }
}

/// Frees a string returned by [`pigeon_background_check`].
///
/// # Safety
///
/// `text` must be null, or a pointer returned by `pigeon_background_check`
/// that has not already been freed.
#[no_mangle]
pub unsafe extern "C" fn pigeon_string_free(text: *mut c_char) {
    if !text.is_null() {
        drop(CString::from_raw(text));
    }
}
