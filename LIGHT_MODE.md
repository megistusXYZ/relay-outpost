# Light mode

Dark mode was designed. Light mode was inherited — and it shows. This is the plan of record
for closing that gap, and the first time it has been written down in the repo rather than
carried in someone's head.

## The problem, measured

The original audit of `client/src` found **colour sprawl**, not a colour *choice*:

| | |
|---|---|
| violet + purple + indigo + fuchsia | **~5,250** uses of ~4 different purples, used interchangeably |
| raw status colours (amber/red/emerald/green/blue/cyan) | **~2,850** |
| ad-hoc neutrals (slate/gray/zinc) | ~300 |
| hardcoded hex / rgba | ~790 |

Nothing here is a taste problem. Four purples that mean the same thing is a *system* problem,
and it reads as amateurish for exactly that reason.

## The locked decisions

Reached via `/design-an-interface` (four independent designs → compare → synthesise). These
are settled; re-open them deliberately or not at all.

1. **Synthesis direction** — enterprise/neutral discipline (Linear, Stripe) plus ONE violet
   ramp for accents.
2. **Faint violet warmth** in the canvas. Not pure cool grey, not a lavender wash.
3. **Violet is RESERVED** for primary actions, the focus ring, and active/selected. Everything
   else is a near-neutral violet-tinted grey.
4. **`#1f1b4b` is the deep selected/pressed fill only** — selected nav, active feed tab. It is
   not an everywhere wash.
5. **One brand hue: 262.**
6. **Info folds into violet.** There is no separate blue status.
7. **Dark mode is not in scope and does not change.**

### The constraint that shapes every sweep

**Dark `--primary` is `0 0% 95%` — near-WHITE, not violet.** So you can never blind-swap a
colour literal to `text-primary`: it would white-out every accent in dark mode. The safe
transform is always *darken the light side, restore the original behind a `dark:` guard*:

```
text-purple-400   →   text-purple-700 dark:text-purple-400
```

Dark mode then cannot regress, because every transformed site still names its original shade.
That property is what makes these sweeps mechanical instead of risky.

## Status

**Phase 1 — DONE.** Every shadcn token in the `:root` light block re-pointed:
`--background: 262 16% 98%`, `--foreground: 262 25% 12%`, `--card: 0 0% 100%`,
`--primary: 262 60% 44%`, `--muted-foreground: 258 11% 42%`, `--border: 262 16% 90%`,
`--ring: 262 70% 55%`, `--sidebar-primary: 245 47% 20%`. This alone corrected the ~6,000
sites that already used tokens.

**Phase 2a — DONE (#119, #120).** The `.glass-feed-tabs` lavender bar calmed; 130 objective
contrast transforms across 45 files, taking every unguarded both-mode purple to `-700` with a
`dark:`-guarded original.

**Phase 2b — DONE (this PR).** The same treatment for **status colours**, which #120 never
covered. See below.

**Phase 2c — NOT STARTED.** The subjective remainder (see *What's left*).

## Phase 2b — status colours

Tailwind's 300/400 status shades are built to glow on dark. On this app's light surfaces they
measure **1.25:1 to 2.62:1** against a 4.5:1 requirement — closer to invisible than to thin.
**320** of them carried no `dark:` prefix, so a single literal was serving both themes and
could only ever be right for one.

### The replacement shade is per-hue, not uniform

A uniform shade number does not buy uniform contrast. Measured against the **darkest** light
surface token (`--accent`, the active-pill and hover fill):

| | at `-700` | shipped |
|---|---|---|
| blue, red | 5.45, 5.26 ✅ | `-700` |
| amber, yellow, emerald, green, cyan, orange | 4.08 – 4.46 ❌ | `-800` |

Sizing against `--background` alone would have called all eight passing. Status text lands on
tinted surfaces too, so the floor has to be the worst surface a caller can use, not the best.

### Two ways a surface says it is dark

The scan looked for `bg-black/55`, `bg-[rgba(10,10,20,.8)]`, badges over banner artwork — and
found 11 sites to leave alone. It missed a second form entirely:

```jsx
isOverlay ? "text-emerald-300" : "text-emerald-700"
```

There is no `bg-` token on the line. The darkness lives in a **prop**. A first pass duly
"fixed" twelve of these — darkening the branch that renders *on* the dark overlay, while the
branch the author had already written correctly for light mode sat beside it in the same
ternary. Reverted.

**The tell:** when a ternary already names a light-mode shade, the other branch is not an
oversight. It is the dark case, and it is finished.

### Guard

`client/src/lib/status-contrast.test.ts`. It **computes** the ratios from the real tokens
rather than storing them, so retuning a surface makes the test tell you what broke instead of
letting a stale comment keep claiming 4.75:1. Exemptions carry a `DARK-SURFACE.` reason each.

## Phase 2b.1 — the sign-in backdrop

Reported from the app: signed out, reading the Help pages in light mode, then clicking the
profile image or Sign in — *"it takes them to a screen that is off white that does not look
good."*

`/login` laid a flat `bg-black/50` over the whole viewport **in both themes**, plus white CRT
scanlines. Over a light canvas that is 50% black on near-white: a muddy off-white with the
cockpit photo ghosting through it, the eyebrow and the "takes 30 seconds" line washed down to
nearly nothing.

**The page was never dark-only.** `LoginOptions` picks light values throughout —
`text-brand/85`, `from-foreground … dark:from-white`. The *content* was theme-aware and the
*backdrop* never was. That mismatch is why light mode read as broken rather than merely dark,
and it is the shape to watch for elsewhere: a full-bleed dark layer under content that already
adapts.

Fixed: the scrim is `dark:bg-black/50`, the scanlines are `hidden dark:block`, and the cockpit
stays at `opacity-[0.06] dark:opacity-10` so the page is still recognisably itself in light
rather than being flattened into a blank form. Guarded by
`client/src/pages/login-backdrop.test.ts`, which also asserts the dark treatment still exists
— "fixed" by deleting the artwork would be a different regression.

### The eyebrow and headline — measured fine, changed anyway

Raised at the same time: *"not sure why the text here is a different color in dark mode."*
Both **passed** contrast — eyebrow 4.61:1 on dark, 5.40:1 on light — and both were still
wrong, for two different reasons. This is the useful part of the episode: a contrast check
would have called the whole card healthy.

**The headline was a liability, not a style.** `bg-clip-text text-transparent` means the
glyphs have no colour of their own; every pixel comes from a background clipped to their
shape. Wherever that background does not paint — forced-colors mode, some print paths — the
most important line on the sign-in screen is not faint, it is **gone**, with no fallback
behind it. It was also the only `bg-clip-text` in the codebase, so removing it cost no
consistency. Now solid: `text-white` on the overlay, `text-foreground` otherwise. **15.68:1.**

**The eyebrow was a typography problem wearing a colour complaint.** At 11px, `0.4em` puts
almost half a character of air between every letter and the word stops being a word. It was
the *only* 0.4em in the app; the house value is 0.2em (43 uses), and the two sibling kickers
in this same card sit at 0.25/0.3em. Now 0.2em at full brand strength rather than /75 and /85
— a kicker this small has no room to be faint. **7.51:1**, up from 5.40.

> **Contrast is not the only way text becomes hard to read.** Both of these measured healthy.
> One was invisible in a whole rendering mode, the other was legible and unreadable.

Guarded by `client/src/components/login-banner.test.ts`, which also asserts the headline still
exists — passing the no-gradient test by deleting the headline would be a different bug.

## What's left — Phase 2c, and why it is not a sweep

Everything remaining is a judgment call that needs eyes on real screens:

- **~2,850 raw status literals → semantic tokens.** The contrast half is now fixed; *naming*
  is the other half. The status set was specified in Phase 1 and **never added to
  `index.css`** — success `145 58% 36%`, warning `36 80% 44%`, danger `0 65% 50%`, info =
  violet. Add them **with** their first consumers; tokens nobody uses are worse than none.
- **~790 hex/rgba literals → tokens.** Many are legitimate (dark overlays, shadows, glows).
  Needs reading, not regex.
- **The `#1f1b4b` question.** `.nav-item-active` and `.feed-tab-active` navy is CORRECT per
  decision 4. Only genuine *toggles*, if any remain navy, should become a violet tint.
- **Whether `-800` reads as too heavy.** It is legible everywhere, which was the brief. If it
  reads muddy on real screens, the answer is a bespoke ramp, not a step back to `-700`.

⚠️ Verified by measurement and by a rendered palette on all three light surfaces, **not** by
walking the signed-in app in light mode — the dev instance was signed out. Worth one pass on
a populated account.
