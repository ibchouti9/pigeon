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
| Gmail provider (auth, MIME, REST) | done and unit-tested against a stubbed transport; **never run against a real account** |
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

§8.5 has ten items, not twelve.

1. Empty, loading and error states — reachable at **`/dev/states`**, which swaps
   the mail provider for one of six scenarios and opens a real route, so each
   state is reached through the screen's own code. Now also covers the
   held-message sheet, the composer's own five states and C-27's connection
   pill. Dev builds only; it tree-shakes out of production. The offline banner
   is the one exclusion — it follows the browser, not the provider.
2. Focus ring on `:focus-visible` only — one rule in `base.css`, never
   overridden. The "never on mouse click" half rests on the browser's own
   `:focus-visible` heuristics and is not separately asserted.
3. Keyboard-only operation — driven end to end in the browser for approve,
   reply-with-draft (`j` → `o` → `r` → type → ⌘Enter) and reverse.
4. Contrast — the token block is §4.3 verbatim, so §8.3's table holds by
   construction, plus one pairing the table omits, fixed on filled rows.
   **Not independently re-measured.**
5. `prefers-reduced-motion` — every keyframe that moves a transform ships a
   fade-only fallback, enforced by `src/test/motion.test.ts`. The composer's
   max-height expansion is the one animation outside that rule.
6. Every AI string carries its label and hidden prefix — the reader, the
   Screener card, the composer and the bulk row.
7. No banned words or exclamation marks — enforced by `src/test/copy.test.ts`.
8. Undo or confirm, never neither — D11's two dialogs plus 8s undo elsewhere,
   and a burst of undos no longer evicts the earlier ones from the store.
9. Usable at 720px, no horizontal scroll to 2560px — verified at 720, 820, 900,
   1280, 1440, 2560 after fixing the breakpoint bug below.
10. No text below 11px — measured in the running app, including the bulk
    postmark, which is computed in JS and so invisible to the type-floor test.

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
- **A revoked token was reported as a connection error.** The screens
  implemented §5.5's token-revoked state, but every catch block in the store
  discarded the error, so `MailError.code === 'revoked'` never reached the UI.
  A user whose permission Google had withdrawn saw "Pigeon can't reach Gmail"
  and could retry forever with no possibility of success.

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
- **Attachments went nowhere.** The composer collected files and the provider
  signature accepted them, but neither `send()` call site passed them along.
  The chip appeared; the file never left.
- **Offline controls looked live.** They are marked with `aria-disabled` so they
  keep their tab stop (§5.4, §5.6), and every stylesheet matched only
  `:disabled` — so reply, forward, archive and the rest rendered at full opacity
  with a pointer cursor, and a click did nothing with no explanation.
- **A partial bulk failure tore down the list.** Every row leaves optimistically,
  so `held` reads zero for the whole round-trip; the route rendered the empty
  state, which unmounted the list and threw away §3.3-3b's failed rows, their
  retries and the selection. At twelve senders it jumped to Stack as well.
- **⌘A approved the top Screener sender** and ⌘D declined it — the handlers
  switched on `e.key` with no modifier check.
- **⌘Z re-ran whatever had just failed**, because it took the newest toast
  carrying any action and error toasts always carry [Try again].
- **Single-key shortcuts fired through open modals** — `c` opened a composer
  behind a dialog, `e` archived a row hidden by the shortcuts sheet.
- **Search results were keyboard-unreachable past row one.** The cursor was a
  frozen `useState(0)` feeding a roving tabindex, with no key handler at all.
- **The Gmail provider was unreachable from the UI.** "Connect Gmail" called
  `loadAccount()` on whatever provider the store held; `signIn()` and
  `GmailMailProvider` were referenced from nothing outside their own modules.
- **The bulk keyboard cursor was invisible** — it shared hover's fill, so it
  vanished the moment the pointer entered the list.
- **Bulk review showed the AI read on four rows at most** — a lookahead sized
  for the stack, on a screen that shows every row at once.
- **Undo left the card where the date sort put it** rather than returning it to
  the top of the stack (§3.2 3c).
- **A quiet account approved nobody.** §3.1 3c skips O4 and seeds known senders
  from Contacts; skipping the screen skipped the seeding too.
- **Background sync finished invisibly** — §3.1 3a's rail progress line had
  nothing subscribed to it.
- **A held search result froze the keyboard.** The held-message sheet was
  mounted by the Screener alone, so clicking a held result set the open-sheet
  state with nothing to render it — and an open sheet blocks every single-key
  shortcut, so the whole app went dead until Esc.
- **Bulk archive lost most of its own undos.** The toast store capped itself at
  the three *visible* toasts and dropped the rest with their handlers.
- **Opening a search result destroyed the search.** `/search/t/:id` dropped the
  query string, so the query cleared and every result vanished.
- **`r` opened a reply and left focus on the thread row**, so everything typed
  after it went nowhere (§3.4 step 3).
- **Undoing a sent inline reply threw the draft away** instead of restoring the
  composer with it (§3.4 step 6).
- **Send-blocked helper text was suppressed** whenever no AI provider was
  connected — offline, Send was greyed with no explanation.
- **C-28's tooltips were unreachable.** They hung off `disabled` buttons, which
  take no focus and dispatch no pointer events, so the only text explaining why
  a control was off could not be reached at all.
- **A revoked token didn't lock the shell** (§5.5) — the reader sat beside the
  error offering "Select a thread to read it.", and every route stayed live.
- **The `[confirm: …]` chip was misaligned.** It set `--font-mono` on the
  transparent mirror while the textarea above stayed in `--font-body`, so the
  tint box was 260px against the text's 201px and the rest of the line drifted.
- **Search results never marked the matched terms** (§5.11); only the held rows
  did.
- **"Test connection" opened the provider form** instead of testing anything.
- **One Esc closed two layers** — the global handler minimized the composer and
  the list then cleared its selection on the same press.
- **Enter in the subject line sent the message.** A single text input in a form
  means the browser submits it, and §5.12 binds send to ⌘Enter — so leaving the
  subject line sent the mail, with only the 8s undo to catch it.
- **A rejected key showed a green "Connected" pill.** §5.13c specifies three
  states; one was built, gated on whether a key string existed rather than on
  whether it worked. The test result was in the store and nothing read it.
- **The inline composer was crushed to 2px** on any thread long enough to
  overflow the reader — a scrolling flex column shrinks its children before it
  scrolls.
- **The bulk stamp rendered "RETURNED" at 4.6px** (§4.2 sizes postmark text at
  `S * 0.115` and the call passed `S = 40`), under §8.5's 11px floor.
- **The bulk row's AI read had no hidden prefix**, so the row's accessible name
  ran the AI sentence straight on from the subject — §8.5 item 6.
- **The card rise was never seen.** The depart waits out the stamp with a 260ms
  delay; the rise had none, so it played underneath the departing card.
- **The arrival ring never expired** — §4.2 gives it 24 hours; it was keyed on
  the presence of an approval date.
- **Deep-linking to a held message showed a false error** while the held list
  was still loading, and the sheet's error state dropped the decision buttons
  §5.9 says stay enabled.
- **The demo assistant's tone buttons did nothing** — its retone echoed the
  draft back unchanged, so §3.4 4a was unobservable on the only provider that
  runs without a key.

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
5. **One-phase Stack⇄Bulk crossfade** — §4.6 describes a two-phase transition
   (outgoing view fades, then the incoming one). Running both phases means
   keeping both views mounted through the overlap, which duplicates their
   keyboard handlers and gives the Screener two live cursors. The single fade
   is the same duration and reads the same; correctness beat the extra phase.
6. **No `reconnecting` state on the offline banner** — C-26 lists
   hidden · visible · reconnecting. A browser reports `online` and `offline`
   and nothing in between, so there is no signal a "Reconnecting…" state could
   be driven from without inventing one. Reconnection shows §7.5's
   "Back online." toast instead.
7. **The `[confirm: …]` chip is not in `--font-mono`** — C-18 asks for it, but
   the chip is a run in a transparent mirror that has to line up character for
   character with a textarea, and a textarea renders one font throughout. It
   keeps the destructive tint and border; the text stays in the body face. Same
   root cause as deviation 2.
8. **Settings sender empty states have no headline** — §7.4 splits headline from
   body ("No approved senders yet." + the rest), while §3.6 and §5.13c give the
   same copy as one run-on string. The implementation follows §3.6/§5.13c.
9. **Bulk rows omit the sender's address** — §3.3 lists it in the row; §5.8's
   column spec for the same rows does not. The implementation follows §5.8.
10. **The toast stack puts the newest at the bottom** — §5.14 says "newest on
    top", which for a bottom-anchored stack reads either as z-order (moot, they
    do not overlap) or as position. Newest nearest the corner it grows from is
    the reading that keeps a toast from jumping as the next one arrives.
11. **The API key is fully masked, not "masked to the last 4 characters"** —
    §5.2 asks for both that and `type="password"`, and a password field cannot
    reveal its last four. The 10-second "Show" reveal is the escape hatch.
12. **The compact rail uses `title`, not the 400ms C-25 tooltip** — C-19 asks
    for the tooltip, §5.0 says "labels become `title` + `aria-label`" for this
    exact case. The code follows §5.0; §8.4's "no control relies on `title`
    alone" holds either way.
13. **No blocked-images state for C-8** — the component specifies a placeholder
   for images suppressed until a sender is approved. Message bodies render as
   plain text everywhere in this build (the Gmail parser walks the MIME tree
   for `text/plain` and falls back to stripping HTML), so no remote image is
   ever requested and the state is unreachable. §5.9's copy about blocked
   images still holds — it just describes a property the renderer has by
   construction rather than one a placeholder announces.

## Where to look next

In rough order of expected value:

1. First real Gmail run. O1 now opens Google consent and swaps in
   `GmailMailProvider` when `VITE_GOOGLE_CLIENT_ID` is set, but no run against a
   real mailbox has happened. This is the only part of the product that has
   never executed.
2. Drive more of the running app. Most of the bugs above were found this way and
   none of them by any static check. Still undriven: Gmail's own error states,
   O4 at 342 rows, the reader at a very long thread.
3. The audit findings still open, listed below.

## Open items

- The Gmail path has never run against a real account. It needs a Google OAuth
  client ID in `.env.local` (see the README) and a careful first run. Everything
  above it is wired: consent, provider swap, token restore on reload, and
  sign-out clearing the token.
- **"Start sync again" restarts from zero** despite §3.1 3b's copy promising to
  "pick up where it stopped". Gmail's list endpoint is walked without a stored
  page token, so resumption needs a cursor the sync layer does not keep.
- Toast copy for two of the three Assistant toggles is extrapolated; §7.5 spells
  out only the summaries one. So are the bulk-archive and appearance toasts —
  §7.5 has no row for either, and both follow the shape of the bulk sender lines
  beside them.
- Four places where the spec contradicts itself, resolved and recorded rather
  than silently picked: the minimized dock's height (§3.5 says 40px, §5.12 says
  44px — 44 wins, it is the later and more detailed passage); list section and
  postmark type (`--mono-xs` is 10px, below §8.5's 11px floor — the floor wins,
  enforced by `src/test/typeFloor.test.ts`); Settings sub-nav (§2.2 lists About,
  §7.1 does not — it is built); and the approve/decline failure copy, where §3.6
  and §7.6 differ and the implementation uses each on its own path.
- Received attachments render as chips but have no download action — there is
  no file backend behind the demo account. Attaching on compose works end to
  end (D20): the composer holds files in memory and the Gmail client sends them
  as `multipart/mixed`.

## Notes

- npm's global cache has root-owned files on this machine, so `.npmrc` pins a
  project-local cache. Both are gitignored.
- The demo account persists to `localStorage` under `pigeon.demo`; provider
  settings under `pigeon.provider` (D42); Google's access token lives in
  `sessionStorage` and is never persisted.
