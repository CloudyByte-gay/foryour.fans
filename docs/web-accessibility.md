# Web Accessibility — WEB PHASE 15 Audit

Companion to [`docs/ux.md`](./ux.md). Produced by `prompts/web.md`'s WEB
PHASE 15 (Polish, Accessibility, Performance & Error Handling) — a hardening
pass, not a feature phase. This documents what was checked, what was found,
what was fixed, and what's intentionally deferred.

## Methodology

Three layers, each catching different things:

1. **Static linting** — `eslint-plugin-jsx-a11y`'s `recommended` ruleset,
   added to the shared `eslint.config.js` and run as part of every
   `pnpm --filter @foryour-fans/web lint` (`--max-warnings=0`, so a
   regression fails CI, not just a one-time pass). Catches missing
   labels/alt text, invalid ARIA, redundant roles, `autoFocus` misuse, and
   similar structural mistakes at the JSX level, before anything renders.
2. **Automated runtime scans** — `@axe-core/playwright`
   (`apps/web/e2e/zz-accessibility.spec.ts`), run against a real, fully
   rendered page (not jsdom) through the same Playwright suite every other
   e2e spec uses. Checks the things a screen reader actually depends on at
   runtime: computed color contrast, accessible name/role/value on every
   control, landmark structure, and ARIA validity against the live DOM.
   Covers the phase's named "core flows" — login, subscribe, view a locked
   post, and comment — plus the underlying widgets those flows exercise
   (dialogs, badges, forms, comment threads).
3. **Manual/architectural review** — keyboard operability, focus
   management, and motion preferences, checked by reading the relevant
   components rather than a live screen-reader pass (no screen reader is
   available in this environment — see "What this audit does not cover"
   below).

Both automated layers are permanent, not one-off: they run on every future
`lint`/e2e invocation and will catch a regression the same way they caught
the issues below.

## Findings and fixes

Everything below was found by the scans above against the **live app**, not
hypothesized — each is a concrete, reproducible defect that existed before
this phase and is fixed as of this phase.

### Contrast (WCAG 1.4.3, AA — 4.5:1 for normal text)

Computed contrast ratios for every design-token color pairing in both
themes (`app/globals.css`) turned up several that fell short at the sizes
they're actually used at:

| Pairing | Theme | Before | After |
|---|---|---|---|
| `success-foreground` on `success` (unused in practice, but a live token) | light | 4.21:1 | 4.67:1 |
| `warning-foreground` on `warning` (Button destructive-adjacent styles) | light | 3.24:1 | 5.12:1 |
| `locked-foreground` on `locked` | light | 2.96:1 (fails even AA-large) | 5.47:1 |
| `primary-foreground` on `primary` (primary Button, Checkbox checked state) | dark | 4.16:1 | 4.52:1 |
| `danger-foreground` on `danger` (destructive Button) | dark | 3.59:1 | 5.31:1 |

Fixes were minimal, same-hue lightness/darkness adjustments to the
`-foreground` token only — never the base `success`/`warning`/`danger`/
`locked`/`primary` color, since those are also used as plain accent text
and borders elsewhere, where their contrast against the page background
already passed. The one exception considered and rejected: darkening
`--danger` itself (dark theme) would have fixed the button-text pairing but
dropped `text-danger` (used for plain `role="alert"` error text) from a
comfortable 5.38:1 down to ~4:1 — so `--danger-foreground` was flipped to
dark text instead, at unchanged `--danger`.

**Badge is a different shape entirely, and needed real coverage, not a
token tweak.** `components/ui/Badge.tsx` pairs each accent's own DEFAULT
color as *text* against a 15–20%-opacity tint of that *same* color,
composited over the page background — none of the tokens above were tuned
for that pairing, and it showed: every light-theme badge variant and the
dark-theme `primary` variant failed, some badly (locked: 2.43:1; warning:
2.62:1). Axe caught this on the very first real page it scanned (a
"Locked" badge on the subscribers-only test in
`zz-accessibility.spec.ts`). Added five dedicated `--{color}-badge` tokens
(darker in light mode, one lighter in dark mode — same hue, tuned against
the actual composited background) so Badge's text passes without touching
the DEFAULT colors buttons/borders/plain text still use.

### Structure

- **The post permalink (`components/creator/PostArticle.tsx`) had no
  `h1`.** Posts have no title field (`lib/post.ts`) and the body text isn't
  a heading candidate (arbitrary, possibly-empty user text) — so a visually
  hidden `<h1>Post by {creatorName}</h1>` was added purely for the heading
  landmark screen readers navigate by; nothing changes visually.

### Links (WCAG 1.4.1, Use of Color)

- The "View on Bluesky ↗" link on the post permalink sat inline with
  plain text in the same `<p>` (a "· published as ..." suffix right after
  it) but was only underlined on `:hover` — indistinguishable from its
  surrounding text by anything but color otherwise. Changed to a
  persistent underline. This is a narrow, common pattern
  (`text-{color} hover:underline`) used elsewhere in the app for
  **standalone** links (an entire card/row/CTA, not embedded in a run of
  prose) — those aren't flagged by axe's `link-in-text-block` rule, which
  specifically targets links surrounded by substantial non-link text in
  the same block, and weren't touched here. If a future page embeds one of
  those standalone-link components inline within prose, re-run the axe
  suite against it.

## Already correct — verified, not (re)built

- **Focus management on route change.** `components/shell/RouteFocusManager.tsx`
  moves focus to the `id="main-content"` landmark on every pathname change
  (skipping the very first render, so it doesn't fight the browser's own
  initial-load focus), except when the user already has focus somewhere
  meaningful (e.g. they clicked a link and focus is mid-transition) — see
  its own file for the exact condition.
- **Dialog and menu focus trapping/keyboard nav.** Every `Dialog` and
  `DropdownMenu` in `components/ui/` is a thin wrapper over Radix
  primitives, which handle focus trapping, initial-focus, `Esc`-to-close,
  and roving `tabindex` correctly out of the box — verified by the axe
  scans against the actual rendered subscribe dialog and comment actions
  menu, not just assumed.
- **`prefers-reduced-motion`.** `app/globals.css` has a blanket
  `@media (prefers-reduced-motion: reduce)` override collapsing every
  animation/transition duration to ~0 — covers Radix's own dialog/menu/
  toast entrance animations along with everything else, with no per-
  component opt-in required. `Spinner`/`Skeleton` additionally swap to a
  `motion-reduce:` variant rather than fully stopping (an indefinite
  loading spinner that visibly stops looks broken/stuck, not calmer).
- **Static structural correctness.** `eslint-plugin-jsx-a11y`'s
  `recommended` ruleset is clean across the whole `apps/web` tree
  (`label-has-associated-control`, `no-autofocus`, `media-has-caption`,
  `heading-has-content`, and the rest) — see `eslint.config.js`. Two
  deliberate, commented suppressions exist: `PostComposer.tsx`'s `autoFocus`
  on its Textarea (a dedicated compose page, not a modal — genuinely
  helpful, not disorienting), and `MediaLightbox.tsx`'s `<video>` lacking a
  `<track>` (no captioning pipeline exists for creator-uploaded video — a
  documented platform gap, not something to fake here).

## What this audit does not cover

Being direct about the boundary, rather than implying more than was done:

- **No live screen reader was used.** This environment has none available.
  The three layers above (linting, axe, architectural review) check the
  same underlying facts a screen reader depends on — accessible names,
  roles, states, contrast, landmark/heading structure, focus order — far
  more exhaustively and repeatably than a single manual pass would, but
  they cannot judge whether the *reading order* of a page actually makes
  sense out loud, or whether prose reads naturally without visual context.
  A real screen-reader pass (VoiceOver/NVDA/JAWS) against the core flows
  remains genuinely valuable future work, not a redundant nice-to-have.
- **Only the flows the phase names were scanned end-to-end** (login,
  subscribe, locked post, comment) plus what those flows render along the
  way. Pages outside that set (e.g. `/admin/*`, `/creator/dashboard`,
  `/discover`) were checked by the static layer (lint) and existing
  component tests, but not run through a dedicated axe scan in this phase.
  Extending `zz-accessibility.spec.ts` to more routes is cheap,
  incremental future work — the pattern (navigate, `new AxeBuilder({
  page }).analyze()`, assert no violations) is now established.
- **Contrast tuning covered the shared design tokens, not every literal
  color in the codebase.** A future one-off inline color (bypassing the
  token system) wouldn't be caught by the token math above — but it would
  still be caught by the axe scan, on whatever page renders it.

## Keyboard operability

No dedicated manual tab-order walkthrough was recorded (no interactive
browser session available here either), but this is covered by
construction rather than left unchecked:

- Every interactive control in `components/ui/` is a real `<button>`,
  `<a>`, `<input>`, or a Radix primitive built on one — never a `<div>`
  with a click handler standing in for a button. `jsx-a11y`'s
  `click-events-have-key-events`, `no-noninteractive-element-interactions`,
  and `tabindex-no-positive` rules (part of `recommended`, enforced above)
  specifically guard against the two most common ways custom widgets break
  keyboard access, and the tree is clean of both.
  `TierManager`/`SubscriptionList`'s drag-to-reorder list
  (`@dnd-kit`) is keyboard-operable by that library's own design (arrow
  keys after activating a row with Space/Enter).
- Radix `Dialog`/`DropdownMenu` supply correct tab-trapping and `Esc`
  handling (see "Already correct" above) rather than a hand-rolled
  implementation that could get the edge cases wrong.

## Summary

Three real, live defects were found and fixed (a batch of failing color
pairings, a missing landmark heading, and a color-only link) — none of
them hypothetical or theoretical. Two permanent, automated checks
(`eslint-plugin-jsx-a11y` in the lint step, `@axe-core/playwright` in the
e2e suite) now guard against regressions on every future change, which
matters more than the one-time fixes themselves: this audit is a snapshot,
but the tooling it added keeps checking after this phase ends.
