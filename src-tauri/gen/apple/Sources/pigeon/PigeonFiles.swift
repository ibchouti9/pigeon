//  PigeonFiles.swift
//
//  Showing an attachment the way a phone shows one.
//
//  The desktop hands a blob to the browser and lets it save. WKWebView ignores
//  both the download attribute and the blob navigation, so on iOS that route
//  ends in silence — a chip that says it works and does nothing.
//
//  `UIDocumentInteractionController` is what iOS Mail uses: tap a PDF and it
//  previews, with Share and "Open in…" already attached. It needs a delegate to
//  say which view controller it should present from, which is the whole reason
//  this file has a class in it rather than one function.
//
//  Called from Rust (`attachment.rs`), which is the opposite direction to
//  `PigeonBackground` — `@_cdecl` is what makes the symbol plain C so `extern
//  "C"` on the Rust side can find it.

import UIKit

@objc(PigeonFiles) final class PigeonFiles: NSObject, UIDocumentInteractionControllerDelegate {
    /*
     * The controller is retained here on purpose.
     *
     * `UIDocumentInteractionController` does not retain itself while it is
     * presenting, and the delegate reference is unowned — let both go out of
     * scope at the end of `present` and the preview is dismissed before it has
     * finished appearing, which reads as the tap having done nothing. Exactly
     * the symptom this file exists to fix.
     */
    private static var current: UIDocumentInteractionController?
    private static let shared = PigeonFiles()

    static func present(path: String) {
        guard let root = keyViewController() else { return }

        let controller = UIDocumentInteractionController(url: URL(fileURLWithPath: path))
        controller.delegate = shared
        current = controller

        // Preview if iOS knows the type, and fall back to the "Open in…" menu
        // when it does not — an attachment it cannot render is still one you
        // may want to send somewhere that can.
        if !controller.presentPreview(animated: true) {
            controller.presentOptionsMenu(from: root.view.bounds, in: root.view, animated: true)
        }
    }

    /// The controller a preview should be pushed on top of.
    ///
    /// Walks past anything already presented — the composer sheet, the
    /// assistant — because presenting from a controller that is itself covered
    /// silently does nothing.
    private static func keyViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }

        var controller = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
        while let presented = controller?.presentedViewController {
            controller = presented
        }
        return controller
    }

    func documentInteractionControllerViewControllerForPreview(
        _ controller: UIDocumentInteractionController
    ) -> UIViewController {
        PigeonFiles.keyViewController() ?? UIViewController()
    }

    func documentInteractionControllerDidEndPreview(_ controller: UIDocumentInteractionController) {
        // Released only once the preview is gone, so the retention above lasts
        // exactly as long as it needs to.
        PigeonFiles.current = nil
    }
}

/// The symbol `attachment.rs` calls.
///
/// Hops to the main queue because it touches UIKit and arrives on whichever
/// thread Tauri ran the command on, and copies the path before returning
/// because the Rust side owns that memory only for the length of the call.
@_cdecl("pigeon_present_file")
func pigeonPresentFile(_ path: UnsafePointer<CChar>) {
    let copied = String(cString: path)
    DispatchQueue.main.async { PigeonFiles.present(path: copied) }
}
