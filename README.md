# Pigeon

**Mail from people you've chosen. Everyone else waits at the door.**

Pigeon is a macOS mail client for Gmail with one idea in it: mail from someone
new never lands in your inbox. It waits in the **Screener** until you decide.
Approve a sender and their mail — this message and everything after — goes to
your inbox. Decline and you never see them again.

Pigeon ships no inference of its own. You bring your own model: an API key for
Anthropic, OpenAI or Google, or a local endpoint (Ollama, LM Studio). The key is
stored on your machine and sent to no origin except the provider you pick.

**There is no Pigeon server.** Nothing to bill through, no shared credential to
leak, and nothing between you and Google. That is a deliberate constraint rather
than a stage — it is also why connecting Gmail takes a five-minute detour
through Google's console the first time.

---

## Try it

```bash
npm install
npm run app
```

That builds and opens the macOS app. Pigeon starts on a **demo mail account** —
a seeded inbox, archive and Screener, persisted locally — so the whole product
is walkable in the first ten seconds, with no Google account and no API key.
Press **Connect Gmail** when you want real mail; see
[Connecting Gmail](#connecting-gmail) for what that involves.

Pick the **Demo** provider on the assistant step to see the summaries, Screener
reads and drafts with canned output, or paste a real key to use a real model.

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
| **Screener** | A one-card-at-a-time review stack for senders you don't know. `a` approves, `d` declines, and a whole week clears in two keys. Bulk review exists for obvious junk. |
| **Postmark** | The signature element: a circular ink impression, stamped onto a sender card at the moment of decision, and kept permanently as that sender's record. |
| **Assistant** | Thread summaries, a one-line read on each held sender, a weekly digest, and reply drafting with three tone controls. Every AI surface degrades to its underlying content when no provider is connected — a missing key never looks like a broken app. |
| **No delete** | Archive is the only removal action. Declining silences a sender; it never deletes their mail. Every destructive-feeling action offers 8 seconds of undo. |
| **Keyboard** | The whole product is operable without a pointer, including approving a sender, sending an AI-assisted reply, and reversing a decision. Press `?` for the map. |

## Architecture

```
src/
  types/        domain model shared by every provider
  data/         MailProvider interface
    mock/       the seeded demo account (works with no credentials)
    gmail/      the real Gmail REST client
  ai/           AiClient interface + one adapter per provider
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
  src/google.rs the installed-app OAuth flow: PKCE, loopback, Keychain
  src/lib.rs    the commands the webview may call
```

Nothing above `MailProvider` knows whether it is talking to Gmail or to the demo
account, and nothing above `AiClient` knows which model provider is connected.

The same source builds twice. `src/lib/desktop.ts` is the only place that asks
which build it is in, and the answer changes three things: how Google sign-in
works (`data/gmail/auth.ts`), whether outbound requests go through Rust
(`lib/http.ts`), and whether the in-app Google setup exists at all. Every Tauri
import is dynamic, so none of it reaches the web bundle.

## Connecting Gmail

Open the macOS app, press **Connect Gmail**, and it walks you through it. The
five console steps, their deep links, and the file you end up with are all in
the app — this section is the same walk written down, not a prerequisite for it.

### Why there's a setup at all

Reading someone's mail needs the `gmail.modify` scope, which Google classes as
**restricted**. An app that ships its own OAuth client and lets strangers sign
in has to pass a paid third-party security assessment (CASA) first. Pigeon
hasn't, so instead each person registers their own client. It is about five
minutes, once per machine, and it means Pigeon has no shared credential to leak
and no per-user quota to run out of.

### The five minutes

1. **Make a project** — [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate)
2. **Enable the Gmail API** — [one button](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
3. **Enable the People API** — [also one button](https://console.cloud.google.com/apis/library/people.googleapis.com).
   Optional: it is how Pigeon reads your contacts, and skipping it just means
   Pigeon works out who you know from mail you have sent instead.
4. **Consent screen** — [External, any app name, your own email](https://console.cloud.google.com/auth/overview).
   Then add your own Google address under **Audience → Test users**. Miss this
   and Google refuses at the last step with `access_denied`.
5. **Create the client** — [Credentials → Create client → **Desktop app**](https://console.cloud.google.com/auth/clients),
   then use the download button on the row it makes.

Drop that JSON file anywhere on the Pigeon window. It goes into the macOS
Keychain and never enters the webview.

**Desktop app, not Web application.** Installed-app clients need no registered
redirect URI, so the commonest bring-your-own failure — an authorised origin
that doesn't match the port you happen to be on — cannot happen. The client
secret Google issues alongside it is not confidential for this client type; PKCE
is what secures the exchange.

### What to expect while the client is unverified

Your project stays in **Testing**, which means the account you sign in with must
be on the test-user list, and **a test user's grant expires after seven days**.
After that the next request fails and Pigeon shows the reconnect screen — that
is the app behaving correctly. Connect again.

If your Google account is on a Workspace domain you can set the consent screen
to **Internal** instead: no test-user list, no seven-day expiry, no unverified
warning.

### The web build

`npm run dev` serves the same app in a browser, where none of the above is
available: a browser can neither hold a refresh token safely nor listen on a
loopback port. It reads `VITE_GOOGLE_CLIENT_ID` from `.env.local` if you have
set one — a **Web application** client, with your origin registered — and
otherwise offers only the demo account. The desktop app is the supported way to
reach real mail.

## Scripts

| | |
|---|---|
| `npm run app` | Build and run the macOS app |
| `npm run app:build` | Bundle `.app` and `.dmg` into `src-tauri/target/release/bundle/` |
| `npm run app:test` | The Rust tests |
| `npm run dev` | Dev server, in a browser |
| `npm run build` | Typecheck and build the frontend |
| `npm run check` | Typecheck, lint and test |
| `npm test` | Vitest |

The desktop shell needs a Rust toolchain ([rustup.rs](https://rustup.rs)); the
web scripts do not.

## Licence

MIT. See [LICENSE](LICENSE).
