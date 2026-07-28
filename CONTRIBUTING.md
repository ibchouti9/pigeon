# Contributing to Pigeon

## Signing the CLA

The first pull request you open gets a bot comment asking you to sign the
[Contributor License Agreement](CLA.md). One reply, once, and never again.

Pigeon is Apache 2.0 and stays that way. The agreement exists so the project
can add a commercially licensed edition later without needing every past
contributor to agree individually — which is a problem projects discover years
in, when everyone has changed jobs. You keep the copyright on your work.

## The spec is the source of truth

[`docs/design/SPEC.md`](docs/design/SPEC.md) is a complete build specification.
Every value in it is final: colours, sizes, durations, copy, keyboard bindings,
ARIA. Where the code and the spec disagree, **the spec is right and the code is a
bug**.

If you think the spec is wrong, say so in the pull request and change it in the
same change. A deviation that isn't written down is a deviation that gets
reverted by the next person. Current deliberate deviations are listed in
[`PROGRESS.md`](PROGRESS.md).

## Getting set up

```bash
npm install
npm run dev
```

The app boots on a seeded demo mail account, so you never need Google
credentials to work on it. `npm run check` runs typecheck, lint and tests.

## House rules

**Never hard-code a value that has a token.** Colours, spacing, radii, durations
and layout widths all live in `src/styles/tokens.css`, which is §4.3 verbatim.
Type comes from the global `t-*` utility classes, not from per-component font
declarations.

**Copy is not yours to improvise.** §7 gives the exact wording for every button,
empty state, toast, error and dialog. No "sorry", no "oops", no "please", no
"just", no "simply", and no exclamation marks anywhere in the product. Errors
state what happened, then what to do.

**Every AI-generated string carries its label.** §4.7 is normative: AI content
sits on the AI tint or in AI ink, carries a visible `◆` label, and carries a
visually hidden prefix for screen readers. The moment a user edits it, the tint
clears and the label says so. There is no such thing as unlabelled model output
in this product.

**Every destructive-feeling action offers undo or confirms — never both, never
neither.** D11 allows exactly two confirm dialogs in the whole product: Sign out
and Disconnect Google account. Everything else gets an 8-second undo toast.

**Nothing is communicated by colour alone.** Unread is a dot *and* a weight
change. AI content is a tint *and* a label. Counts are never red.

## Before you open a pull request

Open `/dev/states` and look at the screen you touched under `empty`, `loading`
and `error`. Most of the bugs found in this codebase so far were invisible to
typecheck, lint and the test suite, and turned up by looking at a running
screen in a state nobody had looked at.

Then work through the relevant rows of §8.5:

- Does every state you touched render — empty, loading and error?
- Does the focus ring appear on `:focus-visible` and not on mouse click?
- Can you complete the flow with the keyboard alone?
- Does `prefers-reduced-motion: reduce` remove all travel?
- Is there a horizontal scrollbar at any width between 720px and 2560px?

## Tests

Vitest and Testing Library. Test behaviour the spec names, not implementation
detail — "declining silences without touching the inbox" is a good test;
"`decideSender` sets `status`" is not.

**Check that your test bites.** After writing a regression test, break the fix
on purpose — delete the guard, revert the line — and confirm the test fails.
Several tests in this codebase passed against the bug they were written for
until they were checked this way; one asserted a cap that *was* the bug. A test
that cannot fail is worse than no test, because it reads as coverage.

**A mutation that doesn't fail is a finding about the test.** Not a pass — a
result to explain. Either the code you broke was unreachable, in which case
delete it rather than leaving it there untested, or the test isn't reaching what
you think. Both have happened here: a guard that could never fire because an
earlier line already covered it, and a test whose harness put two hooks in one
component when the bug depends on one being a child of the other.

**Aim the mutation at the line you mean.** Anchor on enough surrounding context
to be sure — two checks in this codebase silently patched an identically written
element earlier in the same file and proved nothing while appearing to pass.

**Some rules jsdom cannot express.** Effect ordering between a parent and a
child, hover on a disabled control, anything about layout. Where the browser is
the only honest witness, say so in the commit rather than letting a green test
imply cover it doesn't give.

## Commits

Small and focused. Explain *why* in the body, not what — the diff already says
what. Reference the spec section or decision number when a change exists because
the spec says so.
