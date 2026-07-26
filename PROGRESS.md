# Pigeon MVP — build progress

Source of truth: [docs/design/SPEC.md](docs/design/SPEC.md). Every value there is final.

Run `npm run check` (typecheck + lint + test) before every commit.

## Stack

Vite · React 19 · TypeScript · react-router-dom · zustand · CSS Modules over the
token block from §4.3. Vitest + Testing Library. No CSS framework — the spec is a
token system, not a utility system.

## Architecture

- `src/types` — domain model shared by every provider.
- `src/data/provider.ts` — the `MailProvider` interface.
  - `src/data/mock/` — the seeded demo account (works with no credentials).
  - `src/data/gmail/` — the real Gmail REST client.
- `src/ai/` — `AiClient` interface, one adapter per provider (D41), the §7.9
  prompts, and the hooks that wire it into the reader and the Screener.
- `src/store/` — zustand stores: `mail`, `settings`, `compose`, `toast`, `ui`.
- `src/components/primitives/` — C-1…C-28 from §6.
- `src/routes/` — one file per screen in §5.

## Status

Every screen in §5 is built and runs against the demo account.

| Area | State |
|---|---|
| Design tokens (§4.3), base styles, focus (§8.2) | done |
| Domain types + `MailProvider` | done |
| Mock provider + demo seed | done, tested |
| Gmail provider (auth, MIME, REST) | done, **never run against a real account** |
| Stores | done, tested |
| Primitives C-1…C-28 | done |
| App shell, nav rail, global shortcuts | done |
| AI layer: 4 adapters + demo, prompts, hooks | done, tested |
| O1–O5 onboarding (§5.1–5.4) | done |
| Inbox + thread reader (§5.5–5.6) | done |
| Screener stack / bulk / sheet (§5.7–5.9) | done |
| Archive (§5.10) | done |
| Search (§5.11) | done |
| Composer, inline and docked (§5.12) | done |
| Settings (§5.13) | done |

## Quality floor (§8.5), verified in the running app

1. Empty, loading and error states — reachable at **`/dev/states`**, which swaps
   the mail provider for one of six scenarios and opens a real route, so each
   state is reached through the screen's own code. Dev builds only; it
   tree-shakes out of production.
2. Focus ring on `:focus-visible` only — one rule in `base.css`, never overridden.
3. Keyboard-only operation — verified for approve, reply-with-draft and reverse.
4. Contrast — the token block is §4.3 verbatim, so §8.3's table holds by
   construction. **Not independently re-measured.**
5. `prefers-reduced-motion` — token overrides in place. **Not verified in-browser.**
6. Every AI string carries its label and hidden prefix — verified in the reader,
   the Screener card and the composer.
7. No banned words or exclamation marks — enforced by `src/test/copy.test.ts`.
8. Undo or confirm, never neither — D11's two dialogs plus 8s undo elsewhere.
9. Usable at 720px, no horizontal scroll to 2560px — verified at 720, 900, 1440,
   2560 after fixing the breakpoint bug below.
10. No text below 11px — measured in the running app.

## Bugs found and fixed while verifying

Worth keeping: each was invisible to typecheck, lint and tests. Every one was
found by driving the running app, not by reading the code.

- **The Archive never loaded.** The shell fetches the inbox at mount; nothing
  fetched the other places, so `/archive` sat on its loading state forever and
  the whole screen was dead.
- **Two AI surfaces broke C-28.** With no provider the reader rendered an empty
  tinted summary block, and "Summarize thread" was hidden rather than disabled —
  both the exact "a missing key looks like a broken app" outcome D44 forbids.
- **The bulk bar and composer dock still travelled under reduced motion.** The
  global rule in tokens.css constrains transitions; a keyframe animating
  `transform` is not a transition.
- **Tertiary ink on a filled row was 4.24:1** — under AA, and a pairing §8.3's
  "every text pairing" table does not contain.
- **Search's URL updater changed identity every render**, and the debounce
  effect both depended on it and called it.
- **A provider swap didn't cancel in-flight loads.** A load started against the
  old provider applied its result after the new one was installed — so signing
  out of Gmail back to the demo account would drop the previous account's mail
  into the new one's screens.
- **The Screener rebuilt its URL from scratch** in three places, destroying any
  query parameter other than `view`; and its jump-back-to-Stack fired on the
  transient zero-count during a bulk decision, yanking the user out of bulk
  review mid-action.

- **Breakpoint measured from `window.innerWidth`**, which includes the overflow
  the layout itself causes. Self-reinforcing: every viewport from 720–1079 chose
  the desktop three-pane layout and rendered a horizontal scrollbar.
- **Screener reads never reached the cards.** The fetch effect cancelled on every
  dependency change rather than on unmount, so the first read to arrive
  discarded its own in-flight siblings.
- **Thread summaries were unreachable.** The reader took the props; nothing
  supplied them.
- **Replies opened the dock** instead of composing inline (D13/D14).
- **The Screener card never took focus on route entry** — the effect ran while
  the stack was still a skeleton and never ran again.
- **The demo dated today's mail in the future**, so every row read "just now".
- **Sana Sethi was double-booked** — pre-approved in the inbox and held in the
  Screener, so approving her produced a duplicate row.

## Deliberate deviations from the spec

Each is a considered call, not an oversight.

1. **Curated Anthropic models** — §C-27 lists `claude-sonnet-4-5`; the code
   offers `claude-sonnet-5` and `claude-haiku-4-5`. Sonnet 5 is current and 4-5
   is the previous generation; D45's rationale is that the list is updated in
   one place.
2. **Body editor** — C-9 specifies a `contenteditable`. The code uses a
   `<textarea>` with a mirrored highlight layer, which renders `[confirm: …]` as
   a chip while keeping native caret, IME, undo and paste behaviour. A textarea
   already carries the role and `aria-multiline` C-9 asks for.
3. **A `demo` AI provider** — not in the spec. Canned assistant output so every
   AI surface can be run without a key, labelled as a demo wherever it appears.
   Choosing "none" still exercises C-28.
4. **Sender decisions in `localStorage`** — the Gmail provider keeps decisions
   per account in the browser. A Gmail label cannot express "this address may
   reach me" for mail that has not arrived yet, and D41 rules out a server.
   They do not follow the user across devices.

## Where to look next

In rough order of expected value:

1. Drive more of the running app. Eight of the bugs above were found this way
   and none of them by any static check. Untested paths: the offline banner and
   the disabled controls behind it, Gmail's error states, O4 at 342 rows, the
   partial-failure bulk retry.
2. First real Gmail run, once an OAuth client exists. This is the only part of
   the product that has never executed.
3. Work through whatever the spec-conformance and bug-hunt audits turn up.

## Open items

- The Gmail path has never run against a real account. It needs a Google OAuth
  client ID in `.env.local` (see the README) and a careful first run.
- Toast copy for two of the three Assistant toggles is extrapolated; §7.5 spells
  out only the summaries one.
- No dev harness for reaching every empty/loading/error state (§8.5 item 1).
- Attachments render as chips but have no download action — there is no file
  backend behind the demo account.

## Notes

- npm's global cache has root-owned files on this machine, so `.npmrc` pins a
  project-local cache. Both are gitignored.
- The demo account persists to `localStorage` under `pigeon.demo`; provider
  settings under `pigeon.provider` (D42); Google's access token lives in
  `sessionStorage` and is never persisted.
