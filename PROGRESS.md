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
- `src/ai/` — `AiClient` interface plus one adapter per provider (D41), and the
  hooks that wire it into the reader and the Screener.
- `src/store/` — zustand stores: `mail`, `settings`, `compose`, `toast`, `ui`.
- `src/components/primitives/` — C-1…C-28 from §6.
- `src/routes/` — one file per screen in §5.

## Status

| Area | State |
|---|---|
| Design tokens (§4.3) | done |
| Base styles, focus, a11y helpers (§8.2) | done |
| Domain types + `MailProvider` | done |
| Mock provider + demo seed + tests | done |
| Gmail provider (auth, MIME, REST) + tests | done, untested against a real account |
| Stores (mail, settings, compose, toast, ui) | done |
| Primitives C-1…C-28 | done |
| App shell, nav rail, global shortcuts | done |
| AI layer: 4 adapters + demo, prompts, hooks | done |
| Composer (§5.12, C-9) | done |
| Inbox + thread reader (§5.5–5.6) | in progress |
| Screener stack / bulk / sheet (§5.7–5.9) | in progress |
| O1–O5 onboarding (§5.1–5.4) | in progress |
| Settings (§5.13) | done |
| Archive (§5.10) | in progress |
| Search (§5.11) | todo |
| Quality floor checklist (§8.5) | todo |

## Deliberate deviations from the spec

Each of these is a considered call, not an oversight. Revisit if the spec wins.

1. **Curated Anthropic models** — §C-27 lists `claude-sonnet-4-5`; the code offers
   `claude-sonnet-5` and `claude-haiku-4-5`. D45's rationale is that the list is
   updated in one place, and shipping a stale default is worse than the edit.
2. **Body editor** — C-9 specifies a `contenteditable`. The code uses a
   `<textarea>` with a mirrored highlight layer, which renders `[confirm: …]` as
   a chip while keeping native caret, IME, undo and paste behaviour. A textarea
   already carries the role and `aria-multiline` C-9 asks for.
3. **A `demo` AI provider** — not in the spec. It returns canned assistant output
   so every AI surface can be run and reviewed without a key, and it is labelled
   as a demo wherever it appears. Choosing "none" still exercises C-28.
4. **Sender decisions in `localStorage`** — the Gmail provider keeps approve and
   decline decisions per account in the browser. A Gmail label cannot express
   "this address may reach me" for mail that has not arrived yet, and D41 rules
   out a server to sync them through. They do not follow the user across devices.

## Open items

- Search (§5.11) is not built.
- The Gmail path has never run against a real account: it needs a Google OAuth
  client ID in `.env.local` (see the README).
- Toast copy for two of the three Assistant toggles is extrapolated; §7.5 spells
  out only the summaries one.

## Notes

- npm's global cache has root-owned files on this machine, so `.npmrc` pins a
  project-local cache. Both are gitignored.
- The demo account persists to `localStorage` under `pigeon.demo`; provider
  settings under `pigeon.provider` (D42); Google's access token lives in
  `sessionStorage` and is never persisted.
