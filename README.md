# Pigeon

**Mail from people you've chosen. Everyone else waits at the door.**

Pigeon is a mail client for Gmail — macOS and iPhone — with one idea in it: mail from someone
new never lands in your inbox. It waits in the **Screener** until you decide.
Approve a sender and their mail — this message and everything after — goes to
your inbox. Decline and you never see them again.

Once a sender is through the door, **lanes** split what they send: People,
Reading, Offers, Receipts, Alerts. Not five permanent tabs decided by a server
you cannot see — a derived read over the same list, computed from header and
wording evidence, showing its reasoning, and correctable per sender forever
with one click.

And the model does not only answer — it notices. Pigeon reads your
conversations for what they still ask of you, keeps that as a **Ledger**, opens
on a **Today** page built from it, and has an **assistant** that can act on
your mail with exactly as much freedom as you give it.

Pigeon ships no inference of its own. You bring your own model: an API key for
Anthropic, OpenAI or Google, or a local endpoint. If Ollama or LM Studio is
already running when you open the assistant screen, Pigeon finds it and fills
the fields in — no key, and nothing leaves your Mac. (A phone has no loopback
to find one on, so the iPhone build offers the three hosted providers and the
demo.) The key, if you use one,
is stored on your machine and sent to no origin except the provider you pick.

**There is no Pigeon server.** Nothing to bill through, no shared credential to
leak, and nothing between you and Google — Pigeon talks to Gmail's own IMAP and
SMTP servers directly, and your app password never leaves your device's Keychain.

---

## Try it

```bash
npm install
npm run app
```

That builds and opens the macOS app; `npm run ios` does the same on an iPhone
or the simulator (see [On your iPhone](#on-your-iphone) for the one-time setup
that needs). Pigeon starts on a **demo mail account** —
a seeded inbox, archive and Screener, persisted locally — so the whole product
is walkable in the first ten seconds, with no Google account and no API key.
Press **Connect Gmail** when you want real mail; see
[Connecting Gmail](#connecting-gmail) for what that involves.

Pick the **Demo** provider on the assistant step to see the assistant surfaces
with canned output, or connect a real model. If you already run Ollama, this
step is two clicks: Pigeon has found it by the time the screen renders.

A 3B model is enough for most of it. Pigeon asks its model for three bullets,
one sentence, a lane name or a three-sentence answer, never for an essay —
`llama3.2:3b` answers all of them in about a second on an M-series laptop, and
everything it returns is parsed leniently and thrown away if it comes back
malformed. The Ledger and the assistant read whole conversations and are
happier on something larger; `qwen2.5:32b` is what they were built against.

`npm run ai:probe` runs every surface against whatever model is on
`localhost:11434` and writes the transcript to a file. A prompt change is a
behaviour change with no type checker behind it, and that is the only thing
that catches one.

`npm run dev` serves the same app in a browser instead, which is faster to
iterate on and is what the tests run against. Real Gmail needs the desktop
build.

### Seeing the awkward states

Empty inboxes, hung requests, a revoked token, a half-failed bulk action, an
account with a decade of mail in it — the states that are hardest to reach and
easiest to get wrong. `/dev/states` lists every screen against seven provider
scenarios and opens the real route with that scenario applied, so each state is
reached through the screen's own code rather than a fixture.
`?scenario=empty|loading|error|revoked|flaky|crowded` works on any route
directly. `crowded` is the one that finds performance bugs: 800 threads, 120
held senders, and every thread 40 messages long. Dev builds only.

## Status

MVP, under active development. Built against
[`docs/design/SPEC.md`](docs/design/SPEC.md) — a complete design specification
covering information architecture, every screen state, the token system, the
component inventory, all interface copy, and an accessibility floor. The spec is
normative: where the code and the spec disagree, the spec is right and the code
is a bug.

## What's in the box

| | |
|---|---|
| **Screener** | A one-card-at-a-time review stack for senders you don't know. `a` approves, `d` declines, and a whole week clears in two keys. With a model connected, each card says what Pigeon would do and why, and bulk review selects all of one kind at once — it proposes, and never decides. |
| **Lanes** | The inbox split into People, Reading, Offers, Receipts and Alerts, on evidence rather than on a tab someone else chose. `0`–`5` switch between them. Every thread's lane is one click from the sentence explaining it, and one more from overruling it for that sender permanently. |
| **Ask your mail** | Type a question into search and Pigeon answers it from the threads that matched, with every claim numbered and linked to the message it came from. It reads those results and nothing else, so "Not in this mail." is an answer it can give. |
| **Postmark** | The signature element: a circular ink impression, stamped onto a sender card at the moment of decision, and kept permanently as that sender's record. |
| **Ledger** | What your mail is actually asking of you, in three groups: what people asked and have not had, what you promised, and what you are waiting on. Pulled out of the conversations themselves — "decide the liability cap · Dana Whitlock · Friday" — with the deadline copied from the mail rather than guessed at, and nothing invented: an obligation has to be supported by the words of its own conversation. |
| **Today** | The mailbox in one page: what arrived, what has a date on it, what nobody has come back to you about. Composed rather than generated — every number is counted and every line is a real thread, because a brief that is confidently wrong about a quiet morning is worse than no brief. |
| **Assistant** | Ask about your mail or tell Pigeon what to do with it, and watch each step as it happens. Seven tools, sorted by who finds out: reads are free, archiving and drafting are yours to undo, and sending or declining a sender always asks. How much it may do on its own is a setting — ask first, undoable things, or anything. |
| **AI surfaces** | Thread summaries, Screener triage, lane sorting, mail answers, and reply drafting with three tone controls. Every one degrades to its underlying content when no provider is connected — a missing key never looks like a broken app, and lanes still sort without one. |
| **No delete** | Archive is the only removal action. Declining silences a sender; it never deletes their mail. Every destructive-feeling action offers 8 seconds of undo. |
| **Keyboard** | The whole product is operable without a pointer, including approving a sender, sending an AI-assisted reply, and reversing a decision. Press `?` for the map. |

## Architecture

```
src/
  types/        domain model shared by every provider
  data/         MailProvider interface
    decisions.ts  §2.3's sender-decision machine, shared by every real provider
    lanes.ts      the deterministic inbox classifier; runs with no model at all
    triage.ts     what Pigeon would do with a held sender, on the same evidence
    query.ts      a search query as terms, and how well a thread answers it
    mime.ts       body reading rules + the RFC 2822 builder for outgoing mail
    mock/         the seeded demo account (works with no credentials)
    imap/         the real provider: maps the Rust engine into the domain
  ai/           AiClient interface + one adapter per provider
    detectLocal.ts  finds the model already running on this machine
    prompts.ts      every system prompt, and the parsers for what comes back
    useLedger.ts    the pass that reads conversations for what is outstanding
    useAgent.ts     the agent loop: one action a turn, result fed back
    tools.ts        what the agent may do, and which autonomy level covers it
  store/        zustand stores: mail, settings, compose, toast, ui
  components/
    primitives/ C-1…C-28 from the spec's component inventory
    shell/      nav rail, toasts, overlays
    mail/       thread list, reader, message blocks
    screener/   card stack, bulk review, held-message sheet
    compose/    the composer, inline and docked
  routes/       one file per screen
  styles/       the design token block, verbatim from the spec
src-tauri/
  src/mail/     the engine: IMAP session, fetch, act, SMTP send, MIME parse
  src/lib.rs    the twelve commands the webview may call
```

Every AI surface in Pigeon has a deterministic half that runs first and a model
half that is asked only about what the first could not settle. Lanes sort most
of a mailbox from a `List-Unsubscribe` header and a reply history; the model
sees the ambiguous remainder. Screener triage is the same shape and honest
about where the value is — the rules settle two of the demo's twelve, because
telling a mail-merged recruiter from a real one is not a regular expression's
job. The split means a missing key costs you the hard cases and nothing else,
and that every model answer arrives with a confidence the code can act on.

Nothing above `MailProvider` knows whether it is talking to Gmail or to the demo
account, and nothing above `AiClient` knows which model provider is connected.
The split across the language boundary follows the same idea: Rust owns
connections, MIME and Gmail's IMAP extensions; TypeScript owns every product
rule — what is visible where, who is held, what a decision does.

The same source builds twice. `src/lib/desktop.ts` is the only place that asks
which build it is in, and the answer changes two things: whether real mail is
reachable at all (`data/imap/`), and whether AI requests go through Rust
(`lib/http.ts`) instead of a CORS-bound `fetch`. Every Tauri import is dynamic,
so none of it reaches the web bundle.

## Connecting Gmail

An email address and an **app password**. The whole setup is one visit to one
Google page:

1. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   (two-step verification has to be on — most accounts already have it).
2. Create one, name it anything, copy the 16 characters.
3. Paste them into Pigeon's welcome screen.

Pigeon verifies the pair with a real sign-in before storing anything, and every
refusal comes back in words: a wrong password, an ordinary Google password
where the app password should be, IMAP switched off — each says what to do.

The password goes into the device Keychain and is sent only to
`imap.gmail.com` and `smtp.gmail.com`. It never expires, there is nothing to
re-consent to, and revoking it (from the same Google page) shuts Pigeon out
instantly.

**Why this and not OAuth?** Reading mail needs a Google OAuth scope classed as
*restricted*, and an app that ships its own OAuth client has to pass a paid
security assessment first — or every user must register a Google Cloud project
of their own, which is a five-step console walk nobody should have to make.
An app password needs neither. The trade, stated plainly: it grants full
account access rather than four scopes (it stays on your machine), and Google
offers app passwords for personal accounts only — Workspace admins disabled
them fleet-wide in 2024. An earlier revision of Pigeon carried the full
OAuth/PKCE flow; it lives in git history should Workspace support ever justify
resurrecting it.

### The web build

`npm run dev` serves the same app in a browser, which can neither hold mail
credentials nor open a TCP socket — so it offers the demo account only. It is
the fastest way to iterate on the UI and is what the tests run against; the
macOS and iPhone apps are how real mail is read.

## On your iPhone

Same repo, same Rust engine, same screens — Tauri builds an iOS app from the
source that builds the Mac one. Below 720px the app mounts a different shell:
a bottom tab bar instead of the rail, one screen at a time instead of two
panes, swipe-to-archive instead of a button that appears on hover.

**One-time setup.** Three downloads and an Apple account you may already have.

- **Xcode**, the full app from the App Store — not just the Command Line Tools.
  Open it once so it finishes installing its components, then point the
  toolchain at it:
  `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- **The iOS Rust targets**:
  `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`.
- **CocoaPods**: `brew install cocoapods`.
- **An Apple Developer account.** The free tier signs an app that runs on your
  own device and expires after 7 days; the paid one ($99/yr) signs for a year
  and reaches TestFlight.

Then generate the Xcode project, once:

```bash
npm run tauri ios init
```

**Running it.** `npm run ios` builds and launches on a connected iPhone or in
the simulator. Signing needs your team id; set it in the environment so it
stays out of the repo:

```bash
export APPLE_DEVELOPMENT_TEAM=XXXXXXXXXX
```

On the phone, the first launch of a free-tier build needs Settings → General →
VPN & Device Management → trust the developer.

**What is different on a phone.** The app password goes into the iOS Keychain
rather than the Mac one, and is still sent only to Gmail. The local-model
provider is not offered: iOS suspends every app that is not in front, so
nothing can be listening on loopback for Pigeon to talk to. Bring a key from
Anthropic, OpenAI or Google, or run the demo.

**What is not built.** Nothing fetches mail while the app is closed. iOS
suspends the process and the IMAP connection dies with it; Pigeon reconnects
when you come back, so new mail arrives when you open the app rather than
before. Real background delivery needs either `BGAppRefresh` — best-effort,
minutes to hours — or a push proxy, and Gmail's IMAP offers no push a client
can consume directly.

## Scripts

| | |
|---|---|
| `npm run app` | Build and run the macOS app |
| `npm run ios` | Build and run on a connected iPhone or the simulator |
| `npm run ios:build` | Build a signed `.ipa` |
| `npm run app:build` | Bundle `.app` and `.dmg` into `src-tauri/target/release/bundle/` |
| `npm run app:test` | The Rust tests |
| `npm run dev` | Dev server, in a browser |
| `npm run build` | Typecheck and build the frontend |
| `npm run check` | Typecheck, lint and test |
| `npm test` | Vitest |
| `npm run ai:probe` | Every AI surface against a live model, transcript to a file |

The desktop shell needs a Rust toolchain ([rustup.rs](https://rustup.rs)); the
web scripts do not.

## Licence

Apache 2.0. See [LICENSE](LICENSE).

Use it, fork it, ship it, sell it — the licence asks only that you keep the
attribution and note what you changed. It also grants you a patent licence from
every contributor, which MIT does not.

"Pigeon" and the postmark mark are not covered by it. A fork is welcome; a fork
called Pigeon is confusing to the people it's for.
