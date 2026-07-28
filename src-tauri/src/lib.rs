mod machine;
mod mail;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            // An account connected on a previous run is connected now: the
            // credentials are in the Keychain and nothing will call
            // `mail_connect` this launch, so nothing else would start the
            // watch.
            mail::resume_watch(app.handle().clone());
            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
