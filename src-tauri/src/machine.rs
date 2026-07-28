//! What this Mac can actually run.
//!
//! The assistant screen used to offer a bare list of whatever Ollama already
//! had pulled, which answers the wrong question. The question is "which model
//! should I run", and on Apple Silicon that is decided almost entirely by how
//! much unified memory is in the machine — a number the webview cannot see.
//! Safari exposes no memory API, and the Tauri webview is Safari.
//!
//! So Rust reads it. Two sysctls, once, at the moment the picker opens.
//!
//! Desktop only, and enforced here rather than left to the caller. iOS forbids
//! spawning a process at all, so `sysctl` cannot run in that build — and there
//! is nothing for it to answer, because no model runs beside the app on a
//! phone. Compiled out entirely on mobile rather than returning `None` at
//! runtime: a command that is always `None` is one somebody eventually tries
//! to fix.

#[cfg(desktop)]
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineMemory {
    /// Total physical memory in bytes — `hw.memsize`.
    pub total_bytes: u64,
    /// What a model may realistically occupy, in bytes.
    ///
    /// Not the same number. macOS reserves the rest for everything that is not
    /// a language model, including the mail client asking the question, and a
    /// picker that offered a 17GB model on a 16GB Mac because "16 ≥ 17 is
    /// false, just" would be technically defensible and useless.
    pub usable_bytes: u64,
    /// e.g. "Apple M3". Absent when the sysctl is missing.
    pub chip: Option<String>,
}

/// The fraction of physical memory a model is allowed to claim.
///
/// Apple's own default cap for GPU working-set size is around 75% of physical
/// memory. Two thirds leaves room for the OS, the browser engine rendering
/// this app, and the mailbox held in it — a model that fits exactly and then
/// swaps is slower than the smaller model that did not.
#[cfg(desktop)]
const USABLE_FRACTION: f64 = 2.0 / 3.0;

#[cfg(desktop)]
fn sysctl(key: &str) -> Option<String> {
    /*
     * Shelling out rather than binding `sysctlbyname`.
     *
     * This runs once, on a screen the user opened deliberately, in a macOS-only
     * app. The alternative is fifteen lines of `unsafe` FFI and a `libc`
     * dependency to read two values that `sysctl -n` prints on stdout.
     */
    let output = Command::new("/usr/sbin/sysctl").args(["-n", key]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// Desktop's answer. iOS gets [`machine_memory`]'s other arm.
#[cfg(desktop)]
#[tauri::command]
pub fn machine_memory() -> Option<MachineMemory> {
    let total_bytes: u64 = sysctl("hw.memsize")?.parse().ok()?;
    Some(MachineMemory {
        total_bytes,
        usable_bytes: (total_bytes as f64 * USABLE_FRACTION) as u64,
        // `machdep.cpu.brand_string` reads "Apple M3" on Apple Silicon and an
        // Intel part number on older Macs. Either is a fine thing to show.
        chip: sysctl("machdep.cpu.brand_string"),
    })
}

/// The same command on iOS, where there is nothing to survey.
///
/// It still exists, because `generate_handler!` names it and the webview may
/// call it — `usableMemory` is one function on the TypeScript side. It simply
/// has one answer.
#[cfg(mobile)]
#[tauri::command]
pub fn machine_memory() -> Option<MachineMemory> {
    None
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn reports_a_plausible_amount_of_memory() {
        let Some(memory) = machine_memory() else {
            // A machine where the sysctl is unavailable is a machine where the
            // picker falls back to showing sizes without fit. Not a failure.
            return;
        };
        // No Mac that can build this has less than 2GB or more than 1TB.
        assert!(memory.total_bytes > 2_000_000_000);
        assert!(memory.total_bytes < 1_000_000_000_000);
        assert!(memory.usable_bytes < memory.total_bytes);
        assert!(memory.usable_bytes > memory.total_bytes / 2);
    }

    #[test]
    fn a_missing_sysctl_is_none_rather_than_a_panic() {
        assert!(sysctl("this.key.does.not.exist").is_none());
    }
}
