//! A tap you can feel.
//!
//! §4's postmark is "stamped onto a sender card at the moment of decision",
//! which is a physical metaphor the desktop can only draw. A phone can
//! actually do it, and until now approving somebody felt exactly like
//! scrolling past them.
//!
//! Three kinds, and no more: something was decided, something was refused, and
//! something small happened. A vocabulary that grows past what a hand can
//! actually tell apart is a vocabulary nobody learns.

#![cfg(target_os = "ios")]

use std::ffi::CString;

unsafe extern "C" {
    /// `pigeon_haptic` in `PigeonHaptics.swift`.
    fn pigeon_haptic(kind: *const std::ffi::c_char);
}

/// Plays one. Unknown kinds fall through to the small one on the Swift side,
/// which is the right failure: a haptic nobody asked for is worse than the
/// wrong haptic, and silence is worse than both.
#[tauri::command]
pub fn haptic(kind: String) {
    let Ok(c_kind) = CString::new(kind) else {
        return;
    };
    // SAFETY: valid for the duration of the call; Swift copies before it
    // returns, and hops to the main queue with the copy.
    unsafe { pigeon_haptic(c_kind.as_ptr()) };
}
