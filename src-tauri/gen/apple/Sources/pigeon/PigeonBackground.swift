//  PigeonBackground.swift
//
//  The iPhone half of "tell me when mail arrives".
//
//  iOS suspends every app that is not in front, which takes the IMAP
//  connection with it — so the watch that runs on the Mac cannot run here.
//  What iOS offers instead is BGAppRefreshTask: it wakes the app when it feels
//  like it, judged on how the person actually uses it, and gives roughly
//  thirty seconds.
//
//  Be honest about what that buys. This is not push. A message may be
//  announced fifteen minutes after it arrives or several hours, iOS decides
//  which, and it stops entirely if the app is force-quit or the phone is in
//  Low Power Mode. Real push would need a server holding IMAP IDLE and
//  forwarding to APNs, and there is deliberately no Pigeon server.
//
//  Everything below the scheduling is Rust's: `pigeon_background_check` opens
//  the connection, applies §2.3, and hands back one line to say.
//
//  Lives inside the generated Xcode project because that is where Xcode
//  compiles it from. `tauri ios init` regenerates the project around it and
//  leaves both this file and `main.mm` alone — verified by running it — so
//  neither needs re-applying afterwards.

import BackgroundTasks
import Foundation
import UserNotifications

// The C symbols from `src-tauri/src/ios_ffi.rs`. The Rust library is linked
// into the app as a staticlib, so these resolve at link time.
@_silgen_name("pigeon_background_check")
func pigeon_background_check(_ dir: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?

@_silgen_name("pigeon_string_free")
func pigeon_string_free(_ text: UnsafeMutablePointer<CChar>?)

/// What Rust decided to say. The wording is `Arrivals::headline` in
/// `src-tauri/src/mail/background.rs` — one sentence, written once, so mail
/// that reads "Dana Whitlock" on a Mac does not read "1 new messages" here.
private struct Notice: Decodable {
    let title: String
    let body: String
}

/// A class, not the `enum` namespace this would otherwise be: `main.mm` calls
/// `install` across the language boundary, and `@objc` is only available on
/// members of classes.
///
/// The name is pinned with `@objc(PigeonBackground)` because Swift otherwise
/// exports a mangled, module-prefixed symbol, and the hand-written declaration
/// in `main.mm` is looking for this one.
@objc(PigeonBackground) final class PigeonBackground: NSObject {
    /// Must match `BGTaskSchedulerPermittedIdentifiers` in Info.ios.plist.
    /// iOS refuses to register a task whose identifier is not declared there,
    /// and the refusal is a crash at launch rather than a warning.
    static let taskIdentifier = "com.pigeonmail.pigeon.refresh"

    /// The soonest iOS is asked to consider waking us.
    ///
    /// A floor, not a schedule. iOS treats it as the earliest it will *think*
    /// about it and then decides for itself, so asking for one minute does not
    /// get one minute — it gets the same treatment as fifteen with a worse
    /// reputation for battery.
    private static let earliest: TimeInterval = 15 * 60

    /// Registers the handler and asks for the first wake-up.
    ///
    /// Called from `main.mm` before `start_app`, which is the only seam Tauri
    /// leaves: the generated app has no delegate of its own to hook, and
    /// `BGTaskScheduler.register` must happen before launching finishes.
    ///
    /// Unverifiable in the simulator, which has no BGTaskScheduler at all —
    /// `submit` reports "unavailable" there and no task ever runs. What the
    /// simulator does prove is that this compiles, links against the Rust
    /// symbols, and registers without throwing.
    @objc static func install() {
        register()
        schedule()
    }

    private static func register() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: taskIdentifier,
            using: nil
        ) { task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            run(refresh)
        }
    }

    /// Asks for the next wake-up. Safe to call repeatedly; a second request
    /// with the same identifier replaces the first.
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: earliest)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Unavailable in the simulator, and refused when the user has
            // switched Background App Refresh off. Both mean no background
            // mail, and neither is worth interrupting anyone about.
            NSLog("Pigeon: could not schedule background refresh: \(error)")
        }
    }

    /// Never instantiated; every member is static.
    private override init() {}

    /// Where the foreground left the allowlist and the UID mark.
    ///
    /// This has to match Tauri's `app_data_dir()` exactly. Verified on a
    /// simulator rather than assumed: the foreground wrote its allowlist to
    /// `<container>/Library/Application Support/com.pigeonmail.pigeon/`, which
    /// is what the two lines below compute. If they ever drift the check reads
    /// an empty allowlist and says nothing — quiet rather than wrong, which is
    /// the direction this whole feature errs in.
    private static func dataDirectory() -> String? {
        guard
            let support = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first,
            let identifier = Bundle.main.bundleIdentifier
        else { return nil }
        return support.appendingPathComponent(identifier).path
    }

    private static func run(_ task: BGAppRefreshTask) {
        /*
         * Reschedule first, before any work that might not finish. A wake-up
         * that is killed on expiry without having asked for the next one is
         * the last wake-up that app ever gets — the chain simply stops, and
         * nothing on screen would say so.
         */
        schedule()

        let work = DispatchWorkItem {
            guard let dir = dataDirectory() else {
                task.setTaskCompleted(success: false)
                return
            }

            let json: String? = dir.withCString { pointer in
                guard let raw = pigeon_background_check(pointer) else { return nil }
                defer { pigeon_string_free(raw) }
                return String(cString: raw)
            }

            guard
                let json,
                let notice = try? JSONDecoder().decode(Notice.self, from: Data(json.utf8))
            else {
                // No mail, or a connection that failed. Both are a successful
                // wake-up: it ran, it found nothing to say, and iOS should go
                // on scheduling us.
                task.setTaskCompleted(success: true)
                return
            }

            post(notice)
            task.setTaskCompleted(success: true)
        }

        /*
         * iOS gives about thirty seconds and then calls this. Cancelling
         * releases the wake-up cleanly; without it the system kills the
         * process, which it counts against how often Pigeon is woken again.
         */
        task.expirationHandler = {
            work.cancel()
            task.setTaskCompleted(success: false)
        }

        DispatchQueue.global(qos: .utility).async(execute: work)
    }

    private static func post(_ notice: Notice) {
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.body = notice.body
        content.sound = .default

        // Immediate: the trigger is that mail has already arrived.
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}
