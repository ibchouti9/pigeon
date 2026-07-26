# Pigeon

**Mail from people you've chosen. Everyone else waits at the door.**

Pigeon is a desktop web mail client for Gmail with one idea in it: mail from
someone new never lands in your inbox. It waits in the **Screener** until you
decide. Approve a sender and their mail — this message and everything after —
goes to your inbox. Decline and you never see them again.

Pigeon ships no inference of its own. You bring your own model: an API key for
Anthropic, OpenAI or Google, or a local endpoint (Ollama, LM Studio). The key is
stored in your browser and sent to no origin except the provider you pick. There
is no Pigeon server, so there is nothing to bill through and no shared key to
leak.

---

## Try it

```bash
npm install
npm run dev
```

Pigeon opens on a **demo mail account** — a seeded inbox, archive and Screener,
persisted to `localStorage`. No Google credentials are needed to run, review or
develop against it. Pick the **Demo** provider on the assistant step to see the
summaries, Screener reads and drafts with canned output, or paste a real key to
use a real model.

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
```

Nothing above `MailProvider` knows whether it is talking to Gmail or to the demo
account, and nothing above `AiClient` knows which model provider is connected.

## Connecting Gmail

Pigeon is a pure browser client, so it needs a Google OAuth **client ID** of your
own — there is no shared one, by design. Create a Web application client in the
[Google Cloud console](https://console.cloud.google.com/apis/credentials), add
your origin to the authorised JavaScript origins, and put the ID in `.env.local`:

```
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

Pigeon requests four scopes: read your mail, send on your behalf, modify labels,
and read your contacts. It never sends anything you haven't seen.

## Scripts

| | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and build |
| `npm run check` | Typecheck, lint and test |
| `npm test` | Vitest |

## Licence

MIT. See [LICENSE](LICENSE).
