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
- `src/ai/` — `AiClient` interface plus one adapter per provider (D41).
- `src/store/` — zustand stores: `mail`, `settings`, `compose`, `toast`, `ui`.
- `src/components/primitives/` — C-1…C-28 from §6.
- `src/routes/` — one file per screen in §5.

## Status

| Area | State |
|---|---|
| Design tokens (§4.3) | done |
| Base styles, focus, a11y helpers (§8.2) | done |
| Domain types | done |
| MailProvider interface | done |
| Mock provider + demo seed | done |
| Stores (mail, settings, compose, toast, ui) | done |
| C-1 Button, C-2 Icon, C-3 Monogram, C-7 Postmark | done |
| C-11 Toast, C-12 Dialog | done |
| App shell, nav rail, global shortcuts | done |
| Remaining primitives (C-4…C-28) | todo |
| O1–O5 onboarding (§5.1–5.4) | todo |
| Inbox + thread reader (§5.5–5.6) | todo |
| Screener stack / bulk / sheet (§5.7–5.9) | todo |
| Archive (§5.10) | todo |
| Search (§5.11) | todo |
| Composer (§5.12) | todo |
| Settings (§5.13) | todo |
| AI layer + adapters (D41–D47) | todo |
| Gmail adapter | todo |
| Quality floor checklist (§8.5) | todo |

## Notes

- npm's global cache has root-owned files on this machine, so `.npmrc` pins a
  project-local cache. Both are gitignored.
- The demo account persists to `localStorage` under `pigeon.demo`; provider
  settings under `pigeon.provider` (D42).
