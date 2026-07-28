//! Staying reachable once the window is shut.
//!
//! A mail client that only watches for mail while its window is open is a mail
//! client that tells you about mail you were already looking at. The watch in
//! `mail::watch` runs on a thread that does not care whether anything is on
//! screen — but the process has to survive the window for that to matter, and
//! on every desktop platform closing the last window ends the process.
//!
//! So the close button hides. Quit still quits: ⌘Q, the tray's own Quit item,
//! and `RunEvent::ExitRequested` are all left alone, because an app you cannot
//! get rid of is worse than one that stops watching.

#![cfg(desktop)]

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

/// The id the tray is registered under, so the badge can find it again.
pub const TRAY_ID: &str = "pigeon";

const OPEN: &str = "open";
const QUIT: &str = "quit";

/// Brings the window back, whether it was hidden or merely behind something.
///
/// All three of these are needed and each fixes a different half-open state:
/// `show` on a window hidden by the close button, `unminimize` on one sent to
/// the dock, and `set_focus` on one that is visible but behind the browser you
/// were reading in.
pub fn show_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, OPEN, "Open Pigeon", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT, "Quit Pigeon", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        // The bundle's own icon, which `tauri.conf.json` always supplies. A
        // tray without one is an invisible tray, so this is worth failing
        // setup over rather than building something nobody can click.
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or("the bundle has no icon for the tray to use")?,
        )
        .tooltip("Pigeon")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN => show_main(app),
            // `exit` rather than dropping the tray: this is the one control
            // that has to end the process even though the close button no
            // longer does.
            QUIT => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

/// Writes the unread count beside the tray icon, or clears it at zero.
///
/// macOS draws this as text in the menu bar, which is the one place the count
/// is visible with every window shut. Other platforms ignore it, which is why
/// the badge on the dock icon is set separately rather than instead.
pub fn set_count(app: &AppHandle, count: u32) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let _ = tray.set_title(if count == 0 {
        None
    } else {
        Some(count.to_string())
    });
}
