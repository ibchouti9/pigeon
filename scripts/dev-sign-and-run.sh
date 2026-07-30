#!/bin/sh
# Cargo runner for macOS dev builds: sign, then run.
#
# macOS decides whether an app may read a Keychain item by its code signature,
# not its path. An unsigned binary has no stable identity, so every `cargo
# build` produces something the Keychain has never seen — which is why "Always
# Allow" does not stick in development and the password prompt comes back on
# every restart. It was answering honestly: that really was a different
# program each time.
#
# Signing with a real certificate gives the binary a designated requirement
# that survives rebuilds, so one "Always Allow" holds for good. Ad-hoc signing
# (`--sign -`) does not help: its requirement is the hash of the binary, which
# is the thing that keeps changing.
#
# Any Apple Development certificate will do — it is never shipped and never
# verified by anyone. Set PIGEON_SIGN_IDENTITY to choose one; otherwise the
# first in the login Keychain is used. With no certificate at all this is a
# no-op and the build runs exactly as before, prompts and all, so a clone
# without Xcode is unaffected.

set -e

binary="$1"
shift

identity="${PIGEON_SIGN_IDENTITY:-$(
  security find-identity -v -p codesigning 2>/dev/null |
    grep -m1 'Apple Development' |
    sed -n 's/.*"\(.*\)".*/\1/p'
)}"

if [ -n "$identity" ]; then
  # --force replaces the signature the last build left behind. Failure is not
  # fatal: an unsigned run still works, it just asks for the password again.
  codesign --force --sign "$identity" "$binary" 2>/dev/null ||
    echo "note: could not sign $binary — the Keychain will ask for a password" >&2
fi

exec "$binary" "$@"
