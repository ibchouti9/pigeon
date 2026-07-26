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
   state is reached through the screen's own code. Covers the held-message
   sheet, the composer's five states, C-27's connection pill, and a switch that
   makes every assistant call fail — the AI failure states were the last ones
   nothing could produce, since the scenarios swap the *mail* provider and no
   assistant that runs without a key ever fails. The full matrix has been
   walked: six scenarios across nine screens, no blank renders, no overflow, no
   uncaught errors. Dev builds only; verified absent from the production bundle.
   The offline banner is the one exclusion — it follows the browser, not the
   provider.
2. Focus ring on `:focus-visible` only — one rule in `base.css`, never
   overridden. The "never on mouse click" half rests on the browser's own
   `:focus-visible` heuristics and is not separately asserted.
3. Keyboard-only operation — driven end to end in the browser for approve,
   reply-with-draft (`j` → `o` → `r` → type → ⌘Enter) and reverse.
4. Contrast — **measured in the running app**, both themes, on all eight
   screens plus the reader with an AI summary and both composers: every text
   node's computed colour against its effective background, at the AA threshold
   its own size and weight call for. Zero failures. Disabled controls are
   excluded, which §8.3 exempts. Two pairings the spec's table omits were found
   and fixed this way.
5. `prefers-reduced-motion` — every keyframe that moves a transform ships a
   fade-only fallback, enforced by `src/test/motion.test.ts`. The composer's
   max-height expansion is the one animation outside that rule.
6. Every AI string carries its label and hidden prefix — the reader, the
   Screener card, the composer and the bulk row.
7. No banned words or exclamation marks — enforced by `src/test/copy.test.ts`,
   and every string §7 specifies verbatim has been compared character for
   character against what the code renders. The wording is faithful throughout;
   the four defects that audit found were all about a correct string reaching
   the wrong place, or nowhere.
8. Undo or confirm, never neither — D11's two dialogs plus 8s undo elsewhere,
   and a burst of undos no longer evicts the earlier ones from the store.
9. Usable at 720px, no horizontal scroll to 2560px — **measured**, not eyeballed:
   `scrollWidth - clientWidth` on every screen at 720, 760, 880, 1079, 1280 and
   2560. Two overflows found and fixed this way, both at breakpoint boundaries.
10. No text below 11px — measured in the running app, including the bulk
    postmark, which is computed in JS and so invisible to the type-floor test.

## Rules with a gate behind them

Six house rules are enforced mechanically rather than by memory, because each
was broken by applying it one file at a time:

- `src/test/copy.test.ts` — §7's banned words and exclamation marks.
- `src/test/motion.test.ts` — every transform animation has a reduced-motion
  fallback (§8.5 item 5).
- `src/test/typeFloor.test.ts` — nothing renders below 11px (§8.5 item 10).
- `src/test/disabledStyling.test.ts` — every `:disabled` rule has an
  `[aria-disabled='true']` twin, since offline controls use the latter.
- `src/test/skeletonMinimum.test.ts` — C-21's 200ms minimum, everywhere.
- `src/test/unusedExports.test.ts` — no exported value goes unreferenced, since
  an unused export beside a live inline copy of the same rule is where the two
  stop agreeing. It has caught three.

## Keeping the two providers honest

`src/data/__tests__/providerContract.test.ts` runs the same assertions against
`MockMailProvider` and `GmailMailProvider`. The UI is written against the
interface, so where they disagree, testing on the demo account stops predicting
what the product does — which had already happened once. Anything one provider
does that the other doesn't belongs in that file or in neither.

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
- **The attachment chip said "Download" and had no handler** — an affordance
  that told the user it would work and didn't.
- **"Start sync again" re-fetched everything** it had already hydrated, so a
  retry was exactly as slow as the first run and §3.1 3b's "Pigeon will pick up
  where it stopped" was false.
- **Two AA contrast failures in light theme**, both on pairings §8.3's table
  doesn't cover: the rail count on a selected item (4.24:1) and Settings'
  "Stored in this browser only" note (3.43:1).
- **Route-change focus fired on sub-routes**, so opening a thread yanked focus
  off the row the user had just opened.
- **The held sheet showed "This message didn't load." over the user's own
  approve.** `decide` removes the sender optimistically, so the entry vanished
  for the whole round-trip; the buttons rendered in that state called `decide`
  on a sender no longer held and silently did nothing.
- **Search's "Try again" could never retry** — it re-set the query to a trimmed
  copy of itself, and the debounce trims before searching, so React bailed out.
- **A failed send's banner outlived its draft**, appearing on the next composer
  about a message the user had never tried to send.
- **`decideMany` had no `providerEpoch` guard** and re-read the provider each
  iteration, so a swap mid-batch would split the decisions across two accounts.
- **A search at 720px scrolled the page sideways by 537px**, and at exactly
  880px the reader's 480px floor overflowed the remainder by 37px.
- **Two screens stated what they didn't know**: Settings → Senders rendered
  "Approved (0)" while the list was loading or after it failed, and Search put
  "Search didn't run." in the meta line as well as the error block.
- **Two of §2.2's URL parameters weren't implemented** — the senders tab and
  `?compose=1` — so a reload or a shared link always landed somewhere else.
- **§7.6's rate-limit line never reached a surface.** All three remote adapters
  throw it; every consumer discarded the error, so the one failure that fixes
  itself read exactly like a hard one.
- **The four provider-test errors offered the wrong action** ("Change" instead
  of §7.6's "Test connection"), and the network branch offered none at all.
- **The composer carried the Summarize control's tooltip** as well as its own
  helper text, saying the same thing twice in two different wordings (C-28).
- **"1 senders"** in §7.3's first-run toast.
- **A real mailbox would have shown only its first 100 threads.** The thread
  walk asked for one page and stopped, silently — against D34, whose sync
  counter reports totals in the thousands, and D38's "capped at no page size".
- **Search reported the size of its page, not of its answer** — one page of 50,
  so §5.11's meta line said "50 results" for a query matching five hundred. It
  also fired one thread fetch per result at once, which the main walk batches at
  ten specifically to avoid.
- **The shell's three mount loads each started their own inbox walk**, tripling
  the requests on a first run — as did the known-sender build, which is the
  most expensive thing the client does.
- **The sent-mail scan fired a metadata request per message at once**, up to a
  hundred concurrently, during onboarding.
- **Every reply would have started a new thread.** Gmail threads on In-Reply-To
  and References as well as threadId; neither was set, and the Message-ID they
  are built from was parsed and discarded.
- **A throttle read as "Google revoked Pigeon's permission."** Gmail returns
  rate limits as 429 and as 403 with a rateLimitExceeded reason, and both landed
  in the auth branch — so the likeliest failure of a first sync told the user to
  reconnect, which is the one thing that would not have helped.
- **Declining a sender did nothing in Gmail.** It installed a filter, which
  needs a fifth scope §3.1's consent copy rules out; every call 403'd silently
  while Pigeon reported success.
- **"Whitlock, Dana" became two recipients** — a display name was emitted
  unquoted — and a non-ASCII attachment filename put raw 8-bit octets in a
  header.
- **A lapsed token opened ten Google windows**, nine of which the browser
  blocks, and a blocked window was reported as the user refusing consent.
- **The scope check could reject a good grant** — Google normalises
  `userinfo.email` to `email` in the response, and the code compared strings.
- **The user's own alias-sent mail put them in their own Screener.**
- **The sync bar counted the whole mailbox**, so it sat near 1% throughout.
- **A contacts failure could never reach the screen built to explain it.** §7.6
  has the row and O4 has the state; the provider swallowed the error, so O4 said
  "Pigeon didn't find anyone to propose" while the inbox looked empty and the
  Screener held hundreds. Enabling the People API is a separate console step
  from enabling the Gmail API, so this is a likely first run.
- **The shared walk kept only the first caller's progress callback**, so §5.2b's
  counter could sit still for the whole sync.
- **Every non-UTF-8 message would have rendered as replacement characters** —
  the decoder ignored the part's own charset.
- **The attribution line leaked into the body of most threaded replies** — Gmail
  wraps it and the splitter wanted it on one line.
- Four smaller ones: the body's own newlines went out without CRLF, the
  HTML-escaped snippet was rendered raw, the Screener sorted by each sender's
  oldest held message, and the archive query excluded the wrong things.
- **The thread list rendered every row it had.** Measured on a 2,000-thread
  inbox — the ceiling the Gmail walk now uses — that was 43,411 DOM nodes, 299ms
  to move the cursor one row and 180ms to tick a checkbox, on the most-used key
  in the product. Now 556 nodes, 27ms and 18ms. Caused by lifting the walk's
  ceiling earlier the same night.
- **Four surfaces described the symptom rather than the cause.** Each catch
  discarded the `MailError` and hardcoded one §7.6 line, so a revoked token was
  reported as a rejected message, a failed contacts read, or an attachment that
  wouldn't download — telling the user to fix something that wasn't wrong. Two
  of the four only became wrong when the provider started distinguishing the
  cases earlier the same day.
- **Four skeletons never got C-21's 200ms minimum** — including the Screener
  card, the largest one in the product. `src/test/skeletonMinimum.test.ts` now
  fails if a component renders a skeleton without the hook, or exempts one
  without a reason.
- **Two fixes that stopped one layer short of the user.** The Screener ordering
  was corrected in the Gmail provider and left wrong in the demo — so the fix
  landed only on the path nobody can run, and every screenshot would have shown
  a different order from the product. The send-error work made the provider
  distinguish a revoked token from a rejected message, and both call sites went
  on hardcoding "check the recipient addresses" in their catch. Both found by
  going back over the same day's work rather than by any test.
- **A reader URL for a thread the list didn't hold was a dead end.** The reader
  resolved the open thread out of the loaded list alone, so a bookmark, a shared
  link, or on a real account any thread past the walk's 2,000-thread ceiling hit
  §5.6's "This thread didn't load" with a "Try again" that reloads the same list
  and still won't contain it. `getThread` was on both providers, covered by the
  contract test, and called by nothing — it is now what fills that gap. Search
  had always fallen back to its own results, which is why it never surfaced
  there. Found by asking why a contract method had no callers.
- **A guard that could never fire.** The single-thread fetch was written with
  both an effect cleanup and a `providerEpoch` check, matching the store's
  house style. Mutation-testing showed each passed the suite alone, and reading
  it through showed why: `setProvider` resets the place's status, which tears
  the effect down, so the epoch could never differ by the time the check ran.
  Removed rather than left as untested, unreachable code.
- **Two more copies of a rule that had drifted, found the same way.** Sweeping
  for exported symbols nothing references turned up C-4 Badge and
  `sendBlockedReason`, both unused while a screen reimplemented them inline.
  C-4 and the rail disagreed about truncating a count above 99; the store's send
  rule and the Composer's disagreed about an empty To. In both cases the live
  copy was the correct one, so C-4 was corrected and adopted, and the dead send
  rule deleted. The lesson is the sweep itself: an unused export beside a live
  inline copy of the same rule is where the two quietly stop agreeing — it is
  now a gate, `src/test/unusedExports.test.ts`, which found a third case on its
  first run: C-27's endpoint hostnames, listed in `ai/client` and copied
  privately into Settings.
- **The dead copy was right about one thing.** That endpoint table had an answer
  for the demo provider and the live one didn't, so §5.13c's Endpoint row
  rendered its label with nothing beside it — missing data rather than "this one
  reaches nothing". The same drift, found from the other side while deleting it.
- **The rail's search field discarded the search.** §2.2 spells the URL
  `/search?q=…&held=0|1`; the field read neither half. Landing on one left it
  empty beside a full page of results, and since every keystroke navigates,
  typing one character replaced the query and dropped `held` with it — "Also
  search held mail" turned itself off and the results changed underneath, with
  nothing touched but the words. Found by driving §5.11 at 364 results, which
  first needed the crowded scenario to search the crowd rather than the seed.
- **§5.11's two keyboard sentences didn't compose.** "`/` focuses the field from
  anywhere" and "`↓` from the field moves the cursor into results" only work
  together, and `/` always went to the rail's field while `↓` was wired to
  Search's own query bar. The field took focus and `↓` did nothing. `/` now goes
  to the query bar when a screen has one.
- **A measurement that measured nothing.** The first pass at timing the search
  cursor reported a clean 60fps; the keys were never reaching the handler,
  because §5.11 moves the cursor only from the field and focus was elsewhere.
  Two harness key names — `Return` and `Down` — also arrive as an empty string
  and silently do nothing, which is what made an earlier "Enter doesn't open a
  thread" look like a product bug. Check that an input actually changed
  something before recording what it cost.

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
13. **The action-row note is tertiary ink, not disabled ink** — §5.13c line 1367
    asks for `--color-text-disabled`, but §8.3 marks that token "exempt
    (disabled)" at 3.2:1 and this is live informational copy. Measured 3.43:1;
    §8.5's contrast floor wins, as it does over `--mono-xs`'s 10px.
14. **No blocked-images state for C-8** — the component specifies a placeholder
   for images suppressed until a sender is approved. Message bodies render as
   plain text everywhere in this build (the Gmail parser walks the MIME tree
   for `text/plain` and falls back to stripping HTML), so no remote image is
   ever requested and the state is unreachable. §5.9's copy about blocked
   images still holds — it just describes a property the renderer has by
   construction rather than one a placeholder announces.
15. **The reader opens a long thread at the first expanded message** — §5.6
   fixes which messages collapse but not where the pane starts. Its own example
   thread has four messages, so the question never comes up; at forty, its rule
   collapses the first thirty-four and the pane opened on 1,088px of history
   above the first thing anyone came to read. The pane now scrolls to the first
   expanded message, leaving one collapsed row visible so the history above
   doesn't disappear. A short thread is untouched and still opens on the summary
   block. Found by driving `?scenario=crowded`.

## Where to look next

In rough order of expected value:

1. First real Gmail run. O1 now opens Google consent and swaps in
   `GmailMailProvider` when `VITE_GOOGLE_CLIENT_ID` is set, but no run against a
   real mailbox has happened. This is the only part of the product that has
   never executed.
2. Drive more of the running app. Most of the bugs above were found this way and
   none of them by any static check. `?scenario=crowded` now reaches the states
   that used to need hand-edited localStorage. Still undriven: Gmail's own error
   states, which need a real account.
3. The audit findings still open, listed below.

## Driven at scale

`?scenario=crowded` amplifies the demo seed to 800 threads, 120 held senders and
40 messages a thread. What it found is above (the reader's start position); what
it confirmed:

- **Thread list, 800 threads.** 499 DOM nodes. `j` to row 240 keeps the cursor
  on screen and the node count flat — the windowing and its scroll-by-arithmetic
  both hold when the target row isn't mounted.
- **Reader, 40 messages.** 6 expanded, 34 collapsed: exactly §5.6's rule, the
  last 8 minus the two the user sent that have later messages after them.
- **Screener, 120 senders.** Decisions apply and the counter tracks. The digest
  keeps its own count — it is the week's summary, not a live counter, and the
  live one sits under the stack.
- **O4, 342 senders.** Already the seeded scale, so it needed no amplification:
  175 nodes, 16 windowed rows, no horizontal overflow, filter narrowing right.
- **Search, 364 results.** 7,966 nodes and no horizontal overflow. Unwindowed,
  and the largest unwindowed list in the product — ahead of bulk review's 4,127
  at 400 senders. Its cursor has not been timed: the first attempt measured a
  steady 60fps while the keys were in fact going nowhere, so that number was
  wrong and is not recorded. Worth measuring properly, alongside the bulk-review
  windowing already deferred below.
- **All nine routes walked at this scale** with no uncaught error, no blank
  screen and no horizontal overflow at 1280px.

## Measured and deliberately not done

**Bulk review is not windowed.** At 400 held senders it renders 4,127 nodes and
takes 120ms to move the cursor — noticeable, and worth fixing eventually, but
not the 299ms the thread list was. At 120 held senders, which is a heavy week
rather than a pathological one, it renders 1,327 nodes and holds a steady 60fps
under `j` (median 16.7ms a frame, worst 18.7ms over 88 frames). The list scrolls inside the Screener's
region together with the digest block above it, whose height varies with its
own state, so windowing means measuring against a variable-height sibling
rather than a self-contained scroller. That is a real change to how the screen
scrolls, and the failure mode — rows not rendering where they are expected — is
user-visible. Worth doing deliberately rather than at the end of a long session.
`groupedWindow` and `useVirtualRows` are both there when it is.

## Open items

- The thread list fills in as it loads rather than after the whole walk, so the
  Archive is usable within a second of opening it instead of after a walk that a
  throttled 2,000-thread mailbox can stretch to thirteen minutes. Two things
  that are easy to get wrong and are tested: partial pages go through the same
  §2.3 filter as the final list, and an *empty* page never publishes — §2.3 can
  filter an early page down to nothing, and going `ready` on it would flash
  "you're all caught up" before the inbox fills in behind it.
- The Gmail path has never run against a real account. It needs a Google OAuth
  client ID in `.env.local` (see the README) and a careful first run. Everything
  above it is wired: consent, provider swap, token restore on reload, and
  sign-out clearing the token. The thread walk paginates to a 2,000-thread
  ceiling per place — high enough that a working inbox is complete, since the
  Screener is what stops it growing without bound, and low enough that a first
  run on a decade-old archive cannot spend someone's whole API quota. Thread
  bodies are cached against Gmail's `historyId`, so a body is fetched once and
  then only again when it has actually changed.
- **Gmail cannot recall a sent message, so §3.4's undo cannot un-send one.**
  D8 forbids trashing it, and Gmail's own Undo Send works because Google's
  servers hold the message — a browser client has nowhere to hold it. Pigeon
  could delay the send for the eight-second window, which would make the promise
  true, but then closing the tab inside those eight seconds loses the mail
  silently. That trade is a product decision, not a bug fix: **worth deciding
  before the first real run.** Everything else about the undo works; on the demo
  account it un-appends correctly.
- Toast copy for two of the three Assistant toggles is extrapolated; §7.5 spells
  out only the summaries one. So are the bulk-archive and appearance toasts —
  §7.5 has no row for either, and both follow the shape of the bulk sender lines
  beside them.
- `?held=0` is deleted from the search URL rather than written as `0`. §2.2
  spells the parameter `held=0|1`; the two are equivalent to read and the
  shorter URL is the one worth sharing.
- **C-4's `99+` applies to the ring, not the plain count.** §6 puts "values above
  99 render `99+`" at the end of the `ring` line, and the reason is geometric:
  the ring is a fixed 24px circle. The plain variant is free-width text that §6
  asks for *tabular figures* on, which only matters for lining up multi-digit
  numbers. Read the other way, an inbox at 1,247 unread would say "99+" for no
  reason.
- Four places where the spec contradicts itself, resolved and recorded rather
  than silently picked: the minimized dock's height (§3.5 says 40px, §5.12 says
  44px — 44 wins, it is the later and more detailed passage); list section and
  postmark type (`--mono-xs` is 10px, below §8.5's 11px floor — the floor wins,
  enforced by `src/test/typeFloor.test.ts`); Settings sub-nav (§2.2 lists About,
  §7.1 does not — it is built); and the approve/decline failure copy, where §3.6
  and §7.6 differ and the implementation uses each on its own path.
- D20 is complete in both directions: the composer attaches up to 25 MB and the
  Gmail client sends them as `multipart/mixed`; the chip on a received message
  downloads the real bytes from `messages.attachments.get`. The demo account has
  no file store, so it hands back a note saying so rather than failing.

## Notes

- npm's global cache has root-owned files on this machine, so `.npmrc` pins a
  project-local cache. Both are gitignored.
- The demo account persists to `localStorage` under `pigeon.demo`; provider
  settings under `pigeon.provider` (D42); Google's access token lives in
  `sessionStorage` and is never persisted.
