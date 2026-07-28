#include "bindings/bindings.h"

#import <Foundation/Foundation.h>

/*
 * `PigeonBackground`, declared by hand rather than imported.
 *
 * The usual route is `#import "pigeon_iOS-Swift.h"`, the header Xcode
 * generates from a target's Swift sources — and this target does not emit one,
 * because Tauri's generated project has no mixed-language build settings and
 * regenerating it would drop any that were added.
 *
 * A forward declaration needs none of that. The Swift class is `@objc` and in
 * this same binary, so the runtime resolves it from the class symbol alone;
 * `@objc(PigeonBackground)` on the Swift side is what pins the name this
 * declaration asks for.
 */
@interface PigeonBackground : NSObject
+ (void)install;
@end

int main(int argc, char * argv[]) {
	// Before `start_app`, because that call runs UIApplicationMain and never
	// returns, and `BGTaskScheduler.register` has to happen before launching
	// finishes. The generated app has no delegate of its own to hook, so this
	// is the only seam there is.
	//
	// Survives `tauri ios init`, which regenerates the project around this
	// file rather than over it — checked by running it, not assumed.
	[PigeonBackground install];

	ffi::start_app();
	return 0;
}
