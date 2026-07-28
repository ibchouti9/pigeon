//  PigeonHaptics.swift
//
//  The difference between an app and a web page in a wrapper.
//
//  Pigeon's decisions are physical in the design already — the postmark is
//  "stamped onto a sender card at the moment of decision" — and on a phone
//  that moment has, until now, been entirely silent. Approving somebody felt
//  the same as scrolling past them.
//
//  Called from Rust (`haptics.rs`) through `@_cdecl`, the same seam
//  `PigeonFiles` uses.

import UIKit

@objc(PigeonHaptics) final class PigeonHaptics: NSObject {
    private override init() {}

    /*
     * Generators are kept rather than made per tap.
     *
     * `prepare()` warms the Taptic Engine, and a generator created and thrown
     * away on each call is never warm — the feedback arrives tens of
     * milliseconds after the touch, which is late enough to feel like a
     * coincidence rather than a response.
     */
    private static let impact = UIImpactFeedbackGenerator(style: .light)
    private static let notice = UINotificationFeedbackGenerator()

    static func play(_ kind: String) {
        switch kind {
        case "decided":
            // A decision that changed something: approving a sender, sending.
            notice.prepare()
            notice.notificationOccurred(.success)
        case "refused":
            /*
             * Declining, and deliberately not `.error`. Nothing went wrong —
             * the user did exactly what they meant to — and `.error`'s double
             * knock reads as a rejection of *them*.
             */
            notice.prepare()
            notice.notificationOccurred(.warning)
        default:
            // The small one: a row committing, a pull crossing its threshold.
            impact.prepare()
            impact.impactOccurred()
        }
    }
}

/// The symbol `haptics.rs` calls. Hops to the main queue because UIKit's
/// feedback generators must be touched there.
@_cdecl("pigeon_haptic")
func pigeonHaptic(_ kind: UnsafePointer<CChar>) {
    let copied = String(cString: kind)
    DispatchQueue.main.async { PigeonHaptics.play(copied) }
}
