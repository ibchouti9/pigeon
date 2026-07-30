# Pigeon — MVP Design Specification

**Version 1.0 · Build spec for implementation · Desktop-first web client**

This document is the complete and only source of truth for the Pigeon MVP. Every value here is final. Where the brief was open, the decision is made and logged in §1. Nothing in this document is optional unless it says "may".

---

## 1. Design decisions log

| # | Decision | Rationale |
|---|---|---|
| D1 | Ship **both light and dark themes**, light is the default; dark follows the OS unless overridden in Settings → Account → Appearance. | Every token pair is specified and contrast-verified in §4 and §8.3, so both can be executed precisely. Professionals working late will not accept a light-only mail client. |
| D2 | The **Screener is a one-card-at-a-time review stack**, not a list. A list ("Bulk review") is a secondary mode. | A list of held mail is just a second inbox — the exact dread the product removes. A stack presents one decision, makes the queue feel finite, and lets a whole week clear with two keys. |
| D3 | **Signature element: the postmark.** A circular ink impression, rotated off-register, stamped onto a sender card at the moment of decision, and retained permanently as that sender's record. | Postal heritage, unmistakably Pigeon, and it makes an abstract permission ("this sender may reach me") into a physical, dated, reversible act. All boldness is spent here; everything else is quiet. |
| D4 | **Three-pane desktop shell** (nav rail · thread list · reading pane). | Generic, and deliberately so: the target user already reads mail this way, and calm comes from familiarity in the inbox and novelty only where the product is actually new (the Screener). Logged because it is the one conventional choice in the design. |
| D5 | **Thread summaries are automatic** for threads with **≥ 4 messages or > 1,200 words**; below that, a "Summarize thread" button is shown but nothing is generated until pressed. | Auto-summarizing a two-line thread costs latency and trust for no gain. The thresholds are the point at which scrolling to catch up beats reading. |
| D6 | **Approval is per email address**, never per domain. | Domain approval silently admits everyone at a large company, which breaks the product's promise. Approving five colleagues individually costs ten seconds; being wrong costs the whole premise. |
| D7 | **Declining silences, never deletes.** Declined senders' future mail is archived in Gmail under the label `Pigeon/Declined` and never appears in Pigeon. | Deletion is irreversible and would make the Screener frightening to use. Users can always find the mail in Gmail; Pigeon simply stops showing it. |
| D8 | **No delete or trash anywhere in the MVP.** Archive is the only removal action. | Removes the one irreversible destructive path from the product. Gmail still has a trash for users who want it. |
| D9 | **Undo window is 8 seconds**, offered in a toast on every screening decision, archive, and send. After it lapses, decisions are reversed in Settings → Senders. | Long enough to catch a misfire, short enough that the toast never becomes furniture. |
| D10 | A sender is **unknown** if all three are false: in Google Contacts; has been sent mail by the user in the last 24 months; already on the approved or declined list. | Uses signal Gmail already holds, so day one feels pre-configured rather than empty. |
| D11 | **Confirmation dialogs exist for exactly two actions**: Sign out, and Disconnect Google account. Everything else is undoable and confirms via toast. | Confirmation on undoable actions is friction pretending to be safety. |
| D12 | **Search covers Inbox and Archive by default.** Held mail is excluded, with a "Also search held mail" toggle in the results header that persists for the session. | Search should return the mail you chose to receive. The toggle exists because "I know they emailed me" is a real reason to search the Screener. |
| D13 | **One draft at a time.** Compose is a docked panel, bottom-right, expandable; opening a second compose focuses the existing one. | Multiple floating drafts are Gmail clutter. Replies are composed inline in the thread, not in the dock (D14), so the dock is only for new mail. |
| D14 | **Replies compose inline at the foot of the thread**, in the reading pane. | Keeps the quoted context visible while writing, which is the whole reason to reply from a thread. |
| D15 | **AI drafts are written directly into the reply editor**, rendered in AI ink, and convert to normal ink the moment the user edits any part of them. | "Insert draft?" is an extra decision. Writing it in and letting editing claim authorship is fewer steps and creates the ownership rule in §4.7. |
| D16 | **No sender photos or Gravatars.** Monogram tiles, tinted from a fixed six-tone feather ramp keyed to a hash of the address. | No third-party image fetches, no layout shift, no avatar wall. Calm, and consistent for senders who have no photo. |
| D17 | **Unread is a 6px filled dot plus a 600-weight subject.** Sender name and timestamp stay at normal weight. | Bolding the whole row makes unread mail shout. One dot and one weight change is enough to scan. |
| D18 | **Counts are never red.** Screener count renders as mono numerals inside a postmark ring; Inbox unread count is mono on a quiet surface. | Red badges are an anxiety machine. The product's promise is less. |
| D19 | **Single density.** No comfortable/compact toggle. | Density is a design decision (56px rows, §4.4), not a user setting. A toggle doubles QA surface for a preference most users never open. |
| D20 | **Attachments: receive, preview by filename, download; attach on compose up to 25 MB.** | Not named in scope, but a professional mail client without attachments is not usable. Explicitly not building previews, inline image editing, or Drive integration. |
| D21 | **Offline is read-only with a persistent banner.** Whatever is already loaded stays readable; send, approve, decline, and archive are disabled. No offline cache is built. | Honest degradation beats a queue that silently fails to flush. |
| D22 | **Typefaces: Archivo (display), Public Sans (body/UI), IBM Plex Mono (utility).** All Google Fonts. | Public Sans comes from public-infrastructure design work — civic, plain, extremely legible at 13px. Archivo carries signage weight for the few large moments. IBM Plex Mono gives the postmarks, counts, and timestamps their franking-ink register. |
| D23 | **Palette is cool grey-green paper with a deep teal stamp ink**, no cream, no terracotta, no acid accent, no near-black background in light mode. | Grounded in filtered daylight on a sorting table and the teal-green iridescence of a pigeon's neck, rather than in current design-tool defaults. |
| D24 | **The AI marker is a violet ink plus a mono label**, never a left border stripe on a rounded card. | The left-accent-stripe card is the most-copied AI-product cliché in circulation. Tinted surface plus a named label is quieter and reads at a glance. |
| D25 | **AI content always carries a text label**, not only a color, and screen readers hear "Pigeon summary:" / "Drafted by Pigeon:" prefixes. | Color-only provenance fails for colorblind and screen-reader users, and provenance is a trust requirement, not a decoration. |
| D26 | **Pigeon never writes a commitment the thread does not support.** Dates, prices, and promises the assistant cannot verify are inserted as `[confirm: …]` placeholders, highlighted in the composer, and block send until resolved. | The single largest risk of AI drafting is sending an untrue sentence in the user's name. |
| D27 | **Tone controls are three buttons — Shorter, Friendlier, Firmer — that each regenerate from the current draft**, with one step of undo. No sliders, no free-text prompt box. | Three named transformations are learnable and produce predictable output. A prompt box turns a mail client into a chat app. |
| D28 | **First-run education is one screen, skippable**, shown after the sender confirmation step. | The concept is one sentence long. Anything more is a tutorial the user will click through without reading. |
| D29 | **Keyboard cursor, open thread, and bulk selection are three visually distinct states** on a list row. | Power users navigate with `j`/`k` while a different thread is open. Conflating cursor and selection makes keyboard triage unusable. |
| D30 | **Screener keys are `a` (approve) and `d` (decline); thread keys are `r` / `a` (reply-all) / `f`.** `a` is context-dependent. | The two contexts never coexist on screen, and `a`/`d` are the fastest possible bindings for the product's core action. |
| D31 | **No search of message bodies in the Screener stack view; held mail opens in a sheet over the stack**, not a route change. | Leaving the stack to read one message and coming back loses momentum. |
| D32 | **Timestamps:** today → `2:14 PM`; this calendar year → `Jul 12`; older → `Jul 12, 2025`. Always IBM Plex Mono, tabular figures. | Fixed-width timestamps make a list column scannable without a rule between them. |
| D33 | **Motion is used for exactly four things**: the postmark stamp, card and row departures, toast entry/exit, and panel open/close. No ambient, looping, decorative, or scroll-triggered motion anywhere. | Motion in a mail client is a status report, not a personality. |
| D34 | **Sync progress shows real counts** ("4,312 of 11,908 threads"), never an indeterminate spinner alone. | The initial sync is the longest wait in the product; a spinner with no number reads as broken. |
| D35 | **Errors never contain "sorry", "oops", "something went wrong", or an exclamation mark.** | The product personality is a well-run front desk. A front desk states the problem and the next step. |
| D36 | **Layout maxima:** reading measure caps at 68ch; the thread list is a fixed 380px; the nav rail is a fixed 232px. | Fixed side columns keep the scan position constant between sessions; a capped measure keeps long messages readable on a 27" display. |
| D37 | **Bulk review mode requires no confirmation for bulk decline**, but the toast reports the count and offers undo for all of them as one action. | Bulk decline is the reason bulk mode exists; a modal on it defeats the purpose. Group undo makes it safe. |
| D38 | **The initial known-senders list defaults to all-approved**, with per-row removal and a search field, and is capped at no page size — it is one virtualized scroll list. | Asking a user to opt in 340 senders one at a time on first run is the worst possible first impression. |
| D39 | **AI failures degrade to the underlying content, never to an empty screen.** A failed summary shows a retry line above the still-readable thread; a failed digest shows the plain count. | The assistant is an accelerant, not a dependency. |
| D40 | **Focus ring is the accent teal, 2px, 2px offset**, applied on `:focus-visible` only, and is never removed from any interactive element. | One ring, one color, everywhere, so keyboard position is never ambiguous. |
| D41 | **Pigeon is open source and ships no inference of its own. The user brings their own model** — an API key for Anthropic, OpenAI, or Google, or a local endpoint (Ollama / LM Studio). | There is no Pigeon backend to bill through and no shared key to leak. Bring-your-own-key is the only honest architecture for a self-hostable client, and it is a feature for the target user, not a compromise. |
| D42 | **The key is stored in browser `localStorage` under `pigeon.provider`, never transmitted to any origin except the chosen provider's API.** The UI says so in plain words on the screen where the key is entered. | The single most common objection to pasting a key into a web app. Answer it at the moment of the ask, not in a privacy policy. |
| D43 | **Provider setup is step O2 of onboarding**, between Google consent and sync, and is fully skippable with "Continue without the assistant". | It belongs with the other connections, and putting it before sync means the digest is ready the moment the Screener has something in it. Skippable because the Screener works without it. |
| D44 | **Every AI surface degrades to its underlying content when no provider is connected** — the digest becomes a plain count, cards omit the read, the thread header shows a disabled "Summarize thread", the composer shows a disabled "Draft with Pigeon". No screen is ever blocked. | The assistant is an accelerant, not a dependency (D39 generalized). A missing key must never look like a broken app. |
| D45 | **Model choice is a select with a short curated list per provider, not a free-text field.** One model per provider does all three jobs (summary, read, draft). | A free-text model field invites typos and 404s from the provider. Curated lists can be updated in one place. |
| D46 | **Spend is surfaced as a running month-to-date figure and call count in Settings → Assistant.** Pigeon does not cap or bill; it reports. | The user is paying the provider directly and will want to know what the Screener digest costs them. Reporting is cheap; enforcement is a product Pigeon is not. |
| D47 | **Local providers skip the key field entirely** and ask for a base URL, defaulting to `http://localhost:11434`. Test connection lists the models the endpoint reports. | An Ollama user has no key. Asking for one would be nonsense. |

---

## 2. Information architecture

### 2.1 Navigation model

Pigeon has **one persistent shell** and **three mail places**. There are no folders, no labels, and no nesting. Every mail item is in exactly one place at a time.

- **Inbox** — threads from approved senders. The only place with an unread count.
- **Screener** — senders waiting for a decision. Not mail storage; a decision queue. Its badge is a count of *senders*, not messages.
- **Archive** — everything the user has finished with. Reached by `Archive`, never by swiping past it.

Settings is a fourth destination, pinned to the bottom of the rail and visually separated. Search is a persistent field at the top of the rail, not a destination in the nav list — invoking it replaces the thread-list column with results and leaves the reader intact.

Compose is not a destination. It is a docked panel that can be open over any route.

**Rule:** the nav rail never changes contents. The same four items and the search field are present on every screen of the app shell, including empty, loading, and error states. Onboarding has no rail.

### 2.2 Sitemap

```
Pigeon
│
├── ONBOARDING  (no shell; full-window, single column, centered 480px)
│   ├── O1  Welcome / Connect Gmail ....................... /welcome
│   ├── O1b Google consent ................................ (external, Google-hosted)
│   ├── O2  Connect your AI provider  (skippable) ......... /setup/provider
│   ├── O3  Setting up your inbox  (sync progress) ........ /setup/sync
│   ├── O4  Confirm your known senders .................... /setup/senders
│   └── O5  How the Screener works  (skippable) ........... /setup/screener
│                                                              │
│                                                              ▼
└── APP SHELL  (persistent: nav rail 232 · thread list 380 · reading pane fluid)
    │
    ├── Inbox ............................................. /inbox          ◀ default landing
    │   └── Thread ....................................... /inbox/t/:threadId
    │       └── Inline reply composer  (in-pane, not a route)
    │
    ├── Screener ......................................... /screener
    │   ├── Stack  (default view)
    │   ├── Bulk review  (list) .......................... /screener?view=list
    │   └── Held message ................................. /screener/s/:senderId   (sheet over stack)
    │
    ├── Archive .......................................... /archive
    │   └── Thread ....................................... /archive/t/:threadId
    │
    ├── Search results ................................... /search?q=…&held=0|1
    │   └── Thread ....................................... /search/t/:threadId
    │
    ├── Compose  (docked panel, over any route) .......... ?compose=1
    │
    └── Settings ......................................... /settings  → redirects to /settings/account
        ├── Account ...................................... /settings/account
        ├── Senders  (tabs: Approved | Declined) ......... /settings/senders?tab=approved|declined
        ├── Assistant  (provider + behaviour) ............ /settings/assistant
        └── About  (version, licence, repository) ........ /settings/about

GLOBAL OVERLAYS  (available on every app-shell route)
    ├── Toast stack ......................... bottom-left, max 3, newest on top
    ├── Confirm dialog ...................... Sign out · Disconnect account only
    ├── Keyboard shortcuts .................. opened with ?, closed with Esc
    └── Offline banner ...................... fixed strip above the shell
```

### 2.3 How mail moves between places

```
                    ┌──────────────────────┐
   new message ───▶ │  sender known?       │
                    └───────┬──────────┬───┘
                        yes │          │ no
                            ▼          ▼
                        ┌───────┐  ┌──────────┐
                        │ INBOX │  │ SCREENER │
                        └───┬───┘  └────┬─────┘
                            │           │
                    archive │           ├── approve ──▶ INBOX  (this message + all future mail)
                            ▼           │
                        ┌─────────┐     └── decline ──▶ silenced  (Gmail label Pigeon/Declined)
                        │ ARCHIVE │
                        └─────────┘
                            ▲
       reverse in Settings ─┘  (Settings → Senders reverses either decision; a reversed decline
                                does not retroactively surface old mail — only future mail)
```

**Stated explicitly for the coding agent:** approving a sender moves *the held message(s) already waiting from that sender* into the Inbox, marked unread, with today's date. Reversing a decline in Settings only affects mail received after the reversal. Reversing an approval (declining a previously approved sender) leaves their existing inbox threads in place and silences future mail.

---

## 3. User flows

Format: `screen → user action → system response`. Branch points are indented. Every failure branch is specified.

### 3.1 First-run onboarding

```
1.  O1 Welcome        → user clicks "Connect Gmail"
                      → button enters loading state (label unchanged, spinner replaces the
                        Google mark); browser navigates to Google consent
2.  O2 Google consent → user grants the requested scopes
                      → returns to /setup/provider
    2a. BRANCH — consent denied or window closed
                      → returns to O1 with an inline error block above the button:
                        "Pigeon didn't get access to your mail. Google needs permission to read
                        and send on your behalf for Pigeon to work. Try connecting again."
                        Button label unchanged. No modal, no redirect loop.
    2b. BRANCH — partial scopes granted (user unchecked a permission)
                      → returns to O1 with: "Pigeon needs all four permissions to sort your mail.
                        Connect again and leave the checkboxes ticked."
2c. O2 Provider      → user picks a provider, pastes a key, clicks "Test connection"
                      → button spins; on success the status line reads "Connected. Answered in
                        420 ms." and "Save and continue" enables
                      → user clicks "Save and continue"; key is written to localStorage;
                        advances to /setup/sync
    2c-i.  BRANCH — key rejected / no credit / endpoint unreachable / offline
                      → status line shows the matching message from §7.6. The key stays in the
                        field. Save stays disabled. No other part of onboarding is blocked.
    2c-ii. BRANCH — user picks Local
                      → the key field is replaced by a base URL field prefilled with
                        http://localhost:11434; Test connection queries it and populates the
                        model select from the models it reports
    2c-iii.BRANCH — user clicks "Continue without the assistant"
                      → provider set to none; advances to /setup/sync; O3 gains one line under
                        the step list: "The assistant is off. Turn it on any time in
                        Settings → Assistant." Every AI surface renders per C-28 from then on.
3.  O3 Sync           → (no user action) system streams progress with real counts
                      → at 100%, the primary button becomes enabled and the heading changes to
                        "Your mail is ready."
    3a. USER ACTION   → user clicks "Continue" before sync completes (allowed from 20% onward)
                      → advances to O4; remaining sync continues in the background and reports
                        in the rail as a thin progress line under the account name
    3b. BRANCH — sync fails (API error, revoked token, quota)
                      → O3 replaces the progress bar with an error block:
                        "Sync stopped at 4,312 of 11,908 threads. Gmail returned an error.
                        Start sync again — Pigeon will pick up where it stopped."
                        Buttons: [Start sync again] (primary) · [Contact support] (text link)
    3c. BRANCH — account has fewer than 50 total threads
                      → skip O4 entirely; go to O5. Known senders are seeded from Contacts only,
                        and the Screener explainer adds one line: "Your inbox is quiet, so almost
                        everything new will start in the Screener."
4.  O4 Known senders  → system shows N proposed senders, all approved by default
                      → user optionally unticks senders, or searches to find one
                      → user clicks "Approve 342 senders"   (count is live and updates on untick)
    4a. BRANCH — user unticks all
                      → button becomes "Continue with no approved senders" and a helper line
                        appears: "Everything new will start in the Screener until you approve
                        someone." Button stays enabled.
5.  O5 Screener intro → user clicks "Go to inbox"
                      → app shell mounts at /inbox; a one-time toast appears:
                        "Pigeon is holding 12 senders for you." with action [Open Screener]
6.  /inbox            → first run complete. O1–O5 are never shown again for this account.
```

### 3.2 Triaging the Screener — single decisions

```
1.  Any screen        → user clicks "Screener" in the rail  (or presses g then s)
                      → /screener loads: digest block at top, card stack below,
                        first card focused, keyboard cursor on the stack
2.  /screener stack   → user reads the digest and the top card
                      → (no system response; static)
3.  Stack             → user presses a  /  clicks "Approve sender"
                      → the postmark stamps onto the card (420ms), the card lifts and slides
                        right out of frame (180ms), the next card rises into place (180ms),
                        the Screener rail count decrements, the Inbox count increments,
                        and a toast appears: "Approved Dana Whitlock. Their mail is in your inbox."
                        [Undo]  — 8s
    3a. BRANCH        → user presses d / clicks "Decline sender"
                      → a "RETURNED" bar stamps across the card in destructive ink, the card
                        drops out of frame downward (180ms), toast:
                        "Declined marketing@northbound.io. You won't see their mail."  [Undo] — 8s
    3b. BRANCH        → user presses o / clicks "Read message"
                      → held-message sheet slides up over the stack (280ms) showing the full
                        message, read-only, with Approve / Decline / Close in its footer.
                        Esc or Close returns to the stack with the same card on top.
    3c. BRANCH        → user clicks [Undo] in the toast within 8s
                      → the decision reverses server-side, the card returns to the top of the
                        stack (fade-in 180ms, no reverse animation of the stamp), counts revert,
                        toast is replaced by: "Decision undone."  (3s, no action)
    3d. FAILURE       → the approve/decline API call fails
                      → the card returns to the stack, and the toast becomes an error toast:
                        "Couldn't approve Dana Whitlock. Check your connection and try again."
                        [Try again]. The optimistic UI is rolled back before the toast appears —
                        never leave the card gone with an error.
4.  Stack empties     → last card is decided
                      → the stack area crossfades (280ms) to the Screener empty state:
                        postmark-free blank card, heading "Nothing waiting.",
                        body "New senders will appear here. You'll never miss them —
                        they just don't interrupt you.", and a text link
                        "See who you've approved" → /settings/senders
```

### 3.3 Triaging the Screener — bulk

```
1.  /screener stack   → user clicks "Bulk review" (or presses b)
                      → the stack crossfades to a list of every held sender, one row each,
                        with a checkbox, monogram, name, address, subject, and the AI one-line
                        read. Nothing is checked. The digest block stays.
2.  Bulk list         → user clicks the AI grouping chip "Junk (9)" in the digest
                      → those 9 rows become checked; the bulk action bar slides up from the
                        bottom of the list column: "9 selected  [Approve senders] [Decline senders]
                        [Clear]"
    2a. ALT           → user checks rows manually, or uses x on the keyboard cursor row,
                        or Shift-clicks to extend a range
3.  Bulk list         → user clicks "Decline senders"
                      → all 9 rows stamp "RETURNED" simultaneously (420ms), then collapse their
                        height to 0 in sequence, 30ms apart (180ms each). Counts update once.
                        Toast: "Declined 9 senders. You won't see their mail."  [Undo all] — 8s
    3a. BRANCH        → "Approve senders" behaves identically with the postmark stamp and
                        toast "Approved 9 senders. Their mail is in your inbox."  [Undo all]
    3b. FAILURE — partial failure (some succeed, some fail)
                      → successful rows leave; failed rows return with a 1px destructive outline
                        and an inline retry affordance in the row. Toast:
                        "Declined 7 of 9 senders. 2 didn't go through — try those again."
                        [Try again] retries only the failed rows.
4.  Bulk list         → user clicks "Stack" toggle (or presses b)
                      → returns to stack view with the first remaining card on top
```

### 3.4 Reading a thread and replying with an AI draft

```
1.  /inbox            → user presses j/k or clicks a row
                      → the row takes the open state; the reading pane loads the thread
                        (skeleton for ≤400ms, then content); the thread is marked read after
                        1,200ms of continuous display
2.  Thread            → thread has ≥4 messages, so the summary generates automatically
                      → a Pigeon summary block renders at the top of the pane, above the first
                        message: label "◆ Pigeon summary", up to 3 bullets, ≤14 words each,
                        with a "Hide" text button
    2a. LOADING       → while generating: the block renders at its final width with three
                        shimmerless skeleton lines and the label "◆ Pigeon is reading this thread"
    2b. FAILURE — AI unavailable
                      → the block collapses to a single line in tertiary ink:
                        "Summary unavailable. [Try again]" — the thread below is fully readable
                        and every other feature works
    2c. SHORT THREAD  → no block; a text button "Summarize thread" sits in the thread header,
                        right-aligned. Pressing it renders the block in the loading state.
3.  Thread            → user presses r  /  clicks "Reply"
                      → the inline composer expands at the foot of the thread (180ms height
                        transition), focus moves into the body field, recipient chips are
                        pre-filled and editable
4.  Inline composer   → user clicks "Draft with Pigeon"  (or presses ⌘J)
                      → the button enters loading state; 1–4s later the body fills with the
                        generated draft rendered in AI ink on the AI surface tint, and a
                        provenance row appears above the send bar:
                        "◆ Drafted by Pigeon · [Shorter] [Friendlier] [Firmer] · [Discard draft]"
    4a. BRANCH        → user clicks "Shorter" / "Friendlier" / "Firmer"
                      → the body crossfades (180ms) to the regenerated draft; the pressed
                        button shows a checked state for 1.2s; [Undo] appears in the
                        provenance row for one step back
    4b. BRANCH — draft contains an unverifiable commitment
                      → the draft includes a `[confirm: …]` placeholder rendered as a filled
                        chip in destructive-tinted ink. Send is disabled with helper text:
                        "Replace [confirm: a time] before sending."
    4c. FAILURE — AI unavailable
                      → the button returns to rest and an inline message appears under it:
                        "Pigeon couldn't write a draft. Write your reply, or try again."
                        [Try again]. The composer stays open with whatever the user had typed.
5.  Inline composer   → user edits any character of the draft
                      → the entire body crossfades from AI ink to primary ink (200ms), the AI
                        surface tint clears, and the provenance row label changes to
                        "◆ Drafted by Pigeon · edited by you". Tone buttons remain available.
6.  Inline composer   → user clicks "Send"  (or ⌘Enter)
                      → the composer collapses, the sent message appends to the thread, and a
                        toast reads "Sent to Dana Whitlock."  [Undo] — 8s.
                        Undo restores the composer with the full draft and un-appends the message.
    6a. FAILURE — send fails
                      → the composer stays open with all content intact, and an error block
                        appears above the send bar: "Gmail didn't accept this message. Check
                        the recipient addresses and send again." [Send again]
```

### 3.5 Composing new mail

```
1.  Any app screen    → user presses c  /  clicks "Compose" in the rail
                      → the docked composer opens bottom-right (320ms slide + fade),
                        focus in the To field
    1a. BRANCH        → a draft is already open
                      → the existing dock is focused and pulses its border once (180ms).
                        No second composer is created.
2.  Composer          → user types in To
                      → an autocomplete listbox opens under the field, sourced from approved
                        senders and Google Contacts, max 6 rows, keyboard navigable.
                        Each row shows monogram, name, address.
3.  Composer          → user completes Subject and Body, clicks "Send" (⌘Enter)
                      → the dock collapses (200ms), toast: "Sent to marc@ferrum.dev."  [Undo] — 8s
    3a. BRANCH        → user clicks "Draft with Pigeon" with a Subject present
                      → same behavior as 3.4 step 4, using the subject line and recipient
                        history as context
    3b. BRANCH        → user presses Esc with content in the draft
                      → the dock minimizes to a 40px title bar at the bottom-right showing the
                        subject or "New message". Content is preserved. Clicking restores it.
    3c. BRANCH        → user clicks "Discard"
                      → the dock closes; toast "Draft discarded."  [Undo] — 8s
    3d. FAILURE — send fails
                      → identical to 3.4 step 6a, in the dock
    3e. FAILURE — offline
                      → Send is disabled with tooltip and helper text: "You're offline. Pigeon
                        will send this when you're back." (The draft is held in memory only; the
                        banner warns that closing the tab loses it.)
```

### 3.6 Reversing a screening decision

```
1.  Any screen        → user clicks "Settings" → "Senders"   (or g then ,)
                      → /settings/senders opens on the Approved tab; a list of every approved
                        sender with monogram, name, address, and a mono postmark date
                        ("APPROVED · JUL 12")
2.  Senders           → user types in the filter field
                      → the list filters live on name and address; the count in the tab label
                        does not change
3.  Senders           → user clicks "Decline" on a row
                      → the row's postmark restamps to "DECLINED · JUL 25" and the row animates
                        out of the Approved list (180ms collapse); toast:
                        "Declined Dana Whitlock. Their mail stays in your inbox; new mail stops."
                        [Undo] — 8s
    3a. BRANCH        → user is on the Declined tab and clicks "Approve"
                      → row moves to Approved; toast: "Approved marketing@northbound.io.
                        Their next message goes to your inbox."  [Undo] — 8s.
                        Helper text under the toast is not used; the copy already says that
                        past mail is not restored.
    3b. FAILURE       → the API call fails
                      → the row returns to its list with a destructive 1px outline for 3s;
                        toast: "Couldn't change Dana Whitlock. Check your connection and
                        try again."  [Try again]
4.  Senders empty     → no approved senders yet
                      → empty state: "No approved senders yet. Anyone you approve in the
                        Screener shows up here, with the date you approved them."
                        [Open Screener]
```

---

## 4. Design token system

### 4.1 Rationale

**Color.** Pigeon's world is a sorting room in the morning: cool northern light on paper, grey-green shadows, and one ink. The base is a faintly green-grey paper (`#F3F5F4`) rather than cream — cream reads as editorial warmth and is the current default of AI-generated design. Text is a blue-cast ink (`#1B2027`), not neutral black, so long reading feels like print rather than terminal output. The single accent is **stamp teal** (`#0F5F55`), taken from the iridescent green on a pigeon's neck and from postal franking ink; it appears only on primary actions, the focus ring, and the postmark. Destructive is a **returned-mail red** (`#A32C22`) — the color of a "RETURN TO SENDER" bar, desaturated and dark enough to sit on paper without shouting. The AI marker is **violet** (`#4C4A8A`), the other half of pigeon iridescence: adjacent to the accent in feel, unmistakably not it, and never used for anything a human wrote.

Six named hues total. No gradients anywhere in the product. No color is used decoratively; every color in the UI is carrying a meaning defined in this table.

**Type.** Public Sans for everything a user reads and clicks: it was drawn for public-service interfaces, has a large x-height, and stays clear at 13px in a dense list. Archivo, only above 24px, carries the handful of large moments (onboarding, empty states, screen titles) with signage weight the body face lacks. IBM Plex Mono, only in uppercase and small sizes, handles the utility register — timestamps, counts, postmark text, AI labels, keyboard hints — so that machine-generated facts look different from human words without needing color.

**Density.** A 56px thread row with a 4px base unit. That fits roughly 13 threads on a 1080px-tall display below the list header — enough to scan a morning, loose enough to breathe. Padding is generous horizontally (16px gutters) and tight vertically, which is what makes a list feel calm rather than cramped.

**Elevation.** Almost nothing floats. Two shadows exist: one for transient overlays (autocomplete, menus, toasts, docked composer) and one for modals. Cards, list rows, and panels are separated by surface value and 1px borders only. A mail client that floats is a mail client that fidgets.

**Motion.** Four uses only (D33). Everything else is instant.

### 4.2 The signature element: the postmark

The postmark is the only piece of the design allowed to be loud, and it appears in exactly four places.

**Geometry (identical everywhere, scaled by size token):**

- Outer ring: circle, diameter `S`, stroke `1.5px * (S/44)`, color = decision ink.
- Inner ring: circle, diameter `S * 0.77`, stroke `1px * (S/44)`, same color, `opacity: 0.55`.
- Text: IBM Plex Mono 500, uppercase, `letter-spacing: 0.08em`, size `S * 0.115`, two lines, centered — line 1 the verb (`APPROVED` / `RETURNED` / `DECLINED`), line 2 the date (`JUL 25`). Baselines at `S * 0.477` and `S * 0.614`. The size is set so the longest word (`RETURNED`, 8 characters) fits inside the inner ring with margin: 8 characters at `0.6em` advance plus letter-spacing measures `S * 0.62`, against an inner ring diameter of `S * 0.77`. Do not scale the text up to fill the ring.
- Whole mark rotated `-9deg`; opacity `0.88`; no shadow, no texture, no image asset.
- Approve ink = `--accent`. Decline ink = `--destructive`.

**Where it appears:**

1. **On decision, on the sender card** — `S = 132px`, centered over the card, stamped with the `--motion-stamp` animation (§4.6).
2. **On every row in Settings → Senders** — `S = 0` (ring omitted); the mono text alone renders right-aligned at `--text-2xs` in `--text-tertiary`: `APPROVED · JUL 12`.
3. **On the Screener rail badge** — the count is set in IBM Plex Mono inside a 24px ring (outer ring only, 1px, `--text-tertiary`). Never a filled red pill.
4. **On the first inbox thread from a newly approved sender** — for 24 hours, the row's timestamp column shows a 10px outline ring in `--accent` above the timestamp, with `aria-label="First message since you approved this sender"`. This is the "arrival" moment: the approval you made in the Screener is visible when the mail lands.

Nothing else in the product uses circles, rotation, or letterspaced uppercase at display size.

### 4.3 Complete token block

```css
/* ============================================================
   PIGEON — DESIGN TOKENS v1.0
   Light theme is the default. Dark applies via [data-theme="dark"]
   or the prefers-color-scheme fallback in the last block.
   ============================================================ */

:root {

  /* ---------- 1. NAMED HUES (the only raw hex in the system) ---------- */
  --hue-paper:        #F3F5F4;  /* cool grey-green daylight   */
  --hue-ink:          #1B2027;  /* blue-cast franking ink     */
  --hue-feather:      #4C5763;  /* pigeon grey                */
  --hue-stamp:        #0F5F55;  /* stamp teal — accent        */
  --hue-returned:     #A32C22;  /* returned-mail red          */
  --hue-iridescent:   #4C4A8A;  /* AI violet                  */

  /* ---------- 2. SEMANTIC COLOR — LIGHT ---------- */
  --color-bg:               #F3F5F4;  /* app background, nav rail          */
  --color-surface:          #FBFCFB;  /* lists, reading pane, cards        */
  --color-surface-sunken:   #EDF0EF;  /* inputs, quoted text, code         */
  --color-surface-held:     #EDF1F0;  /* Screener card body ("glassine")   */
  --color-surface-ai:       #EFEEF8;  /* AI summary + AI draft background  */
  --color-surface-hover:    #E9EDEC;  /* row and button hover              */
  --color-surface-active:   #E2E7E6;  /* row pressed / open thread row     */

  --color-text-primary:     #1B2027;  /* 15.9:1 on surface                 */
  --color-text-secondary:   #4C5763;  /*  6.7:1 on bg                      */
  --color-text-tertiary:    #616D78;  /*  4.8:1 on bg — meta, timestamps   */
  --color-text-disabled:    #7E8A95;  /*  3.2:1 — disabled labels only     */
  --color-text-inverse:     #FBFCFB;
  --color-text-ai:          #4C4A8A;  /*  7.2:1 on bg                      */
  --color-text-accent:      #0F5F55;  /*  7.0:1 on bg                      */
  --color-text-destructive: #A32C22;  /*  6.5:1 on bg                      */

  --color-border-subtle:    #DFE4E3;  /* dividers, card edges              */
  --color-border-control:   #78838E;  /*  3.6:1 — inputs, checkboxes       */
  --color-border-strong:    #1B2027;  /* secondary button border           */

  --color-accent:           #0F5F55;
  --color-accent-hover:     #0B4B43;
  --color-accent-active:    #083A34;
  --color-accent-subtle:    #E2EEEB;  /* approved chips, success tint      */

  --color-destructive:        #A32C22;
  --color-destructive-hover:  #8A231B;
  --color-destructive-active: #711C15;
  --color-destructive-subtle: #F6E6E4;

  --color-ai:               #4C4A8A;
  --color-ai-hover:         #3D3B72;
  --color-ai-subtle:        #EFEEF8;

  --color-focus:            #0F5F55;
  --color-scrim:            rgb(27 32 39 / 0.32);  /* modal backdrop       */

  /* ---------- 3. TYPEFACES ---------- */
  --font-display: "Archivo", "Helvetica Neue", Helvetica, sans-serif;
  --font-body:    "Public Sans", "Helvetica Neue", Helvetica, sans-serif;
  --font-mono:    "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* ---------- 4. TYPE SCALE ----------
     Each step ships size / line-height / weight / tracking.
     Steps 2xs–lg are Public Sans. display-* are Archivo. mono-* are IBM Plex Mono. */

  --text-2xs-size: 11px;  --text-2xs-line: 16px;  --text-2xs-weight: 500;  --text-2xs-track:  0.06em;
  --text-xs-size:  12px;  --text-xs-line:  16px;  --text-xs-weight:  500;  --text-xs-track:   0.005em;
  --text-sm-size:  13px;  --text-sm-line:  18px;  --text-sm-weight:  400;  --text-sm-track:   0em;
  --text-base-size:14px;  --text-base-line:21px;  --text-base-weight:400;  --text-base-track: 0em;
  --text-md-size:  15px;  --text-md-line:  24px;  --text-md-weight:  400;  --text-md-track:  -0.003em;
  --text-lg-size:  17px;  --text-lg-line:  24px;  --text-lg-weight:  600;  --text-lg-track:  -0.008em;
  --text-xl-size:  20px;  --text-xl-line:  28px;  --text-xl-weight:  600;  --text-xl-track:  -0.010em;

  --display-sm-size: 24px; --display-sm-line: 30px; --display-sm-weight: 600; --display-sm-track: -0.014em;
  --display-md-size: 32px; --display-md-line: 38px; --display-md-weight: 600; --display-md-track: -0.018em;
  --display-lg-size: 40px; --display-lg-line: 46px; --display-lg-weight: 700; --display-lg-track: -0.022em;

  --mono-xs-size: 10px;  --mono-xs-line: 14px;  --mono-xs-weight: 500;  --mono-xs-track: 0.09em;
  --mono-sm-size: 11px;  --mono-sm-line: 16px;  --mono-sm-weight: 500;  --mono-sm-track: 0.07em;
  --mono-md-size: 13px;  --mono-md-line: 18px;  --mono-md-weight: 400;  --mono-md-track: 0.02em;

  --font-feature-tabular: "tnum" 1, "lnum" 1;   /* all mono numerals      */
  --measure-read: 68ch;                          /* message body max width */

  /* ---------- 5. SPACING (4px base) ---------- */
  --space-0:  0px;    --space-1:  4px;    --space-2:  8px;    --space-3: 12px;
  --space-4: 16px;    --space-5: 20px;    --space-6: 24px;    --space-8: 32px;
  --space-10:40px;    --space-12:48px;    --space-16:64px;    --space-20:80px;

  /* ---------- 6. RADII ---------- */
  --radius-xs:   3px;   /* checkbox, tag                       */
  --radius-sm:   5px;   /* input, small button                 */
  --radius-md:   6px;   /* button, menu item                   */
  --radius-lg:  10px;   /* panel, toast, AI block              */
  --radius-xl:  14px;   /* sender card, dialog, composer dock  */
  --radius-full: 999px; /* monogram, badge ring, chip          */

  /* ---------- 7. BORDERS ---------- */
  --border-width-hairline: 1px;
  --border-width-control:  1px;
  --border-width-emphasis: 2px;   /* focus ring, selected card edge */
  --border-hairline: 1px solid var(--color-border-subtle);
  --border-control:  1px solid var(--color-border-control);

  /* ---------- 8. ELEVATION (two levels, both cool-tinted) ---------- */
  --shadow-none: none;
  --shadow-overlay:
      0 1px 2px rgb(27 32 39 / 0.05),
      0 6px 16px -4px rgb(27 32 39 / 0.10);
  --shadow-modal:
      0 2px 4px rgb(27 32 39 / 0.06),
      0 24px 48px -12px rgb(27 32 39 / 0.22);

  /* ---------- 9. MOTION ---------- */
  --duration-instant: 0ms;
  --duration-fast:  120ms;   /* hover, checkbox, small tint changes  */
  --duration-base:  180ms;   /* row departure, inline expand, crossfade */
  --duration-slow:  280ms;   /* sheet, view crossfade                */
  --duration-panel: 320ms;   /* composer dock open/close             */
  --duration-stamp: 420ms;   /* postmark only                        */
  --duration-toast-in:  180ms;
  --duration-toast-out: 120ms;
  --duration-undo:     8000ms;

  --ease-standard: cubic-bezier(0.20, 0.00, 0.00, 1.00);  /* enter, move  */
  --ease-exit:     cubic-bezier(0.40, 0.00, 1.00, 1.00);  /* leave        */
  --ease-stamp:    cubic-bezier(0.18, 1.30, 0.42, 1.00);  /* press+settle */

  /* ---------- 10. LAYOUT ---------- */
  --layout-rail-width:        232px;
  --layout-rail-width-compact: 56px;
  --layout-list-width:        380px;
  --layout-row-height:         56px;   /* thread list item              */
  --layout-row-height-dense:   44px;   /* sender list rows in settings  */
  --layout-header-height:      52px;
  --layout-card-width:        520px;   /* Screener sender card          */
  --layout-composer-width:    560px;   /* docked composer               */
  --layout-onboarding-width:  480px;

  --z-shell: 0; --z-dock: 40; --z-sheet: 50; --z-overlay: 60;
  --z-dialog: 70; --z-toast: 80; --z-banner: 90;
}

/* ============================================================
   DARK THEME
   ============================================================ */
[data-theme="dark"] {
  --color-bg:               #12161A;
  --color-surface:          #1A2027;
  --color-surface-sunken:   #232A32;
  --color-surface-held:     #1F262E;
  --color-surface-ai:       #22213A;
  --color-surface-hover:    #232A32;
  --color-surface-active:   #2B333C;

  --color-text-primary:     #E7ECEF;  /* 13.8:1 on surface */
  --color-text-secondary:   #9AA6B0;  /*  6.6:1 on surface */
  --color-text-tertiary:    #8593A0;  /*  5.0:1 on surface */
  --color-text-disabled:    #647280;  /*  3.1:1            */
  --color-text-inverse:     #12161A;
  --color-text-ai:          #A9A4E8;  /*  7.2:1 on surface */
  --color-text-accent:      #4FBFA8;  /*  7.4:1 on surface */
  --color-text-destructive: #E8776A;  /*  5.7:1 on surface */

  --color-border-subtle:    #2C343D;
  --color-border-control:   #6D7B88;  /*  3.5:1 on surface */
  --color-border-strong:    #E7ECEF;

  --color-accent:           #4FBFA8;
  --color-accent-hover:     #6BCEB9;
  --color-accent-active:    #86DBC8;
  --color-accent-subtle:    #16302C;

  --color-destructive:        #E8776A;
  --color-destructive-hover:  #F09085;
  --color-destructive-active: #F5A79E;
  --color-destructive-subtle: #331B18;

  --color-ai:               #A9A4E8;
  --color-ai-hover:         #BDB9EF;
  --color-ai-subtle:        #22213A;

  --color-focus:            #4FBFA8;
  --color-scrim:            rgb(6 9 12 / 0.60);

  /* Dark surfaces need lift, not shadow: shadows are reduced and
     surface separation carries the hierarchy. */
  --shadow-overlay:
      0 1px 2px rgb(0 0 0 / 0.40),
      0 6px 16px -4px rgb(0 0 0 / 0.45);
  --shadow-modal:
      0 2px 4px rgb(0 0 0 / 0.45),
      0 24px 48px -12px rgb(0 0 0 / 0.60);
}

/* Follow the OS unless the user has chosen a theme in Settings.
   The app writes data-theme="light"|"dark" on <html> once the user chooses;
   in the absence of that attribute this block applies. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { /* duplicate the [data-theme="dark"] block here */ }
}

/* ============================================================
   MOTION PREFERENCE
   Reduced motion keeps state changes legible but removes travel.
   Opacity crossfades are retained at 100ms so nothing "pops".
   ============================================================ */
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast:  1ms;
    --duration-base:  100ms;   /* opacity only — transforms are suppressed */
    --duration-slow:  100ms;
    --duration-panel: 100ms;
    --duration-stamp: 100ms;   /* postmark fades in, does not scale/rotate-in */
    --duration-toast-in:  100ms;
    --duration-toast-out: 100ms;
    --ease-standard: linear;
    --ease-exit:     linear;
    --ease-stamp:    linear;
  }
  /* All transform-based travel is removed; only opacity animates. */
  *, *::before, *::after {
    animation-duration: var(--duration-base) !important;
    animation-iteration-count: 1 !important;
    transition-property: opacity, background-color, border-color, color !important;
  }
}
```

### 4.4 Density rules (normative)

| Surface | Rule |
|---|---|
| Thread list row | 56px tall, `--space-4` horizontal padding, 2 lines (line 1: sender + timestamp; line 2: subject + snippet). No divider lines between rows — separation is hover/active tint only. |
| Section header in list | 32px tall, sticky, `--color-bg` background, `--mono-sm` uppercase in `--color-text-tertiary`. |
| Settings row | 44px tall, `--space-4` padding, 1px `--color-border-subtle` divider between rows. |
| Reading pane | `--space-8` padding top/bottom, `--space-10` left/right, body text capped at `--measure-read`, left-aligned within the pane (not centered). |
| Message block in a thread | `--space-6` internal padding, `--space-4` gap between messages, 1px `--color-border-subtle` around each collapsed message; expanded messages lose the border and gain `--color-surface`. |
| Screener card | 520px wide, min 280px tall, `--space-8` padding, `--radius-xl`. |
| Icon size | 16px in lists and buttons, 20px in the nav rail, 24px in empty states. Stroke 1.5px. |
| Minimum hit target | 32×32px for icon-only controls inside dense lists; 40px tall for all standard buttons. |

### 4.5 Type usage map

| Token | Used for |
|---|---|
| `--display-lg` (Archivo) | Onboarding headlines only |
| `--display-md` (Archivo) | Empty-state headlines, Screener digest headline |
| `--display-sm` (Archivo) | Screen titles (Inbox, Screener, Archive, Settings), thread subject in the reading pane header |
| `--text-xl` | Sender name on a Screener card |
| `--text-lg` | Message sender name in a thread; settings section titles |
| `--text-md` | Message body, composer body, held-message body |
| `--text-base` | Buttons, form fields, nav labels, dialog body |
| `--text-sm` | Thread list subject and snippet, AI summary bullets, helper text |
| `--text-xs` | Recipient lines, attachment names, secondary meta |
| `--text-2xs` | Nothing by default — reserved for the postmark date line in settings rows |
| `--mono-md` | Timestamps in the reading pane, sync counts |
| `--mono-sm` | Thread list timestamps, badge counts, keyboard hints, AI labels |
| `--mono-xs` | Postmark text, list section headers |

### 4.6 Motion specification (normative)

```
POSTMARK STAMP                     duration --duration-stamp, ease --ease-stamp
  from: opacity 0, scale 1.18, rotate -22deg
  to:   opacity 0.88, scale 1.00, rotate  -9deg
  The card beneath it does not move. Nothing else on screen animates during the stamp.

CARD DEPART — approve             delay 260ms after stamp start, --duration-base, --ease-exit
  translateX 0 → +64px, opacity 0.88 → 0
CARD DEPART — decline             delay 260ms after stamp start, --duration-base, --ease-exit
  translateY 0 → +48px, opacity 0.88 → 0
CARD RISE (next card)             starts with the depart, --duration-base, --ease-standard
  translateY +12px → 0, scale 0.97 → 1, opacity 0.7 → 1

ROW DEPART (archive, bulk decline) --duration-base, --ease-exit
  opacity 1 → 0 over the first 90ms, then height → 0 and margin → 0 over the remaining 90ms

TOAST                              in: --duration-toast-in / --ease-standard
                                   out: --duration-toast-out / --ease-exit
  in:  translateY +8px → 0, opacity 0 → 1
  out: opacity 1 → 0 (no travel)

PANEL / SHEET / DOCK               --duration-panel (dock), --duration-slow (sheet), --ease-standard
  dock:  translateY +24px → 0, opacity 0 → 1
  sheet: translateY +100% → 0; scrim opacity 0 → 1 over --duration-base

VIEW CROSSFADE (stack ⇄ bulk, empty state arrival)  --duration-slow, --ease-standard
  outgoing opacity → 0 over the first 40%, incoming opacity → 1 over the last 60%

INLINE COMPOSER EXPAND             --duration-base, --ease-standard
  height auto-measured → animate max-height and opacity together

AI INK → HUMAN INK                 200ms, --ease-standard, color + background-color only

HOVER / PRESS                      --duration-fast, --ease-standard, background-color only

NEVER ANIMATED: page loads, list scroll position, skeleton shimmer (skeletons are static
tinted blocks, not shimmering), counts, focus rings (instant, always).
```

### 4.7 The AI-content rule (normative)

Any pixel of text Pigeon generated must satisfy **all three**:

1. Sits on `--color-surface-ai` **or** is set in `--color-text-ai`.
2. Carries a visible mono label beginning with the diamond glyph `◆` — `◆ Pigeon summary`, `◆ Drafted by Pigeon`, `◆ Pigeon's read`.
3. Carries a visually hidden prefix for assistive technology: `Pigeon summary:` / `Drafted by Pigeon:` / `Pigeon's read of this message:`.

The moment a user edits AI-generated text, requirements 1 and 2 change together: the tint clears, the ink becomes `--color-text-primary`, and the label becomes `◆ Drafted by Pigeon · edited by you`. It never silently becomes indistinguishable from text the user wrote from scratch.

**Forbidden treatments for AI content:** left border accent stripe, gradient background, sparkle or star iconography, animated typing/streaming reveal in the composer (the draft appears complete), the word "magic", any purple button.

---

## 5. Screen specifications

Every wireframe below is drawn at desktop width (1440px reference). Column widths are token values. Tablet behavior is specified per screen; **tablet = 880–1079px** (compact rail), **narrow tablet = 720–879px** (single mail column). Below 720px the app renders a single centered block: "Pigeon needs a wider window. Open Pigeon on a screen at least 720 pixels wide." — phone is out of scope.

### 5.0 App shell (applies to §5.5–§5.11)

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▲ offline banner (only when offline) — full width, 36px, --color-destructive-subtle        │
├───────────────────────┬───────────────────────────┬────────────────────────────────────────┤
│  RAIL  232px          │  LIST  380px              │  READER  fluid (min 480px)             │
│  bg: --color-bg       │  bg: --color-surface      │  bg: --color-surface                   │
│                       │  border-left: hairline    │  border-left: hairline                 │
│  ┌─────────────────┐  │ ┌───────────────────────┐ │ ┌────────────────────────────────────┐ │
│  │ ⬤  Marc Ferrum  │  │ │ Inbox            12 ○ │ │ │                                    │ │
│  │    marc@ferrum… │  │ ├───────────────────────┤ │ │                                    │ │
│  └─────────────────┘  │ │  row                  │ │ │        reading pane content        │ │
│  ┌─────────────────┐  │ │  row                  │ │ │                                    │ │
│  │ ⌕ Search        │  │ │  row                  │ │ │                                    │ │
│  └─────────────────┘  │ │  ...                  │ │ │                                    │ │
│                       │ │                       │ │ │                                    │ │
│  ▣ Inbox         12   │ │                       │ │ │                                    │ │
│  ◎ Screener     (7)   │ │                       │ │ │                                    │ │
│  ▤ Archive            │ │                       │ │ │                                    │ │
│                       │ │                       │ │ │                                    │ │
│  ┌─────────────────┐  │ │                       │ │ │                                    │ │
│  │  Compose        │  │ │                       │ │ │                                    │ │
│  └─────────────────┘  │ │                       │ │ │                                    │ │
│                       │ │                       │ │ │                                    │ │
│  ─────────────────    │ │                       │ │ │                                    │ │
│  ⚙ Settings           │ │                       │ │ │                                    │ │
└───────────────────────┴───────────────────────────┴────────────────────────────────────────┘
                                                      toast stack sits bottom-left, over LIST
```

**Rail (232px, fixed, full height, `--color-bg`, no right border — the list's left hairline provides it).**

- Account block: 56px tall, `--space-4` padding. 28px monogram tile, name in `--text-base` 500, address in `--text-xs` `--color-text-tertiary`, truncated with ellipsis. Not interactive; the whole block is a link to `/settings/account` with hover tint `--color-surface-hover` and `--radius-md`.
- Search field: 36px tall, `--radius-sm`, `--color-surface` fill, 1px `--color-border-control`, 16px search icon at `--space-3` left, placeholder "Search mail". Focus expands nothing; it navigates to `/search` on first keypress. `/` focuses it from anywhere.
- Nav items: 36px tall, `--radius-md`, `--space-3` horizontal padding, 20px icon + `--space-3` gap + label at `--text-base` 500. Rest: `--color-text-secondary`. Hover: `--color-surface-hover`, text `--color-text-primary`. **Selected: `--color-surface-active`, text `--color-text-primary`, and a 3px × 16px `--color-accent` bar flush to the item's left edge, `--radius-full`.** Focus-visible: 2px `--color-focus` ring, 2px offset.
- Counts: right-aligned, `--mono-sm`, `--color-text-tertiary`. **Inbox** shows unread thread count as plain mono numerals; hidden at 0. **Screener** shows the held-sender count inside a 24px 1px ring in `--color-text-tertiary`; hidden at 0. **Archive** never shows a count.
- Compose button: full-width primary button, 40px, `--space-4` margin above.
- Divider + Settings pinned to the bottom with `--space-4` padding, same nav item styling.

**Tablet 880–1079px:** rail collapses to `--layout-rail-width-compact` (56px): icons only, centered, labels become `title` + `aria-label`. The account block becomes the 28px monogram alone. Search becomes an icon button that opens `/search` with the field focused in the list column header. Compose becomes a 40×40 icon button. Counts render as a 6px dot in `--color-text-tertiary` at the icon's top-right (the ring badge is unreadable at this size) with the exact count in the `aria-label`.

**Narrow tablet 720–879px:** rail stays at 56px; **list and reader become one column.** Opening a thread replaces the list; a back control appears in the reader header ("← Inbox", 32px tall, `--text-sm`). `u` or `Esc` returns to the list. The reader is never shown alongside the list at this width.

**Shell states.** Loading (initial app mount): rail renders fully; list column renders 8 row skeletons; reader renders the no-thread-selected empty state. Error (Gmail API unreachable at mount): the list column shows the connection error state (§5.5); the rail stays fully interactive.

### 5.1 O1 — Welcome / Connect Gmail

**Purpose:** get the user's Gmail connected in a single click with no marketing.

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│                                                                        │
│                          ◎     (48px postmark ring, --color-accent)    │
│                                                                        │
│                    Pigeon                       ← display-lg, Archivo  │
│                                                                        │
│         Mail from people you've chosen.         ← text-md, secondary   │
│         Everyone else waits at the door.                               │
│                                                                        │
│         ┌──────────────────────────────────┐                           │
│         │        Connect Gmail             │   ← primary, 44px, 100%   │
│         └──────────────────────────────────┘                           │
│                                                                        │
│         Pigeon reads and sends mail on your                            │
│         behalf. It never sends anything you                            │
│         haven't seen.            ← text-xs, tertiary, 3 lines max      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
      480px column, vertically centered, --color-bg background
```

- Column `--layout-onboarding-width`, horizontally centered, vertically centered with a min top offset of `--space-20`.
- The postmark ring at the top is the outer ring only, 48px, 1.5px stroke, `--color-accent`, rotated `-9deg`, no text. This is the product mark for the MVP.
- Gap stack: ring → `--space-6` → wordmark → `--space-3` → subhead → `--space-8` → button → `--space-4` → legal line.
- **States.** Default; button `loading` after click (spinner replaces nothing — the label stays "Connect Gmail" and a 16px spinner appears left of it, button disabled); error (a block above the button: `--color-destructive-subtle` fill, `--radius-lg`, `--space-4` padding, `--text-sm` `--color-text-primary`, with the copy from §3.1 branch 2a).
- **Interactions.** `Enter` anywhere activates Connect Gmail. No other keyboard affordances.
- **Tablet:** identical; the column is centered in whatever width is available.

### 5.2 O2 — Connect your AI provider

**Purpose:** let the user attach a model they already pay for, in one screen, and say plainly where the key goes.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                │
│    Connect your AI provider                    ← display-md                    │
│                                                                                │
│    Pigeon doesn't run models of its own. Bring a key from a provider you       │
│    already pay, or point Pigeon at a model running on your own machine.        │
│    Your key is stored in this browser and sent only to the provider you pick.  │
│                                                                                │
│    PROVIDER                                    ← mono-xs label                 │
│    ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐                 │
│    │ ◆     (●)│ │ ◆     ( )│ │ ◆     ( )│ │ ◆             ( )│                 │
│    │Anthropic │ │ OpenAI   │ │ Google   │ │ Local            │                 │
│    │Claude    │ │ GPT      │ │ Gemini   │ │ Ollama·LM Studio │                 │
│    └──────────┘ └──────────┘ └──────────┘ └──────────────────┘                 │
│                                                                                │
│    API KEY                                                                     │
│    ┌──────────────────────────────────────────────┐ ┌────────────────────┐     │
│    │ sk-ant-api03-••••••••••••••••4f2a      Show  │ │  Test connection   │     │
│    └──────────────────────────────────────────────┘ └────────────────────┘     │
│    ● Connected. Answered in 420 ms.                                            │
│    Pigeon has no servers of its own — your key never leaves this browser       │
│    except to reach Anthropic. Rotate or remove it any time in Settings.        │
│                                                                                │
│    MODEL                                                                       │
│    ┌──────────────────────────────────────────────────────────────────┐        │
│    │ claude-sonnet-4-5            summaries · reads · drafts       ⌄  │        │
│    └──────────────────────────────────────────────────────────────────┘        │
│                                                                                │
│    ┌──────────────────────┐   Continue without the assistant                   │
│    │  Save and continue   │                                                    │
│    └──────────────────────┘                                                    │
└────────────────────────────────────────────────────────────────────────────────┘
      640px column, vertically centered
```

- Column 640px, centered. Section labels in `--mono-xs` uppercase `--color-text-tertiary`, `--space-3` above their control.
- **Provider cards:** a 4-up row, `gap: --space-2`, each `flex: 1`, 78px tall, `--radius-lg`, `--space-3` padding. Top line: a 22px mark tile (`--radius-md`, tinted fill + 1px border, containing a 7px rotated square in the provider's mark colour — Pigeon does not reproduce provider logos) and a 14px radio on the right. Bottom: provider name `--text-sm` 500, sub-label `--mono-sm` `--color-text-tertiary`. Selected: `--color-surface` fill (raised one step), 1px `--color-accent` border, filled radio. Unselected: `--color-surface-sunken` fill, 1px `--color-border-subtle`. Hover raises the border to `--color-border-control`. `←`/`→` move between cards; the group is a `radiogroup`.
- **Key field:** 34px, `--font-mono`, masked to the last 4 characters with a "Show" text button that reveals for 10 seconds then re-masks. `autocomplete="off"`, `spellcheck="false"`, `type="password"` until revealed. Paired with a "Test connection" secondary button of the same height.
- **Status line** below the field, 18px, dot + message. Six states, all specified in §6 C-27.
- **Provenance note** below that in `--text-xs` `--color-text-tertiary` — this sentence is not optional and must name the provider the user selected.
- **Model select:** 34px, `--radius-sm`, showing the model id in `--text-base` and the jobs it covers in `--mono-sm` right-aligned. Options are a curated list per provider (§6 C-27); never a free-text field.
- **Local provider variant:** selecting *Local* replaces the API KEY section with **BASE URL** (default `http://localhost:11434`, no masking, no Show control) and the provenance note becomes "Nothing leaves your machine. Pigeon talks to the endpoint above and nowhere else." Test connection lists the models the endpoint reports and populates the model select from that response.
- **Actions:** "Save and continue" (primary, disabled until a successful test) and "Continue without the assistant" (tertiary). Choosing the latter sets the provider to none and shows a one-time line on the next screen: "The assistant is off. Turn it on any time in Settings → Assistant."

**States.** Default (nothing selected, key field empty, Save disabled) · provider selected · key entered · testing (button spinner, status "Checking with Anthropic…") · connected · rejected · out of credit · unreachable (local) · saving. Full state table in §6 C-27.

**Errors.** Key rejected → "Anthropic rejected this key. Check it in your provider dashboard and paste it again." No credit → "Anthropic returned no credit on this account. Top up, or switch provider." Local unreachable → "Nothing is answering at http://localhost:11434. Start your local model, then test again." Network → "Couldn't reach Anthropic. Check your connection and test again." In every case the key stays in the field; Pigeon never clears the user's input on failure.

**Tablet.** Below 1080px the provider row wraps to 2×2. Below 880px the column is `100% − 2 × --space-6` and the cards stack full-width at 56px each with the name and sub-label on one line.

### 5.2b O3 — Setting up your inbox (sync)

**Purpose:** make the longest wait in the product feel accounted for.

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│         Setting up your inbox           ← display-md, Archivo          │
│                                                                        │
│         ████████████████████░░░░░░░░░░░░░░░░░  ← 4px bar, radius-full  │
│                                                                        │
│         4,312 of 11,908 threads         ← mono-md, secondary           │
│                                                                        │
│         ─────────────────────────────────────                          │
│                                                                        │
│         ✓  Connected marc@ferrum.dev     ← text-sm, checkmark accent   │
│         ✓  Read your contacts                                          │
│         ◐  Reading your mail history     ← current step, primary ink   │
│         ○  Working out who you know      ← pending, tertiary ink       │
│                                                                        │
│         ┌──────────────────────────────────┐                           │
│         │        Continue                  │  ← primary, enabled ≥20%  │
│         └──────────────────────────────────┘                           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

- Progress bar: 4px tall, full column width, `--color-surface-sunken` track, `--color-accent` fill, `--radius-full`, width transitions with `--duration-base` `--ease-standard`. Never indeterminate once a total is known; before the total is known it renders as a 4px track with a 25%-wide fill that does not move and the count line reads "Counting your threads".
- Step list: 4 rows, 28px each, 16px status glyph + `--space-3` + label. Glyphs: `✓` accent, `◐` primary (a 12px ring with a 90° accent arc — **static**, not spinning, per D33... exception: this single glyph rotates at 1200ms linear infinite because it is the only indication that a multi-minute operation is alive; it is suppressed entirely under `prefers-reduced-motion`, where it renders as a filled half-ring), `○` tertiary.
- Continue button disabled below 20%; label is "Continue" throughout, never "Skip".
- **Error state** replaces the bar and step list with the error block from §3.1 branch 3b, keeping the heading. Two actions: primary "Start sync again", text link "Contact support" (opens `mailto:`).
- **Completion:** heading crossfades to "Your mail is ready." (`--duration-slow`), bar fills to 100% and holds, and Continue becomes the only focusable element.

### 5.3 O4 — Confirm your known senders

**Purpose:** let the user ratify, in one pass, the list of people whose mail skips the Screener.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Who already knows you?                          ← display-md                │
│                                                                              │
│  These 342 people are in your contacts or you've written to them before.     │
│  Their mail goes straight to your inbox. Everyone else starts in the         │
│  Screener.                                       ← text-md, secondary        │
│                                                                              │
│  ┌────────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ ⌕ Find a sender                    │  │  Untick all                    │  │
│  └────────────────────────────────────┘  └────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ ☑  ⬤ DW   Dana Whitlock          dana@lumenpartners.com    24 replies │  │
│  │ ☑  ⬤ MF   Marc Ferrum jr         marc.jr@ferrum.dev        Contact    │  │
│  │ ☑  ⬤ SS   Sana Sethi             sana@northbound.io        11 replies │  │
│  │ ☐  ⬤ NR   noreply@atlas-ci.com   noreply@atlas-ci.com      Contact    │  │
│  │ ...                                                    (virtualized)  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────┐                                        │
│  │     Approve 341 senders          │  ← primary; count is live              │
│  └──────────────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────────────┘
      720px column here (wider than other onboarding screens — it's a list)
```

- Column widens to 720px for this step only. List container: `--color-surface`, `--radius-lg`, 1px `--color-border-subtle`, max-height `min(52vh, 520px)`, virtualized scroll, rows at `--layout-row-height-dense` (44px) with 1px dividers.
- Row: checkbox (18px) · `--space-3` · 24px monogram · `--space-3` · name `--text-base` 500 · address `--text-sm` `--color-text-tertiary` (flex-grow, truncate) · reason `--text-xs` `--color-text-tertiary` right-aligned. Whole row is a label for its checkbox; clicking anywhere toggles.
- "Untick all" is a secondary button; it becomes "Tick all" once everything is unticked.
- Button label is live: `Approve {n} senders`; at n = 0 it reads "Continue with no approved senders" and the helper line from §3.1 4a appears between the list and the button.
- **Empty state** (fewer than 3 proposed senders): the list is replaced by a `--color-surface-sunken` block, `--space-8` padding, centered: "Pigeon didn't find anyone to propose. Everything new will start in the Screener until you approve someone." Button reads "Continue".
- **Loading state:** 8 skeleton rows (static tinted blocks at `--color-surface-sunken`, 60%/40%/25% width bars).
- **Error state:** list replaced by "Pigeon couldn't read your contacts. You can approve senders one at a time in the Screener instead." with [Try again] and [Continue].
- **Interactions.** `↑`/`↓` move a keyboard cursor through rows; `Space` toggles; `Shift+↑/↓` extends a toggle range; typing focuses the filter field.
- **Tablet:** column becomes `100% - 2 × --space-8`; the reason column is hidden below 880px.

### 5.4 O5 — How the Screener works

**Purpose:** teach one idea in under ten seconds.

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│      ┌──────────────────────────┐                                      │
│      │  ┌────────────────────┐  │   ← a static miniature of the        │
│      │  │ ┌────────────────┐ │  │     card stack: 3 stacked cards,     │
│      │  │ │  ⬤ SS          │ │  │     top one showing a monogram and   │
│      │  │ │  Sana Sethi    │ │  │     two grey text bars. 240px wide.  │
│      │  │ │  ▬▬▬▬▬▬  ▬▬▬   │ │  │     No animation.                    │
│      │  │ └────────────────┘ │  │                                      │
│      │  └────────────────────┘  │                                      │
│      └──────────────────────────┘                                      │
│                                                                        │
│      Strangers wait at the door        ← display-md                    │
│                                                                        │
│      Mail from someone new never lands in your inbox. It waits         │
│      in the Screener until you decide.                                 │
│                                                                        │
│      Approve someone and their mail — this one and everything          │
│      after — goes to your inbox. Decline and you never see them        │
│      again. You can change your mind any time in Settings.             │
│                                        ← text-md, secondary, 2 paras   │
│                                                                        │
│      ┌──────────────────┐                                              │
│      │   Go to inbox    │   ← primary, alone                           │
│      └──────────────────┘                                              │
└────────────────────────────────────────────────────────────────────────┘
```

- One button. There was a "Skip" beside it, on the reasoning that a returning-feeling user wants a fast exit, but it went to `/inbox` and set the same state — the same action twice, offered as a choice. Worse, "Skip" on the screen that explains screening reads as declining the Screener itself, which is not something this screen can do.
- No dots, no step counter, no second page.
- **States:** default only. This screen cannot fail or be empty.

### 5.5 Inbox

**Purpose:** the mail from people the user has chosen, and nothing else.

```
┌───────────────┬──────────────────────────────────┬─────────────────────────────────────────┐
│  RAIL         │  Inbox                    12 ○   │  ← reader (see §5.6)                    │
│               │  ────────────────────────────────│                                         │
│               │  TODAY                           │                                         │
│               │ ┌──────────────────────────────┐ │                                         │
│               │ │● ⬤DW  Dana Whitlock   2:14 PM│ │  ← unread: dot + 600 subject            │
│               │ │       Contract redlines ba…  │ │                                         │
│               │ ├──────────────────────────────┤ │                                         │
│               │ │  ⬤SS  Sana Sethi   ◎  11:02AM│ │  ← ◎ = first mail since approval        │
│               │ │       Intro to the Atlas te… │ │                                         │
│               │ ├──────────────────────────────┤ │                                         │
│               │ │  ⬤MF  Marc F. · 3    9:47 AM │ │  ← "· 3" = message count in thread      │
│               │ │       Re: Q3 invoice ▣       │ │  ← ▣ = has attachment                   │
│               │ └──────────────────────────────┘ │                                         │
│               │  YESTERDAY                       │                                         │
│               │ ┌──────────────────────────────┐ │                                         │
│               │ │  ⬤JD  Jae Doss       4:31 PM │ │                                         │
│               │ │       Re: office keys        │ │                                         │
│               │ └──────────────────────────────┘ │                                         │
└───────────────┴──────────────────────────────────┴─────────────────────────────────────────┘
```

**List column header** (`--layout-header-height` 52px, sticky, `--color-surface`, bottom hairline): screen title in `--display-sm` at `--space-4` left; unread count right-aligned in `--mono-sm` `--color-text-tertiary`. When rows are selected the header is **replaced** by the bulk action bar (same height): "3 selected · [Archive] [Clear]".

**Date group headers:** sticky, 32px, `--mono-xs` uppercase `--color-text-tertiary`, `--color-bg` background, `--space-4` padding. Groups: `TODAY`, `YESTERDAY`, weekday name for the last 7 days, `MMMM YYYY` beyond that.

**Thread row (56px)** — see component T-3 in §6 for full state table. Layout left to right: 8px unread dot slot · 28px monogram · `--space-3` · flexible column (line 1: sender name `--text-base` 500 + optional `· {n}` message count in `--color-text-tertiary`; line 2: subject `--text-sm` + ` — ` + snippet in `--color-text-tertiary`, single line, ellipsis) · `--space-3` · right column 72px, right-aligned (arrival ring if applicable, then timestamp `--mono-sm` `--color-text-tertiary`, tabular). Attachment glyph sits inline at the end of the subject before the snippet.

**Reader default:** when no thread is open, the reading pane shows the "no thread" state (§5.6 states).

**Interactions.**
- Click row → opens the thread, sets `aria-current="true"`, applies open state.
- Hover → `--color-surface-hover`; hovering reveals a right-aligned 32×32 archive icon button that replaces the timestamp.
- `j`/`k` or `↓`/`↑` → move keyboard cursor (2px inset `--color-focus` outline, no fill change). The cursor is independent of the open thread.
- `Enter` or `o` → open the cursor row. `e` → archive it. `x` → toggle its checkbox. `Shift+J`/`Shift+K` → extend checkbox selection.
- Right-click → no custom menu (native browser menu allowed).

**States.**
- **Loading:** 8 skeleton rows; header title renders immediately; count hidden.
- **Empty — day one (no mail has ever arrived from approved senders):** headline `--display-md` "Your inbox is empty." Body: "Mail from your approved senders lands here. Pigeon is holding 7 senders in the Screener — start there." Action: primary "Open Screener". If the Screener is also empty, the body is "Mail from your approved senders lands here. Nothing has arrived yet." and the action is a text button "Send yourself a test" which opens the composer pre-filled to the user's own address.
- **Empty — inbox cleared:** headline "Nothing left." Body: "You've read everything. 7 senders are waiting in the Screener." Action "Open Screener", or if none: body "You've read everything." with no action.
- **Error — Gmail unreachable:** list column replaced by a centered block: heading `--text-lg` "Pigeon can't reach Gmail." body `--text-sm` "Your mail is safe. This is a connection problem between Pigeon and Google." action primary "Try again", text link "Check Google Workspace status".
- **Error — token revoked:** heading "Pigeon lost access to your mail." body "Google revoked Pigeon's permission. Connect your account again to keep using Pigeon." action primary "Connect Gmail". This state locks the whole shell: the list and reader both show it, and only Settings and this action remain interactive.
- **Offline:** the offline banner appears; rows remain readable and clickable for already-loaded threads; archive and compose controls are disabled with `aria-disabled="true"`.

**Tablet.** 880–1079px: list stays 380px, reader takes the remainder. 720–879px: list is full width minus the 56px rail; opening a thread swaps to the reader.

### 5.6 Thread reader

**Purpose:** read one conversation and act on it without leaving the pane.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Contract redlines back from legal                          [↩][↪][→][▤]      │
│  4 messages · Dana Whitlock, you, Sana Sethi        ← header, sticky, 2 lines │
├───────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ ◆ PIGEON SUMMARY                                              Hide      │  │
│  │ • Legal returned the MSA with three changes.                            │  │
│  │ • Liability cap moved from $1M to $500K.                                │  │
│  │ • Dana needs your answer before Friday.                                 │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ⬤DW  Dana Whitlock  <dana@lumenpartners.com>                  Jul 22, 9:14AM │
│       to you, Sana                                                            │
│       ─────────────────────────────────────────────────────────              │
│       Message body, --text-md, capped at 68ch measure.                        │
│                                                                               │
│       ▣ MSA-v4-redline.pdf · 240 KB              ← attachment chip            │
│                                                                               │
│  ⬤MF  You                                                      Jul 22, 11:40AM│
│       ▸ Thanks — reading now. Will come back with…    ← collapsed, 1 line     │
│                                                                               │
│  ⬤DW  Dana Whitlock                                            Jul 24, 2:14PM │
│       Message body…                                                           │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │  Reply to Dana Whitlock                            ← inline composer     │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Header** (sticky, 72px, `--color-surface`, bottom hairline, `--space-10` horizontal padding): line 1 = subject `--display-sm`, truncated to two lines maximum then ellipsis; line 2 = `{n} messages · {participant names}` in `--text-sm` `--color-text-tertiary`. Right side: four 32×32 icon buttons with tooltips — Reply (`↩`), Reply all (`↪`), Forward (`→`), Archive (`▤`). On threads below the auto-summary threshold, a text button "Summarize thread" sits left of the icon group.

**Body** (`--space-8` top padding, `--space-10` horizontal, scrolls independently).

- **Pigeon summary block:** `--color-surface-ai` fill, `--radius-lg`, `--space-5` padding, no border. Label row: `◆ PIGEON SUMMARY` in `--mono-sm` uppercase `--color-text-ai`, with a "Hide" tertiary text button right-aligned. Bullets: `--text-sm`, `--color-text-primary`, `--space-2` gap, max 3, each ≤14 words, marker is a 3px square in `--color-text-ai` (not a bullet dot). Hiding is remembered per thread for the session only.
- **Message block:** 28px monogram in a fixed 44px left gutter; the rest is one column. Sender name `--text-lg`; address `--text-xs` `--color-text-tertiary` on the same line, shown only for the first message from each participant; recipients line `--text-xs` `--color-text-tertiary`; timestamp `--mono-sm` right-aligned on the name line. A `--space-3` hairline separates the header from the body. Body: `--text-md`, `--color-text-primary`, `--measure-read` max width. Quoted history is collapsed behind a 24px `···` button in `--color-surface-sunken`, `--radius-sm`.
- **Collapsed message:** 32px tall, one line: monogram (20px) · sender · first 80 characters of the body in `--color-text-tertiary` · timestamp. Clicking expands. All messages are expanded by default except messages the user sent that already have a later message after them, and any message beyond the 8 most recent.
- **Attachment chip:** 32px tall, `--color-surface-sunken`, `--radius-sm`, 16px file glyph + filename `--text-xs` 500 + size in `--color-text-tertiary`. Click downloads. No preview.
- **Inline composer** (component C-9, §6): collapsed it is a 44px button-like affordance reading "Reply to {name}" in `--color-text-tertiary` with `--color-surface-sunken` fill and `--radius-md`, full measure width. Clicking or `r` expands it.

**Interactions.** `r` reply · `a` reply all · `f` forward · `e` archive (and advance to the next thread in the list) · `u` back to list · `⌘J` draft with Pigeon (opens the composer if closed) · `Esc` collapses the composer if open and empty, otherwise minimizes nothing and does nothing. Scrolling is the pane's own; the list column does not scroll with it.

**States.**
- **No thread selected:** centered in the pane, max 320px: a 32px outline postmark ring in `--color-border-subtle`, `--space-4`, then `--text-base` `--color-text-tertiary` "Select a thread to read it." No headline, no illustration.
- **Loading:** header renders the subject from the list row immediately (no skeleton for text we already have); body renders three static skeleton blocks (a 44px gutter circle plus 3 text bars each).
- **Summary loading:** as §3.4 2a.
- **Summary failed:** single line replacing the block: `◆ Summary unavailable.` in `--mono-sm` `--color-text-tertiary` with a `[Try again]` text button. Height 24px, no fill.
- **Error — thread failed to load:** body replaced by "This thread didn't load. It's still in Gmail." + [Try again]. Header actions disabled.
- **Offline:** already-loaded threads render normally; the four header action buttons are disabled; the inline composer shows the disabled send state.

**Tablet.** Horizontal padding drops from `--space-10` to `--space-6` below 1080px. Below 880px a "← Inbox" back control is inserted above the subject and the pane is full width.

### 5.7 Screener — stack view

**Purpose:** decide, one sender at a time, who is allowed to reach the user.

```
┌───────────────┬──────────────────────────────────────────────────────────────────────────┐
│  RAIL         │  Screener                                     Stack │ Bulk review        │
│               │  ──────────────────────────────────────────────────────────────────────  │
│               │  ┌────────────────────────────────────────────────────────────────────┐  │
│               │  │ ◆ THIS WEEK                                                        │  │
│               │  │ 12 senders held: 9 junk, 2 recruiters, 1 looks like a client        │  │
│               │  │ inquiry.                                                            │  │
│               │  │ [ Junk (9) ]  [ Recruiters (2) ]  [ Client inquiry (1) ]            │  │
│               │  └────────────────────────────────────────────────────────────────────┘  │
│               │                                                                          │
│               │                    ┌────────────────────────────────┐  ← card 3 (2px)    │
│               │                  ┌─┴──────────────────────────────┐ │  ← card 2          │
│               │                ┌─┴────────────────────────────────┴─┴─┐                  │
│               │                │  ⬤ SS                               │  ← card 1, 520px │
│               │                │  Sana Sethi                         │                   │
│               │                │  sana@northbound.io                 │                   │
│               │                │  ──────────────────────────────     │                   │
│               │                │  Intro to the Atlas team            │                   │
│               │                │  Hi Marc — Dana suggested I reach   │                   │
│               │                │  out about the integration work…    │                   │
│               │                │                                     │                   │
│               │                │  ◆ PIGEON'S READ                    │                   │
│               │                │  A warm intro from Dana Whitlock,   │                   │
│               │                │  who you email often.               │                   │
│               │                │  ──────────────────────────────     │                   │
│               │                │  [Decline sender] [Approve sender]  │                   │
│               │                │            Read message             │                   │
│               │                └─────────────────────────────────────┘                   │
│               │                                                                          │
│               │                        3 of 12                    ← mono-sm, tertiary    │
└───────────────┴──────────────────────────────────────────────────────────────────────────┘
```

**Layout.** The Screener has **no list column** — the list and reader columns merge into one region from the rail's right edge to the window edge. This is the only screen where the three-pane shell changes shape, and that is deliberate: the Screener is not mail, so it must not look like mail.

- Header: 52px, sticky, title `--display-sm` left, a two-item segmented control right ("Stack" / "Bulk review", 32px tall, `--color-surface-sunken` track, `--radius-md`, selected segment `--color-surface` with `--shadow-overlay` at 50% opacity and `--text-sm` 600).
- Digest block: max-width 720px, centered, `--space-6` top margin. `--color-surface-ai`, `--radius-lg`, `--space-5` padding. Label `◆ THIS WEEK` in `--mono-sm` `--color-text-ai`. Sentence in `--text-md` `--color-text-primary`. Chips row `--space-4` above: each chip is 28px tall, `--radius-full`, 1px `--color-border-control`, `--text-xs` 500, transparent fill; hover `--color-surface-hover`; clicking a chip switches to Bulk review with those senders checked.
- Stack: centered horizontally in the region, `--space-10` below the digest. Card 1 (the live card) is at `--layout-card-width` (520px) and sits in normal flow; its height is whatever its content needs (roughly 460–520px).
- Cards 2 and 3 are **absolutely positioned behind card 1 with symmetric insets, never a fixed height and never `transform: scale()`.** Both approaches go stale: a scale eats more from the top edge than a small `translateY` adds back, and a hard-coded height stops matching the moment the card's content changes. The live card sits in normal flow inside a `position: relative` wrapper; each behind card is `position: absolute` with `height: auto` driven by opposing insets — card 2 `left: 32px; right: 32px; top: −12px; bottom: 12px`, card 3 `left: 44px; right: 44px; top: −24px; bottom: 24px`, against a live card at 520px centred in a 560px wrapper. The wrapper takes its height from the live card, so the counter beneath it never drifts.
- The result is two card edges peeking 12px and 24px above the live card, and nothing visible at the sides or below, at **any** card height.
- Behind cards use a `--color-surface-held` fill stepped one shade toward the background per layer (light: `#EAEFEE` then `#E7ECEB`; dark: `#1D242B` then `#1B2229`) with a 1px `--color-border-subtle` and `--radius-xl`, no shadow, no content. Both are `aria-hidden="true"` and `pointer-events: none`. If fewer than 3 senders remain, render only what exists.
- **Acceptance check:** at any card height, both behind-card top edges must be visible above the live card. Verify by measurement, not by eye.
- Counter below the stack: `{i} of {n}` in `--mono-sm` `--color-text-tertiary`, `--space-6` gap.

**Sender card (component C-6).** `--color-surface-held` fill, 1px `--color-border-subtle`, `--radius-xl`, `--space-8` padding, `--shadow-overlay`.

1. 40px monogram.
2. `--space-4` — sender name `--text-xl`; address `--text-sm` `--color-text-tertiary` beneath.
3. `--space-5` — hairline.
4. `--space-5` — subject `--text-lg` (weight 600); snippet `--text-sm` `--color-text-secondary`, clamped to 3 lines.
5. `--space-5` — Pigeon's read: `--mono-sm` uppercase label `◆ PIGEON'S READ` in `--color-text-ai`, then one sentence in `--text-sm` `--color-text-primary` on `--color-surface-ai` with `--radius-md` and `--space-3` padding, maximum 18 words.
6. `--space-6` — hairline — `--space-5` — action row: two buttons side by side, each `flex: 1`, 40px tall, `--space-3` gap. Left = "Decline sender" (secondary-destructive). Right = "Approve sender" (primary). Below them, `--space-3` gap, a full-width tertiary text button "Read message".
7. If the sender has more than one held message, a line above the action row: "3 messages held" in `--text-xs` `--color-text-tertiary`, and "Read message" becomes "Read 3 messages".

**Interactions.** `a` approve · `d` decline · `o` read message · `j`/`k` cycle the stack without deciding (the top card animates out to the left at 40% opacity and returns from the right; the counter updates) · `b` toggle Bulk review · `⌘Z` undo the last decision · `Tab` order inside the card is Decline → Approve → Read message. The card region has `tabindex="0"` and receives focus on route entry so single-key shortcuts work without a click.

**States.**
- **Loading:** digest block renders as `--color-surface-ai` with two static skeleton bars; one skeleton card at full size with 5 bars.
- **Empty:** the stack area crossfades to a centered block, max 420px: a **blank card** — 520px × 200px, `--color-surface-held`, `--radius-xl`, 1px dashed `--color-border-subtle` — with nothing on it, then `--space-6`, headline `--display-md` "Nothing waiting.", body `--text-md` `--color-text-secondary` "New senders will appear here. You'll never miss them — they just don't interrupt you.", then `--space-4`, text button "See who you've approved" → `/settings/senders`. The digest block is hidden entirely when empty.
- **Digest failed (AI unavailable):** the digest block loses its AI tint and becomes a plain `--color-surface-sunken` block with `--text-md` "12 senders waiting." and a `[Try again]` text button. The cards still render, each with its "Pigeon's read" section replaced by nothing (the section is omitted, not shown empty) — the card shrinks accordingly. Decisions work normally.
- **Per-card AI read failed:** that card omits section 5. No error text on the card.
- **Error — Screener failed to load:** centered block "Pigeon can't reach Gmail." with [Try again], same copy as the inbox.
- **Offline:** approve/decline/bulk controls disabled; the card is still readable.

**Tablet.** 880–1079px: card stays 520px, digest max-width becomes `100% - 2 × --space-8`. 720–879px: card becomes `100% - 2 × --space-6` and the two action buttons stack vertically (Approve on top, 44px each) because a 44px-tall side-by-side pair gets too narrow to read.

### 5.8 Screener — bulk review

**Purpose:** clear obvious junk in one pass.

```
┌───────────────┬──────────────────────────────────────────────────────────────────────────┐
│  RAIL         │  Screener                                     Stack │ Bulk review        │
│               │  ─────────────────────────────────────────────────────────────────────   │
│               │  ┌───────── digest block (identical to stack view) ────────────────────┐  │
│               │  └────────────────────────────────────────────────────────────────────┘  │
│               │  ┌────────────────────────────────────────────────────────────────────┐  │
│               │  │ ☐  Select all (12)                                                 │  │
│               │  ├────────────────────────────────────────────────────────────────────┤  │
│               │  │ ☑ ⬤NB  Northbound Digest   Weekly roundup #48   ◆ Bulk newsletter  │  │
│               │  │ ☑ ⬤QP  QuickPitch          You're invited to…   ◆ Cold sales mail  │  │
│               │  │ ☐ ⬤SS  Sana Sethi          Intro to the Atlas   ◆ Warm intro from  │  │
│               │  │                                                   Dana Whitlock     │  │
│               │  └────────────────────────────────────────────────────────────────────┘  │
│               │                                                                          │
│               │  ┌────────────────────────────────────────────────────────────────────┐  │
│               │  │  9 selected      [Decline senders]  [Approve senders]   Clear      │  │
│               │  └────────────────────────────────────────────────────────────────────┘  │
└───────────────┴──────────────────────────────────────────────────────────────────────────┘
```

- Container max-width 960px, centered, `--color-surface`, `--radius-lg`, 1px `--color-border-subtle`.
- Header row 44px: "Select all ({n})" checkbox, `--text-sm` 500. Indeterminate when a subset is checked.
- Sender row: 64px (two lines allowed for the AI read), 1px divider. Columns: checkbox 18px · `--space-3` · 28px monogram · `--space-3` · name 180px fixed `--text-base` 500 · `--space-4` · subject flex `--text-sm` truncate · `--space-4` · AI read 240px fixed, `--text-xs` `--color-text-ai` with the `◆` glyph, clamped 2 lines. Hover `--color-surface-hover`. Clicking the row body (not the checkbox) opens the held-message sheet.
- Bulk action bar: fixed to the bottom of the region, 56px, `--color-surface`, top hairline, `--shadow-overlay`, slides up (`--duration-base`) when count > 0. Contents: "{n} selected" `--text-sm` 500 · spacer · "Decline senders" (secondary-destructive) · "Approve senders" (primary) · "Clear" (tertiary text).
- **States.** Loading: 6 skeleton rows. Empty: the container is replaced by the same empty state as the stack view, and the segmented control jumps back to Stack. Error: same as stack. Offline: checkboxes and bulk bar disabled.
- **Interactions.** `j`/`k` cursor · `x` toggle · `Shift+click` range · `a`/`d` act on the checked set if any, otherwise on the cursor row · `b` back to stack · `Esc` clears the selection.
- **Tablet.** Below 1080px the AI read column drops to 180px; below 880px it moves to a second line spanning the row and the row grows to 76px.

### 5.9 Held message sheet

**Purpose:** read a held message in full before deciding, without leaving the Screener.

```
                    ┌─────────────────────────────────────────────────┐
                    │  Sana Sethi <sana@northbound.io>        Jul 24  │
                    │  Intro to the Atlas team                    ✕   │
                    ├─────────────────────────────────────────────────┤
                    │                                                 │
                    │  Full message body, --text-md, 68ch measure,    │
                    │  scrollable. Read-only: no reply affordance,    │
                    │  no forward, no archive. Links open in a new    │
                    │  tab. Remote images are not loaded; a single    │
                    │  line reads "Images aren't loaded for senders   │
                    │  you haven't approved."                         │
                    │                                                 │
                    │  ▣ deck.pdf · 1.2 MB   (download disabled)      │
                    │                                                 │
                    ├─────────────────────────────────────────────────┤
                    │  [Decline sender]              [Approve sender] │
                    └─────────────────────────────────────────────────┘
                     720px wide, 80vh tall, centered, over a scrim
```

- Sheet: 720px wide (or `100% - 2 × --space-8`, whichever is smaller), max-height 80vh, `--color-surface`, `--radius-xl`, `--shadow-modal`, centered, over `--color-scrim`. Enters with the sheet motion in §4.6.
- Header 64px, sticky: sender name + address `--text-base`, subject `--text-lg` on the second line, date `--mono-sm` right, 32px close button.
- Footer 72px, sticky, top hairline: the same two decision buttons as the card, each `flex: 1`.
- **Remote images are blocked** and attachments are listed but not downloadable until the sender is approved. This is a safety property of "held", not a limitation to apologize for; the copy states it plainly.
- If the sender has multiple held messages, they render stacked in the body, newest first, each with its own 40px header row and a hairline between.
- **States.** Loading: header renders from the card data; body shows 5 skeleton bars. Error: body replaced by "This message didn't load." + [Try again]; the decision buttons stay enabled. Empty: not possible.
- **Interactions.** `Esc` or the close button dismisses and returns focus to the card. `a`/`d` decide and dismiss. Focus is trapped inside the sheet. Background scroll is locked.

### 5.10 Archive

**Purpose:** find something the user has already dealt with.

Identical in every respect to the Inbox (§5.5) with four changes:

1. Title "Archive"; no unread count in the header or rail.
2. Date grouping starts at `THIS MONTH` rather than `TODAY` (archived mail is rarely same-day).
3. The hover action on a row is "Move to inbox" (`↰`) instead of Archive; `e` performs it and the toast reads "Moved to inbox."  [Undo].
4. **Empty state:** headline "Nothing archived yet." body "Threads you archive from your inbox end up here. Nothing is ever deleted." No action button.

### 5.11 Search results

**Purpose:** find a specific message fast, without teaching the user a query language.

```
┌───────────────┬──────────────────────────────────┬──────────────────────────────────────┐
│  RAIL         │  ⌕ atlas integration       ✕     │  reader (a result is open)           │
│  (search      │  ────────────────────────────────│                                      │
│   field is    │  18 results · Inbox and Archive  │                                      │
│   focused)    │  ☐ Also search held mail         │                                      │
│               │  ────────────────────────────────│                                      │
│               │  INBOX                           │                                      │
│               │  │ row … (highlighted term)      │                                      │
│               │  ARCHIVE                         │                                      │
│               │  │ row …                         │                                      │
└───────────────┴──────────────────────────────────┴──────────────────────────────────────┘
```

- The list column header becomes a 52px query bar: the live query in `--text-base`, a 24px clear button. Below it a 40px meta row: "{n} results · Inbox and Archive" in `--text-sm` `--color-text-tertiary`, and a checkbox "Also search held mail" (`--text-sm`), which when checked adds a third result group `HELD` and updates the meta to "Inbox, Archive and held mail".
- Results are grouped by place with the same sticky group headers as date groups. Within a group, newest first.
- Matched terms in the subject and snippet are wrapped in a mark: `--color-accent-subtle` background, `--color-text-primary` text, no bold, no underline.
- Rows are standard thread rows. Rows in the `HELD` group are **sender rows** instead (no open behavior into the reader) — clicking one opens the held-message sheet over the results.
- **States.** Empty query: the list shows recent searches (max 5, `--text-sm`, each a row with a clock glyph) or, if none, "Search your mail by sender, subject, or words in the message." Loading: 5 skeleton rows and the meta line reads "Searching…". No results: headline `--text-lg` "No results for "atlas integration"." body "Try fewer words, or search a sender's address." plus a text button "Also search held mail" if that option is off. Error: "Search didn't run. Try again." + [Try again].
- **Interactions.** `/` focuses the field from anywhere. `Esc` in the field clears the query and returns to the previous route. `↓` from the field moves the cursor into results. Search runs 250ms after the last keystroke, minimum 2 characters.

### 5.12 Compose (docked)

**Purpose:** write a new message without losing the screen behind it.

```
                                       ┌──────────────────────────────────────────┐
                                       │  New message                      ─  ✕   │
                                       ├──────────────────────────────────────────┤
                                       │  To      dana@lumenpartners.com ⓧ        │
                                       │  ────────────────────────────────────────│
                                       │  Subject  Contract redlines              │
                                       │  ────────────────────────────────────────│
                                       │                                          │
                                       │  Body, --text-md, min 200px, grows to    │
                                       │  480px then scrolls.                     │
                                       │                                          │
                                       ├──────────────────────────────────────────┤
                                       │ ◆ Drafted by Pigeon                      │
                                       │ [Shorter] [Friendlier] [Firmer] · Discard│
                                       ├──────────────────────────────────────────┤
                                       │  [ Send ]   ✎ Draft with Pigeon    ▣  🗑  │
                                       └──────────────────────────────────────────┘
                                        560px, docked bottom-right, 24px inset
```

- Dock: `--layout-composer-width` (560px), bottom-right with `--space-6` inset from both edges, `--color-surface`, `--radius-xl`, `--shadow-modal`, `--z-dock`. Expand control in the title bar toggles to a centered 880px × 80vh panel with a scrim.
- Title bar 44px: "New message" or the live subject, `--text-base` 500; minimize (`─`) and close (`✕`) 28px icon buttons.
- Fields: To (chips + input), Cc/Bcc revealed by a "Cc Bcc" text button right-aligned in the To row, Subject. Each 44px, separated by hairlines, `--space-4` horizontal padding, label in `--text-sm` `--color-text-tertiary` in a fixed 64px column, no boxes — the hairlines are the field boundaries.
- Provenance row (only present when an AI draft is in the body): `--color-surface-ai`, `--space-3` padding, label `◆ Drafted by Pigeon` (`--mono-sm`, `--color-text-ai`), tone buttons as 28px chips, "Discard draft" tertiary text right-aligned.
- Action bar 56px, top hairline: "Send" primary 40px · "Draft with Pigeon" secondary 40px with a 16px pen glyph · spacer · attach (▣) and discard (🗑) 32px icon buttons.
- **States.** Default; focused-field; AI-drafting (the "Draft with Pigeon" button shows a spinner and the body is `aria-busy`); AI-drafted (body on `--color-surface-ai`, text in `--color-text-ai`); edited (tint cleared); send-disabled (empty To, or an unresolved `[confirm:]` chip, or offline) with helper text in the action bar left of Send; sending (Send shows a spinner, all fields read-only); error (block above the action bar); minimized (44px title bar only, bottom-right).
- **Interactions.** `⌘Enter` send · `Esc` minimize · `⌘J` draft with Pigeon · `Tab` cycles To → Cc → Bcc → Subject → Body → tone chips → Send. Autocomplete listbox on To: `↑`/`↓`, `Enter` to pick, `Esc` to close, `Backspace` on an empty input removes the last chip.
- **Tablet.** Below 1080px the dock is 480px. Below 880px the dock becomes a full-screen sheet with the same internals and a "Cancel"/"Send" header.

### 5.13 Settings

**Purpose:** change the four things a user can change, and reverse any screening decision.

```
┌───────────────┬──────────────────────────────────────────────────────────────────────────┐
│  RAIL         │  Settings                                                                │
│               │  ────────────────────────────────────────────────────────────────────    │
│               │  ┌────────────────┐  ┌────────────────────────────────────────────────┐  │
│               │  │ Account        │  │  Senders                                        │ │
│               │  │ Senders     ◀  │  │  ┌──────────┬──────────┐                        │ │
│               │  │ Assistant      │  │  │ Approved │ Declined │   ⌕ Filter senders     │ │
│               │  └────────────────┘  │  │   (341)  │   (28)   │                        │ │
│               │   200px sub-nav      │  └──────────┴──────────┘                        │ │
│               │                      │  ─────────────────────────────────────────────  │ │
│               │                      │  ⬤DW Dana Whitlock   dana@lumen…                │ │
│               │                      │       APPROVED · JUL 12            [Decline]    │ │
│               │                      │  ─────────────────────────────────────────────  │ │
│               │                      │  ⬤SS Sana Sethi      sana@north…                │ │
│               │                      │       APPROVED · JUL 24            [Decline]    │ │
│               │                      └────────────────────────────────────────────────┘ │
└───────────────┴──────────────────────────────────────────────────────────────────────────┘
```

Settings occupies the merged list+reader region (like the Screener). A 200px sub-nav column sits left; content fills the rest, max-width 720px, left-aligned with `--space-8` gutters.

**Sub-nav items:** 36px, `--radius-md`, `--text-base` 500, same selected treatment as the rail (3px accent bar).

**5.13a Account**
- Row: 28px monogram · name and address · "Connected {relative date}" in `--text-xs` `--color-text-tertiary`.
- "Appearance" segmented control: System / Light / Dark. Default System.
- "Disconnect Google account" — destructive secondary button. Opens the confirm dialog: title "Disconnect marc@ferrum.dev?", body "Pigeon will stop syncing and you'll be signed out. Your mail stays in Gmail, and your approved and declined senders are kept for 30 days.", actions [Cancel] [Disconnect account].
- "Sign out" — secondary button. Confirm dialog: title "Sign out of Pigeon?", body "You'll need to sign in with Google again. Nothing changes in your mail.", actions [Cancel] [Sign out].

**5.13b Senders**
- Tabs: "Approved ({n})" / "Declined ({n})", 36px, underline-style selection with a 2px `--color-accent` bar. Filter field right-aligned, 240px.
- Row 56px (two lines): line 1 = 24px monogram · name `--text-base` 500 · address `--text-sm` `--color-text-tertiary`; line 2 = postmark text `APPROVED · JUL 12` in `--mono-xs` `--color-text-tertiary`. Right: a single 32px-tall secondary button, "Decline" on the Approved tab, "Approve" on the Declined tab. Hover reveals nothing extra; the button is always visible.
- Virtualized list, 1px dividers, sorted by decision date descending.
- **Empty states.** Approved: as §3.6 step 4. Declined: "No declined senders. When you decline someone in the Screener, they show up here — and you can let them back in any time."
- **Loading:** 6 skeleton rows. **Error:** "Pigeon couldn't load your senders. Try again." + [Try again].

**5.13c Assistant**

The panel has two blocks, in this order: **Provider** then **Behaviour**. The behaviour toggles are disabled (and visibly so) when no provider is connected.

*Provider block* — a bordered panel, `--radius-lg`, 1px `--color-border-subtle`, containing:

1. **Header row, 52px.** 28px provider mark tile · provider name `--text-base` 500 with `{model} · {masked key}` beneath in `--mono-sm` `--color-text-tertiary` · a status pill (22px, `--radius-md`, dot + label: `Connected` on `--color-accent-subtle`, `Not connected` on `--color-surface-sunken`, `Key rejected` on `--color-destructive-subtle`) · a "Change" secondary button that reopens the O2 form inline.
2. **Meta rows, 38px each,** label 150px + value in `--mono-sm`: Endpoint · Key stored (`This browser · never sent to Pigeon`) · Spend this month (`$1.84 · 612 calls`) · Last call (`2 minutes ago · 420 ms`).
3. **Action row:** "Test connection" (secondary) · "Remove key" (secondary-destructive) · right-aligned note `Stored in this browser only` in `--mono-sm` `--color-text-disabled`.

Removing the key does not confirm — it toasts "Removed your Anthropic key." with 8-second undo, and the behaviour toggles grey out immediately.

*Behaviour block* — three toggle rows, 64px each (label + one-line description + switch right-aligned):
1. **"Summarize long threads automatically"** — "Pigeon writes a summary for threads with four or more messages." Default on.
2. **"Read new senders for the Screener"** — "Pigeon adds a one-line read to each sender card and writes the weekly digest." Default on. When off, cards omit "Pigeon's read" and the digest block is replaced by "12 senders waiting."
3. **"Match my writing style in drafts"** — "Pigeon looks at mail you've sent to write drafts that sound like you." Default on. When off, drafts use a neutral professional register.

Below the toggles, a text paragraph in `--text-sm` `--color-text-secondary`: "Pigeon never sends anything you haven't read. Every draft opens in the composer for you to edit." No link.

**Interactions across settings.** `Tab` order is sub-nav → content. `↑`/`↓` move within the sub-nav. Switches respond to `Space`. Every change saves immediately and confirms with a toast ("Automatic summaries are off."); there is no Save button anywhere in Settings.

### 5.14 Global overlays

**Offline banner.** 36px, full width, above the shell, `--color-destructive-subtle` fill, `--color-text-primary` `--text-sm`, centered: "You're offline. Pigeon is showing the mail it already has." `role="status"`. Disappears on reconnect with a 3s toast "Back online."

**Keyboard shortcuts dialog (`?`).** 560px, `--radius-xl`, `--shadow-modal`, `--space-8` padding, title "Keyboard shortcuts" `--display-sm`, then four labeled groups (Anywhere / In a list / In a thread / In the Screener) as two-column rows: key in a `--mono-sm` 24px `--color-surface-sunken` `--radius-xs` chip, description in `--text-sm`. `Esc` or the close button dismisses.

**Toast stack.** Bottom-left, `--space-6` inset, max 3 visible, newest on top, 320–420px wide, `--color-text-primary` fill with `--color-text-inverse` text (a deliberate inversion so toasts read as system speech, not content), `--radius-lg`, `--shadow-overlay`, `--space-4` padding, `--text-sm`. Undo action right-aligned as a text button in `--color-accent` — in dark-on-light inversion the accent must be the **dark-theme** accent `#4FBFA8` (7.4:1 on `#1B2027`). Auto-dismiss at 8s for undo toasts, 3s for plain confirmations, never for error toasts (dismissed by their action or a close button). Timer pauses on hover and on focus within.

---

## 6. Component inventory

Notation: **Props** = configurable inputs. **States** listed in order default / hover / focus-visible / active / disabled / loading. Every interactive component receives the standard focus ring — `outline: var(--border-width-emphasis) solid var(--color-focus); outline-offset: 2px` on `:focus-visible` — and it is never overridden.

### C-1 Button

**Props:** `variant` (primary · secondary · secondary-destructive · tertiary · icon), `size` (md 40px · sm 32px · xs 28px), `iconLeading`, `iconTrailing`, `fullWidth`, `loading`, `disabled`.

| Variant | Default | Hover | Active | Disabled | Loading |
|---|---|---|---|---|---|
| primary | `--color-accent` fill, `--color-text-inverse`, `--radius-md` | `--color-accent-hover` | `--color-accent-active` | `--color-surface-sunken` fill, `--color-text-disabled`, no border | fill unchanged, 16px spinner leading, label unchanged, `aria-busy="true"` |
| secondary | transparent fill, 1px `--color-border-control`, `--color-text-primary` | `--color-surface-hover` | `--color-surface-active` | border `--color-border-subtle`, text `--color-text-disabled` | spinner leading |
| secondary-destructive | transparent, 1px `--color-border-control`, `--color-text-destructive` | `--color-destructive-subtle` fill, border `--color-destructive` | `--color-destructive-subtle`, border `--color-destructive-hover` | as secondary | spinner leading |
| tertiary | no fill, no border, `--color-text-accent`, underline on hover only | underline | `--color-accent-active` text | `--color-text-disabled` | spinner leading |
| icon | square, no fill, `--color-text-secondary` glyph, `--radius-md` | `--color-surface-hover`, glyph `--color-text-primary` | `--color-surface-active` | glyph `--color-text-disabled` | spinner replaces glyph |

Padding: md `0 var(--space-4)`, sm `0 var(--space-3)`, xs `0 var(--space-3)`. Label `--text-base` 500 (md/sm) or `--text-xs` 500 (xs). Icon gap `--space-2`. Transition: `background-color var(--duration-fast) var(--ease-standard)`.
**Tokens:** all `--color-accent*`, `--color-destructive*`, `--color-surface-*`, `--radius-md`, `--space-2/3/4`, `--text-base`, `--duration-fast`.
**ARIA:** `<button>` always; icon variant requires `aria-label`; `loading` sets `aria-busy` and `disabled`.

### C-2 Icon

16px (in-content), 20px (rail), 24px (empty states). 1.5px stroke, round caps, `currentColor`. Set (exhaustive — no other icons exist in the MVP): inbox, screener-ring, archive, search, compose, settings, reply, reply-all, forward, attach, download, close, chevron-down, chevron-left, check, minus, plus, trash, pen, clock, warning, external-link, expand, minimize.

### C-3 Monogram tile

**Props:** `name`, `email`, `size` (20 · 24 · 28 · 40).
Circle, `--radius-full`. Initials: one letter for a single-word name, two for multi-word; falls back to the first letter of the address. `--font-body` 600, size = tile × 0.4, color = `--color-text-inverse` in light theme.
Fill: deterministic from `hash(lowercased email) % 6` over a fixed **feather ramp** — `#4C5763`, `#3E5A57`, `#4A5266`, `#565A4E`, `#3F5460`, `#5A5060`. All six are ≥ 4.5:1 against `--color-text-inverse`. In dark theme, fill uses the same six hues lightened to `#8894A0`, `#7FA39D`, `#8A90AC`, `#9A9E8B`, `#7F98A8`, `#A08FA6` with `--color-text-inverse` (dark) text.
**States:** static; no hover. **ARIA:** `aria-hidden="true"` — the name is always adjacent in text.

### C-4 Badge / count

**Props:** `value`, `variant` (plain · ring).
`plain`: `--mono-sm`, `--color-text-tertiary`, tabular figures, no fill. Used for the Inbox unread count.
`ring`: value centered in a 24px circle, 1px `--color-border-control`, `--mono-sm` `--color-text-tertiary`. Used for the Screener count. Values above 99 render `99+`.
Hidden entirely at 0 — never renders a zero.
**ARIA:** wrapped so the nav item's accessible name reads "Screener, 7 waiting".

### C-5 Thread list item

**Props:** `sender`, `subject`, `snippet`, `timestamp`, `unread`, `messageCount`, `hasAttachment`, `isNewlyApproved`, `checked`, `cursor`, `open`.

**The three independent states (D29):**

| State | Treatment |
|---|---|
| cursor (keyboard position) | 2px inset `--color-focus` outline, `outline-offset: -2px`. No fill change. |
| open (thread showing in reader) | `--color-surface-active` fill + a 2px `--color-accent` bar on the left edge, full row height. `aria-current="true"`. |
| checked (bulk selection) | checkbox filled, row fill `--color-accent-subtle`. |

Also: **hover** `--color-surface-hover` (and the timestamp is replaced by a 32px archive icon button); **unread** 6px `--color-accent` dot in the left slot and subject at weight 600; **read** no dot, subject weight 400 in `--color-text-secondary`. Cursor + open + checked can all be true at once and must remain individually legible: outline over fill over left bar.
**Tokens:** `--layout-row-height`, `--space-3/4`, `--text-base/sm`, `--mono-sm`, `--color-surface-hover/active`, `--color-accent`, `--color-accent-subtle`.
**ARIA:** the row is a `<div role="listitem">` inside `<div role="list">`, containing an `<input type="checkbox">` with `aria-label="Select thread from Dana Whitlock"` and a `<button>` carrying the row content with an accessible name of `"{sender}, {subject}, {relative time}{, unread}"`. Roving `tabindex` across the row buttons; the list container handles `j`/`k`.

### C-6 Sender card

**Props:** `sender`, `email`, `subject`, `snippet`, `aiRead`, `heldCount`, `stackPosition` (0 = top), `decision` (null · approved · declined).

**States:**
- **default** (position 0): full content, `--shadow-overlay`, interactive.
- **behind** (position 1–2): blank fill, scaled/offset per §5.7, `aria-hidden`, `pointer-events: none`.
- **hover:** no change (the card is not a click target as a whole; only its buttons are).
- **focus-within:** 1px border becomes `--color-border-control`.
- **deciding:** buttons disabled, postmark rendering.
- **stamped-approved / stamped-declined:** postmark present, card animating out.
- **error:** returns to default with a 1px `--color-destructive` border held for 3s.
- **skeleton:** same dimensions, 5 static bars.
- **no-AI-read:** section 5 omitted entirely.

**Tokens:** `--layout-card-width`, `--color-surface-held`, `--radius-xl`, `--space-5/6/8`, `--text-xl/lg/sm`, `--mono-sm`, `--color-surface-ai`, `--color-text-ai`, `--shadow-overlay`, `--duration-stamp`, `--ease-stamp`.
**ARIA:** see §8.4.

### C-7 Postmark

**Props:** `verb` ("Approved" · "Returned" · "Declined"), `date`, `size` (px), `ink` (accent · destructive), `textOnly` (boolean).
Rendered as inline SVG: two `<circle>` elements plus two `<text>` lines, per the geometry in §4.2. `textOnly` renders the mono line without circles (settings rows).
**States:** entering (animated per §4.6), rest, reduced-motion (opacity fade only).
**ARIA:** `role="img"` with `aria-label="Approved on July 25"`; when it accompanies text that already says this, `aria-hidden="true"` instead.

### C-8 Message block (in a thread)

**Props:** `sender`, `address`, `recipients`, `timestamp`, `body` (sanitized HTML), `attachments`, `collapsed`, `isFromUser`.
**States:** expanded (default), collapsed (32px single line), hover-on-collapsed (`--color-surface-hover`), loading (skeleton bars), blocked-images (a 28px `--color-surface-sunken` strip above the body: "Images aren't loaded. [Show images]" — only for senders approved less than 24 hours ago; approved senders' images load normally), error ("This message didn't load. [Try again]").
**Tokens:** `--measure-read`, `--text-md/lg/xs`, `--mono-sm`, `--space-3/4/6`, `--color-border-subtle`, `--color-surface-sunken`.
**ARIA:** `<article aria-label="Message from Dana Whitlock, July 22 at 9:14 AM">`; collapsed messages use a `<button aria-expanded="false">` wrapper.

### C-9 Composer (inline and docked share one component)

**Props:** `mode` (inline-reply · inline-reply-all · inline-forward · docked-new), `recipients`, `subject`, `body`, `aiState` (none · generating · drafted · edited), `disabledReason`.
**States:** collapsed (inline only, 44px affordance), expanded, focused-field, generating, drafted, edited, send-disabled, sending, error, minimized (docked only), full-panel (docked only).
**Sub-parts:** recipient field with chips (chip: 24px, `--color-surface-sunken`, `--radius-full`, `--text-xs`, 12px remove glyph; invalid address chip gets a 1px `--color-destructive` border and `aria-invalid`), subject input, body editor, provenance row, action bar.
**Tokens:** `--layout-composer-width`, `--radius-xl`, `--shadow-modal`, `--color-surface-ai`, `--color-text-ai`, `--space-3/4`, `--text-md/sm`, `--duration-panel`.
**ARIA:** docked composer is `role="dialog"` `aria-label="New message"` **non-modal** (no focus trap, no scrim) so the user can click behind it; inline composer is a `<form aria-label="Reply to Dana Whitlock">`. The body editor is a `contenteditable` with `role="textbox" aria-multiline="true"` and `aria-describedby` pointing at the provenance row when an AI draft is present.

### C-10 AI content block

**Props:** `kind` (summary · digest · read), `label`, `content` (string or bullet array), `state` (loading · ready · failed · hidden), `dismissible`.
**States:** loading (label reads "◆ Pigeon is reading this thread", 3 static skeleton bars on the AI tint), ready, failed (collapses to one tertiary line with [Try again], no tint), hidden (0 height; the "Hide" control is replaced by nothing — the block is gone for the session).
Bullet marker is a 3px square in `--color-text-ai`, `--space-2` from the text, aligned to the first line's cap height.
**Tokens:** `--color-surface-ai`, `--color-text-ai`, `--radius-lg`, `--space-2/3/5`, `--mono-sm`, `--text-sm`.
**ARIA:** `<section aria-label="Pigeon summary">` with a visually hidden `<h3>` carrying the same text; `aria-live="polite"` on the container so a summary that arrives after the thread announces itself once.

### C-11 Toast

**Props:** `message`, `action` (label + handler, optional), `tone` (confirm · error), `duration`.
**States:** entering, rest, hover/focus-within (timer paused, a 1px `--color-border-control` appears), exiting, stacked (positions 2 and 3 render at 100% scale with 4px vertical offsets — no scaling, no fading of older toasts).
`confirm`: `--color-text-primary` fill, `--color-text-inverse` text, action in dark-theme accent. `error`: `--color-destructive` fill, `--color-text-inverse` text, action in `--color-text-inverse` with an underline, no auto-dismiss, plus a 24px close button.
**Tokens:** `--radius-lg`, `--shadow-overlay`, `--space-4`, `--text-sm`, `--duration-toast-in/out`, `--duration-undo`.
**ARIA:** container `role="status" aria-live="polite" aria-atomic="true"` for confirms; `role="alert" aria-live="assertive"` for errors. Never moves focus. The undo button is reachable by `Tab` and by `⌘Z` (which activates the newest undo without focusing it).

### C-12 Dialog

**Props:** `title`, `body`, `primaryAction`, `secondaryAction`, `tone` (neutral · destructive).
440px wide, `--radius-xl`, `--color-surface`, `--shadow-modal`, `--space-8` padding, over `--color-scrim`. Title `--text-xl`, body `--text-base` `--color-text-secondary`, actions right-aligned with `--space-3` gap, secondary first.
**States:** open, closing. No loading state — both dialogs act instantly.
**ARIA:** `role="dialog" aria-modal="true"`, labelled by the title and described by the body; focus moves to the **secondary** (Cancel) action on open; focus returns to the trigger on close; `Esc` closes; focus is trapped.

### C-13 Input / text field

**Props:** `label`, `placeholder`, `value`, `type`, `invalid`, `helperText`, `disabled`, `size` (md 40px · sm 36px).
`--color-surface` fill (light) / `--color-surface-sunken` (dark), 1px `--color-border-control`, `--radius-sm`, `--space-3` horizontal padding, `--text-base`.
**States:** default; hover (border `--color-text-tertiary`); focus-visible (standard ring, border becomes `--color-accent`); filled; invalid (border `--color-destructive`, helper text in `--color-text-destructive`, `aria-invalid="true"`); disabled (`--color-surface-sunken` fill, `--color-text-disabled` text, `--color-border-subtle` border).
Placeholder in `--color-text-tertiary`. Labels are always visible except in the rail search field and settings filters, which use `aria-label`.

### C-14 Checkbox

18px, `--radius-xs`, 1.5px `--color-border-control`. **States:** unchecked; hover (border `--color-text-primary`); checked (`--color-accent` fill, `--color-text-inverse` check glyph); indeterminate (`--color-accent` fill, `--color-text-inverse` 8px minus); focus-visible (standard ring); disabled (`--color-border-subtle`, `--color-surface-sunken` fill).
Native `<input type="checkbox">` with a styled pseudo-element; never a div.

### C-15 Switch

36 × 20px track, `--radius-full`, 16px thumb. **Off:** `--color-border-control` track, `--color-surface` thumb. **On:** `--color-accent` track, `--color-text-inverse` thumb. Hover darkens the track one step. Focus-visible: standard ring on the track. Disabled: `--color-border-subtle` track, `--color-text-disabled` thumb. Thumb travel: `transform var(--duration-fast) var(--ease-standard)`.
**ARIA:** `<button role="switch" aria-checked>`.

### C-16 Segmented control

Track `--color-surface-sunken`, `--radius-md`, 2px inner padding. Segment 32px, `--text-sm` 500, `--color-text-secondary`; selected segment `--color-surface` fill, `--color-text-primary`, `--radius-sm`, `--shadow-overlay` at 50% strength. Focus-visible on the individual segment. `←`/`→` move between segments when focused.
**ARIA:** `role="tablist"` with `role="tab"` children when it switches views (Screener); `role="radiogroup"` with `role="radio"` children when it sets a value (Appearance).

### C-17 Tabs (Settings → Senders)

36px, `--text-base` 500, `--space-4` horizontal padding, 2px bottom bar in `--color-accent` when selected, `--color-text-tertiary` when not. Bottom hairline runs the full width beneath all tabs. `←`/`→` move; `Home`/`End` jump.
**ARIA:** `role="tablist"` / `role="tab"` / `role="tabpanel"` with `aria-controls` and `id` wiring.

### C-18 Chip

**Props:** `kind` (filter · recipient · confirm-placeholder · tone), `label`, `count`, `removable`, `selected`.
28px (filter/tone), 24px (recipient), `--radius-full`, `--text-xs` 500. Filter chip: transparent, 1px `--color-border-control`; selected adds `--color-accent-subtle` fill and `--color-accent` border. Recipient chip: `--color-surface-sunken` fill, no border, 12px remove glyph. Confirm-placeholder chip: `--color-destructive-subtle` fill, `--color-text-destructive` text, `--font-mono`, not removable — replaced by typing over it.

### C-19 Nav item

Specified in §5.0. **Props:** `icon`, `label`, `count`, `countVariant`, `selected`, `compact`.
**States:** default, hover, focus-visible, selected, selected+hover, compact (icon only, 40×40, tooltip after 400ms).

### C-20 Empty state

**Props:** `headline`, `body`, `action` (optional), `secondaryAction` (optional), `visual` (none · blank-card · ring).
Centered in its region, max-width 420px, text left-aligned (not centered — centered paragraphs are harder to read and this product favors legibility). Headline `--display-md` (region-level) or `--text-lg` (component-level), `--space-3`, body `--text-md` `--color-text-secondary`, `--space-6`, actions.
The only two visuals in the product are the **blank card** (Screener empty) and the **outline ring** (no thread selected). No illustrations, no icons in empty states beyond these.

### C-21 Skeleton

Static tinted blocks in `--color-surface-sunken`, `--radius-xs`, no shimmer, no pulse (D33). Heights: text bar 12px, title bar 16px, circle matches the monogram size it replaces. Bar widths alternate 60% / 40% / 25% to suggest text. Rendered for a minimum of 200ms once shown, to avoid a flash.
**ARIA:** container gets `aria-busy="true"` and a visually hidden "Loading" text; individual bars are `aria-hidden`.

### C-22 Bulk action bar

56px, `--color-surface`, top hairline, `--shadow-overlay`. Slides up when the selection count > 0. Contents: count `--text-sm` 500 · spacer · action buttons · "Clear" tertiary.
**States:** hidden, entering, rest, acting (buttons in loading state, count frozen).
**ARIA:** `role="region" aria-label="Bulk actions"` with `aria-live="polite"` on the count.

### C-23 Progress bar

4px track `--color-surface-sunken`, fill `--color-accent`, `--radius-full`. **States:** determinate (width transitions), unknown-total (static 25% fill), complete (100%, holds), error (fill becomes `--color-destructive` and freezes at its last value).
**ARIA:** `role="progressbar"` with `aria-valuenow/min/max` and `aria-valuetext="4,312 of 11,908 threads"`.

### C-24 Autocomplete listbox

Max 6 rows at 40px, `--color-surface`, `--radius-md`, `--shadow-overlay`, 4px offset below the field. Row: 24px monogram · name `--text-sm` 500 · address `--text-xs` `--color-text-tertiary`. Active row `--color-surface-hover`.
**ARIA:** combobox pattern — the input carries `role="combobox" aria-expanded aria-controls aria-activedescendant`; rows are `role="option"`.

### C-25 Tooltip

Appears after 400ms hover or immediately on keyboard focus of an icon-only control. `--color-text-primary` fill, `--color-text-inverse` `--text-xs`, `--radius-sm`, `--space-2` padding, 8px offset, no arrow. Dismissed by `Esc`.
**ARIA:** the control keeps its `aria-label`; the tooltip is `aria-hidden` (it duplicates the label rather than replacing it).

### C-26 Offline banner

Specified in §5.14. **States:** hidden, visible, reconnecting (text becomes "Reconnecting…"). **ARIA:** `role="status"`.

### C-27 Provider connection panel

The component behind both O2 (§5.2) and the Provider block of Settings → Assistant (§5.13c). One component, two mounts.

**Props:** `provider` (`anthropic` · `openai` · `google` · `local` · `none`), `apiKey`, `baseUrl`, `model`, `status`, `mount` (`onboarding` · `settings`), `spend`, `lastCall`.

**Curated model lists** (the only values the select may offer):

| Provider | Endpoint | Models |
|---|---|---|
| Anthropic | `api.anthropic.com` | `claude-sonnet-4-5` (default), `claude-haiku-4-5` |
| OpenAI | `api.openai.com` | `gpt-5.1` (default), `gpt-5.1-mini` |
| Google | `generativelanguage.googleapis.com` | `gemini-3-pro` (default), `gemini-3-flash` |
| Local | user-supplied base URL | whatever `/api/tags` reports; no default until tested |

**Status states** — each is a dot colour plus a message, and each maps to one message in §7.6:

| Status | Dot | Message | Save enabled |
|---|---|---|---|
| `empty` | none | Your key is stored in this browser only. | no |
| `entered` | none | Press Test connection to check it works. | no |
| `testing` | `--color-text-tertiary` | Checking with Anthropic… | no |
| `connected` | `--color-accent` | Connected. Answered in 420 ms. | yes |
| `rejected` | `--color-destructive` | Anthropic rejected this key. Check it in your provider dashboard and paste it again. | no |
| `no-credit` | `--color-destructive` | Anthropic returned no credit on this account. Top up, or switch provider. | no |
| `unreachable` | `--color-destructive` | Nothing is answering at http://localhost:11434. Start your local model, then test again. | no |
| `offline` | `--color-destructive` | Couldn't reach Anthropic. Check your connection and test again. | no |

**Key field states:** empty · focus-visible (accent border + 3px accent glow at 16% opacity) · filled-masked · filled-revealed (10s timer) · invalid (destructive border, `aria-invalid="true"`) · disabled (local provider selected).

**Security rules, normative.** The key is written to `localStorage` under `pigeon.provider` and to no other store. It is never placed in a URL, a query string, a log line, an error message, or an analytics event. It is never rendered unmasked in the DOM except during an explicit 10-second reveal. On "Remove key" the entry is deleted synchronously before the toast renders. Pigeon has no server component that could receive it.

**Tokens:** `--color-surface`, `--color-surface-sunken`, `--color-accent`, `--color-accent-subtle`, `--color-destructive`, `--color-destructive-subtle`, `--radius-lg`, `--radius-md`, `--radius-sm`, `--space-2/3/4`, `--font-mono`, `--mono-sm`, `--text-sm/base`.

**ARIA:** the provider row is `role="radiogroup" aria-label="AI provider"` with `role="radio"` cards and arrow-key roving focus. The key input is `<input type="password">` with a visible `<label>`, `aria-describedby` pointing at the status line. The status line is `role="status" aria-live="polite"` so the result of a test is announced without moving focus. The Show control is `<button aria-pressed>` labelled "Show key" / "Hide key". The spend figure is plain text, not a live region.

### C-28 Degraded AI affordance

The shared treatment for any AI surface with no provider connected. **Never** an error, never a modal, never a nag.

| Surface | With provider | Without |
|---|---|---|
| Screener digest | AI block, tinted | Plain `--color-surface-sunken` block: "12 senders waiting." + "Connect a provider to get a weekly read on who's waiting." + tertiary link "Connect a provider" |
| Sender card | Pigeon's read section | Section omitted entirely; card shrinks |
| Thread header | Auto summary or "Summarize thread" | "Summarize thread" rendered disabled with tooltip "Connect a provider in Settings → Assistant" |
| Composer | "Draft with Pigeon" | Rendered disabled, with helper text beside it: "Connect a provider to draft replies." |
| Settings → Assistant toggles | Interactive | Disabled, `aria-disabled="true"`, with the provider block directly above showing `Not connected` |

The link in the digest is the only prompt to connect that appears anywhere in the running app. It appears once per surface, never as a banner, never as a toast, never on a timer.

---

## 7. Interface copy

**Voice rules for all product copy.** Sentence case everywhere including buttons. Active voice. Second person for the user ("your inbox"), third person for the product ("Pigeon holds", never "we hold" and never "I"). A button's label states the outcome and keeps that exact wording from the trigger through the confirmation. Numbers as numerals, always. No exclamation marks anywhere in the product. Never "please". Never "sorry". Never "oops". Never "just". Never "simply".

### 7.1 Navigation and structural labels

| Element | Copy |
|---|---|
| Nav | Inbox · Screener · Archive · Settings |
| Rail button | Compose |
| Rail search placeholder | Search mail |
| Screener view toggle | Stack · Bulk review |
| Settings sub-nav | Account · Senders · Assistant |
| Senders tabs | Approved (341) · Declined (28) |
| Search meta | 18 results · Inbox and Archive |
| Search option | Also search held mail |
| Date groups | Today · Yesterday · Monday · July 2026 |
| Search groups | Inbox · Archive · Held |

### 7.2 Buttons and actions

| Context | Label |
|---|---|
| Onboarding | Connect Gmail · Continue · Start sync again · Approve 342 senders · Continue with no approved senders · Untick all · Tick all · Go to inbox |
| Screener | Approve sender · Decline sender · Read message · Read 3 messages · Approve senders · Decline senders · Clear · Select all (12) |
| Thread | Reply · Reply all · Forward · Archive · Move to inbox · Summarize thread · Hide · Show images |
| Composer | Send · Draft with Pigeon · Shorter · Friendlier · Firmer · Discard draft · Discard · Cc Bcc · Attach file |
| Settings | Decline · Approve · Disconnect account · Sign out · Cancel |
| Provider | Test connection · Save and continue · Continue without the assistant · Show key · Hide key · Change · Remove key · Connect a provider |
| Recovery | Try again · Undo · Undo all · Connect Gmail · Contact support |

Approve and Decline keep those verbs everywhere: on the card, in bulk, in the sheet, in settings, and in every toast. Nothing in the product ever says "Confirm", "OK", "Yes", "Got it", "Dismiss", or "Submit".

### 7.3 Onboarding

- **O1 wordmark:** Pigeon
- **O1 subhead:** Mail from people you've chosen. Everyone else waits at the door.
- **O1 legal line:** Pigeon reads and sends mail on your behalf. It never sends anything you haven't seen.
- **O3 heading:** Setting up your inbox → (on completion) Your mail is ready.
- **O3 steps:** Connected marc@ferrum.dev · Read your contacts · Reading your mail history · Working out who you know
- **O3 counter:** 4,312 of 11,908 threads · Counting your threads
- **O4 heading:** Who already knows you?
- **O4 body:** These 342 people are in your contacts or you've written to them before. Their mail goes straight to your inbox. Everyone else starts in the Screener.
- **O4 zero-state helper:** Everything new will start in the Screener until you approve someone.
- **O5 heading:** Strangers wait at the door
- **O5 body 1:** Mail from someone new never lands in your inbox. It waits in the Screener until you decide.
- **O5 body 2:** Approve someone and their mail — this one and everything after — goes to your inbox. Decline and you never see them again. You can change your mind any time in Settings.
- **First-run toast:** Pigeon is holding 12 senders for you. → [Open Screener]

### 7.4 Empty states

| Screen | Headline | Body | Action |
|---|---|---|---|
| Inbox, day one | Your inbox is empty. | Mail from your approved senders lands here. Pigeon is holding 7 senders in the Screener — start there. | Open Screener |
| Inbox, day one, nothing held | Your inbox is empty. | Mail from your approved senders lands here. Nothing has arrived yet. | Send yourself a test |
| Inbox, cleared | Nothing left. | You've read everything. 7 senders are waiting in the Screener. | Open Screener |
| Inbox, cleared, nothing held | Nothing left. | You've read everything. | — |
| Screener | Nothing waiting. | New senders will appear here. You'll never miss them — they just don't interrupt you. | See who you've approved |
| Archive | Nothing archived yet. | Threads you archive from your inbox end up here. Nothing is ever deleted. | — |
| Reader, no selection | — | Select a thread to read it. | — |
| Search, no query | — | Search your mail by sender, subject, or words in the message. | — |
| Search, no results | No results for "atlas integration". | Try fewer words, or search a sender's address. | Also search held mail |
| Approved senders | No approved senders yet. | Anyone you approve in the Screener shows up here, with the date you approved them. | Open Screener |
| Declined senders | No declined senders. | When you decline someone in the Screener, they show up here — and you can let them back in any time. | — |
| Known senders, none found | Pigeon didn't find anyone to propose. | Everything new will start in the Screener until you approve someone. | Continue |

### 7.5 Toasts

| Trigger | Copy | Action | Duration |
|---|---|---|---|
| Approve one | Approved Dana Whitlock. Their mail is in your inbox. | Undo | 8s |
| Decline one | Declined marketing@northbound.io. You won't see their mail. | Undo | 8s |
| Approve many | Approved 9 senders. Their mail is in your inbox. | Undo all | 8s |
| Decline many | Declined 9 senders. You won't see their mail. | Undo all | 8s |
| Any undo | Decision undone. | — | 3s |
| Archive | Archived. | Undo | 8s |
| Move to inbox | Moved to inbox. | Undo | 8s |
| Send | Sent to Dana Whitlock. | Undo | 8s |
| Discard draft | Draft discarded. | Undo | 8s |
| Decline from settings | Declined Dana Whitlock. Their mail stays in your inbox; new mail stops. | Undo | 8s |
| Approve from settings | Approved marketing@northbound.io. Their next message goes to your inbox. | Undo | 8s |
| Assistant toggle off | Automatic summaries are off. | — | 3s |
| Assistant toggle on | Automatic summaries are on. | — | 3s |
| Provider saved | Connected to Anthropic. | — | 3s |
| Provider key removed | Removed your Anthropic key. | Undo | 8s |
| Provider changed | Switched to OpenAI. | Undo | 8s |
| Back online | Back online. | — | 3s |

### 7.6 Error messages

Every error states what happened, then what to do. No apology, no blame, no jargon.

| Situation | Copy | Action |
|---|---|---|
| OAuth denied | Pigeon didn't get access to your mail. Google needs permission to read and send on your behalf for Pigeon to work. Try connecting again. | Connect Gmail |
| Partial scopes | Pigeon needs all four permissions to sort your mail. Connect again and leave the checkboxes ticked. | Connect Gmail |
| Sync failed | Sync stopped at 4,312 of 11,908 threads. Gmail returned an error. Start sync again — Pigeon will pick up where it stopped. | Start sync again |
| Contacts unreadable | Pigeon couldn't read your contacts. You can approve senders one at a time in the Screener instead. | Try again · Continue |
| Gmail unreachable | Pigeon can't reach Gmail. Your mail is safe. This is a connection problem between Pigeon and Google. | Try again |
| Token revoked | Pigeon lost access to your mail. Google revoked Pigeon's permission. Connect your account again to keep using Pigeon. | Connect Gmail |
| Thread failed to load | This thread didn't load. It's still in Gmail. | Try again |
| Message failed to load | This message didn't load. | Try again |
| Summary failed | Summary unavailable. | Try again |
| Digest failed | 12 senders waiting. | Try again |
| Draft failed | Pigeon couldn't write a draft. Write your reply, or try again. | Try again |
| Send failed | Gmail didn't accept this message. Check the recipient addresses and send again. | Send again |
| Approve/decline failed | Couldn't approve Dana Whitlock. Check your connection and try again. | Try again |
| Bulk partial failure | Declined 7 of 9 senders. 2 didn't go through — try those again. | Try again |
| Search failed | Search didn't run. Try again. | Try again |
| Key rejected | Anthropic rejected this key. Check it in your provider dashboard and paste it again. | Test connection |
| No credit at provider | Anthropic returned no credit on this account. Top up, or switch provider. | Test connection |
| Local endpoint unreachable | Nothing is answering at http://localhost:11434. Start your local model, then test again. | Test connection |
| Provider unreachable | Couldn't reach Anthropic. Check your connection and test again. | Test connection |
| Provider rate-limited mid-use | Anthropic is rate-limiting Pigeon. Summaries and drafts will come back on their own. | — |
| No provider connected | Connect a provider to draft replies. | Connect a provider |
| Offline banner | You're offline. Pigeon is showing the mail it already has. | — |
| Offline send | You're offline. Pigeon will send this when you're back. | — |
| Unresolved placeholder | Replace [confirm: a time] before sending. | — |
| Invalid recipient | dana@lumen isn't a complete address. | — |
| Window too narrow | Pigeon needs a wider window. Open Pigeon on a screen at least 720 pixels wide. | — |

### 7.7 Dialogs

- **Disconnect:** Title "Disconnect marc@ferrum.dev?" Body "Pigeon will stop syncing and you'll be signed out. Your mail stays in Gmail, and your approved and declined senders are kept for 30 days." Actions: Cancel · Disconnect account.
- **Sign out:** Title "Sign out of Pigeon?" Body "You'll need to sign in with Google again. Nothing changes in your mail." Actions: Cancel · Sign out.

### 7.8 Assistant settings copy

**Provider block**

- Section label — "Provider"
- Empty state — "No provider connected. Pigeon's assistant is off." with a primary "Connect a provider".
- Status pills — "Connected" · "Not connected" · "Key rejected"
- Meta labels — "Endpoint" · "Key stored" · "Spend this month" · "Last call"
- Key-stored value — "This browser · never sent to Pigeon"
- Action-row note — "Stored in this browser only"

**O2 body copy**

- Heading — "Connect your AI provider"
- Body — "Pigeon doesn't run models of its own. Bring a key from a provider you already pay, or point Pigeon at a model running on your own machine. Your key is stored in this browser and sent only to the provider you pick."
- Provenance note, remote — "Pigeon has no servers of its own — your key never leaves this browser except to reach Anthropic. Rotate or remove it any time in Settings → Assistant."
- Provenance note, local — "Nothing leaves your machine. Pigeon talks to the endpoint above and nowhere else."
- Skip confirmation line — "The assistant is off. Turn it on any time in Settings → Assistant."

Never write "BYOK", "LLM", "token" (meaning API key), "credentials", "inference", or a provider's model family as a marketing name. Say "key", "provider", "model". Name the selected provider in every message about it — never "your provider" when the app knows it is Anthropic.

**Behaviour block**

- Summarize long threads automatically — "Pigeon writes a summary for threads with four or more messages."
- Read new senders for the Screener — "Pigeon adds a one-line read to each sender card and writes the weekly digest."
- Match my writing style in drafts — "Pigeon looks at mail you've sent to write drafts that sound like you."
- Footer — "Pigeon never sends anything you haven't read. Every draft opens in the composer for you to edit."

### 7.9 Voice rules for AI-generated content

These rules govern the model's output, not the UI chrome. They are part of the spec because the copy is product surface.

**Universal.** Never use the first person. Never address the user as "you" inside a summary (summaries describe the thread, not the reader). No hedging openers ("It looks like", "It seems", "It appears"). No meta-commentary ("Here's a summary"). No emoji. No exclamation marks. Never restate the subject line.

**Thread summary.** Maximum 3 bullets. Maximum 14 words per bullet. Each bullet is a complete statement of fact drawn from the thread, in past or present tense. Order: what changed, what the numbers are, what is being asked of the user. If the thread contains a deadline or a request directed at the user, that must be the final bullet and must name the person asking. Never speculate about intent. If the thread has no request, the third bullet is omitted rather than invented.

**Screener read.** Exactly one sentence. Maximum 18 words. It answers only "why might this matter to you", using evidence available in the message and in the user's own mail history. Preferred forms: "A warm intro from Dana Whitlock, who you email often." / "Cold sales mail from a list — no reply history." / "A support reply about a ticket you opened on Tuesday." Never a judgment word ("spam", "worthless", "important"), never an instruction ("you should approve this"), never a question.

**Screener digest.** One sentence with the total, then a breakdown by category with counts. Categories are chosen by the model from a fixed vocabulary: junk, newsletters, recruiters, sales, support, client inquiry, personal, unclear. Format: "12 senders held: 9 junk, 2 recruiters, 1 looks like a client inquiry." Hedge only on the smallest, most consequential group, using "looks like". Never more than four categories; the remainder folds into "other".

**Draft replies.** Match the register, greeting style, sign-off, and typical length of the user's own sent mail when the style setting is on; use a neutral professional register when it is off. Never longer than the message being replied to unless the reply must answer multiple questions. No new facts: every claim must be traceable to the thread. Any date, time, price, quantity, commitment, or attachment reference not present in the thread is emitted as `[confirm: what is needed]` — for example `[confirm: a time on Thursday]`. Never sign off with the user's full name unless the user's sent mail does. Never include a subject line change. Never add a postscript.

**Tone transformations.** *Shorter* — remove sentences, never compress into jargon; target 60% of the current length; keep every `[confirm:]` placeholder. *Friendlier* — add a greeting and a closing courtesy, soften imperatives to requests; do not add compliments or enthusiasm. *Firmer* — remove hedges and apologies, state the request as a direct ask with a deadline if one exists in the thread; do not add threats or escalation language.

---

## 8. Accessibility and quality floor

### 8.1 Keyboard map

The entire product is operable without a pointer. Shortcuts are single keys with no modifier except where noted, and are disabled while focus is inside a text field (except `Esc`, `⌘Enter`, and `⌘J`).

**Anywhere in the app**

| Key | Action |
|---|---|
| `g` then `i` | Go to Inbox |
| `g` then `s` | Go to Screener |
| `g` then `a` | Go to Archive |
| `g` then `,` | Go to Settings |
| `/` | Focus search |
| `c` | Compose |
| `?` | Keyboard shortcuts |
| `⌘Z` / `Ctrl+Z` | Undo the newest available action (activates the top toast's undo) |
| `Esc` | Close the topmost layer: dialog → sheet → autocomplete → composer → search |
| `Tab` / `Shift+Tab` | Move focus. Rail → list/region → reader → overlays, in DOM order |

**In a thread list (Inbox, Archive, Search, bulk review, sender lists)**

| Key | Action |
|---|---|
| `j` / `↓` | Cursor to next row |
| `k` / `↑` | Cursor to previous row |
| `Enter` / `o` | Open the cursor row |
| `e` | Archive the cursor row (Inbox) / move to inbox (Archive) |
| `x` | Toggle the cursor row's checkbox |
| `Shift+J` / `Shift+K` | Extend the checkbox selection down / up |
| `Home` / `End` | First / last row |
| `Esc` | Clear the selection |

**In a thread**

| Key | Action |
|---|---|
| `r` | Reply |
| `a` | Reply all |
| `f` | Forward |
| `e` | Archive and open the next thread |
| `u` | Back to the list (moves focus to the open row) |
| `⌘J` | Draft with Pigeon |
| `⌘Enter` | Send |

**In the Screener**

| Key | Action |
|---|---|
| `a` | Approve sender |
| `d` | Decline sender |
| `o` | Read message (opens the sheet) |
| `j` / `k` | Cycle to the next / previous card without deciding |
| `b` | Toggle Stack / Bulk review |
| `x` | Toggle the cursor row (bulk review only) |
| `⌘Z` | Undo the last decision |

`a` means "reply all" in a thread and "approve sender" in the Screener. The two contexts never appear on screen together, and the shortcuts dialog lists them under separate headings.

### 8.2 Focus treatment

- `outline: 2px solid var(--color-focus); outline-offset: 2px;` applied on `:focus-visible` only. Never `outline: none` without a replacement of equal or greater visibility.
- Contrast of the ring: `#0F5F55` on `--color-bg` = **6.96:1**; on `--color-surface` = **7.4:1**; dark theme `#4FBFA8` on `--color-surface` = **7.4:1**. All exceed the 3:1 requirement for non-text contrast.
- Where the ring would be clipped (list rows, table cells), it renders inset: `outline-offset: -2px`.
- **Focus is never stolen.** Toasts, banners, and background sync never move focus. Focus moves only on: route change (to the region's first heading, which carries `tabindex="-1"`), dialog open (to Cancel), sheet open (to the sheet's close button), composer open (to the first empty field), dialog/sheet close (back to the trigger).
- Skip link as the first focusable element on every route: "Skip to mail" → the list/region container.
- The keyboard cursor in a list is visually distinct from focus (see C-5): focus rings are `--color-focus`; the cursor is the same ring drawn inset, and the two coincide whenever the cursor row's button holds focus, which is the normal case.

### 8.3 Contrast conformance (measured against the actual tokens)

All values are computed contrast ratios. **Every text pairing in the product appears in this table.** AA requires 4.5:1 for text under 24px (or under 18.66px bold) and 3:1 for larger text and non-text UI.

**Light theme** — background `--color-bg #F3F5F4` (relative luminance 0.909), surface `--color-surface #FBFCFB` (0.971)

| Foreground | On | Ratio | Requirement | Result |
|---|---|---|---|---|
| `--color-text-primary #1B2027` | surface | **15.92:1** | 4.5 | pass |
| `--color-text-primary` | bg | **14.95:1** | 4.5 | pass |
| `--color-text-primary` | `--color-surface-ai #EFEEF8` | **14.24:1** | 4.5 | pass |
| `--color-text-primary` | `--color-surface-held #EDF1F0` | **14.38:1** | 4.5 | pass |
| `--color-text-primary` | `--color-surface-sunken #EDF0EF` | **14.26:1** | 4.5 | pass |
| `--color-text-secondary #4C5763` | bg | **6.72:1** | 4.5 | pass |
| `--color-text-tertiary #616D78` | bg | **4.84:1** | 4.5 | pass |
| `--color-text-tertiary` | surface | **5.16:1** | 4.5 | pass |
| `--color-text-ai #4C4A8A` | bg | **7.23:1** | 4.5 | pass |
| `--color-text-ai` | `--color-surface-ai` | **6.88:1** | 4.5 | pass |
| `--color-text-accent #0F5F55` | bg | **6.96:1** | 4.5 | pass |
| `--color-text-destructive #A32C22` | bg | **6.48:1** | 4.5 | pass |
| `--color-text-destructive` | `--color-destructive-subtle #F6E6E4` | **5.95:1** | 4.5 | pass |
| `--color-text-inverse #FBFCFB` | `--color-accent #0F5F55` | **7.62:1** | 4.5 | pass |
| `--color-text-inverse` | `--color-destructive #A32C22` | **7.09:1** | 4.5 | pass |
| `--color-text-inverse` | `--color-text-primary` (toast) | **15.92:1** | 4.5 | pass |
| `--color-accent` (toast undo, dark variant `#4FBFA8`) | `--color-text-primary #1B2027` | **7.39:1** | 4.5 | pass |
| `--color-border-control #78838E` | bg | **3.57:1** | 3.0 | pass |
| `--color-focus #0F5F55` | bg | **6.96:1** | 3.0 | pass |
| `--color-text-disabled #7E8A95` | bg | **3.22:1** | exempt (disabled) | pass by choice |
| Monogram ramp (6 fills) | `--color-text-inverse` | **4.6–6.1:1** | 4.5 | pass |

**Dark theme** — background `#12161A` (0.0073), surface `#1A2027` (0.0138)

| Foreground | On | Ratio | Requirement | Result |
|---|---|---|---|---|
| `#E7ECEF` primary | surface | **13.82:1** | 4.5 | pass |
| `#E7ECEF` primary | bg | **15.53:1** | 4.5 | pass |
| `#9AA6B0` secondary | surface | **6.62:1** | 4.5 | pass |
| `#8593A0` tertiary | surface | **5.02:1** | 4.5 | pass |
| `#A9A4E8` AI | surface | **7.18:1** | 4.5 | pass |
| `#A9A4E8` AI | `#22213A` AI surface | **6.31:1** | 4.5 | pass |
| `#4FBFA8` accent | surface | **7.39:1** | 4.5 | pass |
| `#E8776A` destructive | surface | **5.70:1** | 4.5 | pass |
| `#12161A` inverse | `#4FBFA8` accent fill | **6.85:1** | 4.5 | pass |
| `#6D7B88` border-control | surface | **3.48:1** | 3.0 | pass |
| `#647280` disabled | surface | **3.05:1** | exempt | pass by choice |

**Non-color redundancy.** Nothing in the product is communicated by color alone: unread has a dot *and* a weight change; AI content has a label *and* a tint; errors have text *and* an icon-free explicit message; the open thread row has a left bar *and* `aria-current`; approved/declined states in settings carry the word, not just the ink.

### 8.4 ARIA notes for non-obvious components

**The Screener card stack.** Only the top card exists for assistive technology.

```html
<section aria-label="Screener" aria-describedby="screener-count">
  <p id="screener-count" class="visually-hidden">3 of 12 senders waiting.</p>

  <!-- decorative cards behind -->
  <div aria-hidden="true" class="card card--behind"></div>
  <div aria-hidden="true" class="card card--behind"></div>

  <article class="card" tabindex="0"
           aria-labelledby="card-sender card-subject">
    <h2 id="card-sender">Sana Sethi</h2>
    <p>sana@northbound.io</p>
    <p id="card-subject">Intro to the Atlas team</p>
    <p>Hi Marc — Dana suggested I reach out…</p>

    <section aria-label="Pigeon's read of this sender">
      <span class="visually-hidden">Pigeon's read of this sender:</span>
      A warm intro from Dana Whitlock, who you email often.
    </section>

    <button>Decline sender</button>
    <button>Approve sender</button>
    <button>Read message</button>
  </article>

  <!-- announcements after every decision -->
  <div role="status" aria-live="polite" class="visually-hidden">
    Approved Sana Sethi. 11 senders waiting. Now showing QuickPitch.
  </div>
</section>
```

Rules: the cards behind are `aria-hidden` and `pointer-events: none`; the top card is the only focusable region and receives focus on route entry so single-key shortcuts work; after each decision the live region announces the outcome, the remaining count, and the new top sender in one utterance; the card itself never announces a change of contents through `aria-live` (that would double-announce with the status region). In bulk review the stack becomes a plain `role="list"` and the status region announces "9 selected" on selection change.

**Toasts.** The toast container is a permanently mounted `<div role="status" aria-live="polite" aria-atomic="true">` for confirmations and a separate `<div role="alert">` for errors — two regions, so an error is never queued behind a confirmation. Toasts never receive focus. The undo button is a real `<button>` in the tab order, placed in the DOM immediately after the message so a screen-reader user reaches it naturally. `⌘Z` triggers the newest undo without moving focus and announces "Decision undone." via the same status region. Auto-dismiss timers pause on `mouseenter` and on `focusin` and resume on leave. Error toasts never auto-dismiss (WCAG 2.2.1).

**Dialogs.** `role="dialog" aria-modal="true"`, `aria-labelledby` on the title and `aria-describedby` on the body. Focus moves to the secondary (Cancel) action on open — never to the destructive one. Focus is trapped between the first and last focusable elements. `Esc` closes and returns focus to the trigger element. The scrim is `aria-hidden` and clicking it closes the dialog (both dialogs are non-destructive to cancel).

**Held-message sheet.** Same as a dialog, plus: background scroll is locked via `overflow: hidden` on the shell, not by removing the scrollbar (avoid layout shift — use `scrollbar-gutter: stable`), and the sheet's decision buttons are inside the trap so `a`/`d` remain reachable.

**AI content.** Every AI block carries a visually hidden prefix (§4.7). A summary that arrives after the thread has rendered is announced once via its own `aria-live="polite"` container; a summary present at first render is not announced (it is in the reading order). The composer's AI draft sets `aria-describedby` on the body editor to the provenance row so a screen-reader user hears "Drafted by Pigeon" when entering the field, and the ink-change on edit updates that description to "Drafted by Pigeon, edited by you".

**Thread list.** `role="list"` / `role="listitem"`, not `listbox` — each row contains two interactive elements (a checkbox and the row button), which is invalid inside `role="option"`. Roving `tabindex` across the row buttons: exactly one row button has `tabindex="0"` at any time, the rest `-1`, so `Tab` enters and leaves the list in one step while `j`/`k` move within it. The open thread carries `aria-current="true"`. The list container has `aria-label="Inbox, 12 unread"` and updates that label when the count changes.

**Progress.** The sync progress bar uses `aria-valuetext` with the real counts, and the step list is an `<ol>` where each completed step's status glyph carries visually hidden text ("done", "in progress", "not started"). Progress updates are announced at most once every 10 seconds via a `role="status"` region, not on every tick.

**Icon-only controls.** Every one carries an `aria-label` that matches its tooltip word for word. No control anywhere in the product relies on a title attribute alone.

### 8.5 Quality floor checklist

The build is not complete until all of the following are true.

1. Every screen in §5 renders its specified empty, loading, and error states, reachable in a dev harness.
2. Every interactive element shows the focus ring on `:focus-visible` and none show it on mouse click.
3. The whole product is operable with the keyboard alone, including approving a sender, sending an AI-assisted reply, and reversing a decision.
4. Every text pairing in the running product matches a row in §8.3, in both themes.
5. `prefers-reduced-motion: reduce` removes all transform-based travel; no element moves.
6. No AI-generated string renders without its label and its visually hidden prefix.
7. No error string contains "sorry", "oops", "something went wrong", or an exclamation mark.
8. Every destructive-feeling action either offers undo for 8 seconds or shows a confirm dialog — never neither, never both.
9. At 720px the app is usable; at 719px it shows the width message; there is no horizontal scrollbar at any width between 720px and 2560px.
10. No text in the product renders below 11px, and no message body renders below 15px.

