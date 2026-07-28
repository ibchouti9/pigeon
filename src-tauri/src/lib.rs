mod badge;
mod machine;
mod mail;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(desktop)]
            tray::install(app.handle())?;
            // An account connected on a previous run is connected now: the
            // credentials are in the Keychain and nothing will call
            // `mail_connect` this launch, so nothing else would start the
            // watch.
            mail::resume_watch(app.handle().clone());
            Ok(())
        })
        /*
         * The close button hides rather than quits, so the watch outlives the
         * window. Every other way out is left alone — ⌘Q, the tray's Quit, the
         * platform's own exit — because an app that cannot be closed is worse
         * than one that stops watching when you close it.
         */
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            // Silences the unused bindings on mobile, where neither arm exists.
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            mail::mail_status,
            mail::mail_connect,
            mail::mail_disconnect,
            mail::mail_list_threads,
            mail::mail_search,
            mail::mail_get_thread,
            mail::mail_set_place,
            mail::mail_mark_read,
            mail::mail_silence,
            mail::mail_send,
            mail::mail_sent_recipients,
            mail::mail_attachment,
            machine::machine_memory,
            badge::set_unread_badge,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the application");

    /*
     * `build` then `run` rather than `run` alone, for one event: macOS sends
     * `Reopen` when the dock icon is clicked, and with the window hidden that
     * click is the main way back in. Without handling it, closing Pigeon left
     * a dock icon that did nothing.
     */
    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } = _event
        {
            tray::show_main(_app_handle);
        }
    });
}
