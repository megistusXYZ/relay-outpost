# Colour, light and dark

The doc of record for colour in both themes. The app used to wear four purples; it now has
one ink, one accent and a small set of status colours. Read this before touching a colour.

## The rules

1. **Ink first.** Text, icons and selection are ink (`foreground`). Secondary words are
   `text-muted-foreground`, at full strength.
2. **Ember is for acting.** `text-brand` / `bg-brand` mark actions, links and status words
   ("3 new", "@2"), and nothing else. Never decoration, never a heading, never a selected
   state.
3. **Selection is ink.** A selected tab, chip, segment, toggle or vote is a filled ink pill
   (`bg-foreground text-background`) or an ink icon. Not an Ember tint.
4. **Status is a word, not a pill.** Use `text-success`, `text-warning`, `text-danger` on a
   plain word. Live is red, and only its dot pulses (`components/LiveBadge.tsx`).
5. **Readable or not at all.** Words people read are 12px or larger and meet WCAG contrast
   (4.5:1, or 3:1 at 24px / 18.66px bold). No faded greys on words (`/40`, `/60`…). Avatar
   initials, decorative `aria-hidden` marks and disabled controls are exempt.
6. **Quiet surfaces.** Cards are neutral (`bg-card`, `border-border`), 20px corners and 16px
   for a card inside a card. No glows. No icon tiles in light mode; a quiet grey disc
   (`dark:bg-foreground/[0.05]`) is allowed in dark only.
7. **Motion is colour only, 150ms**, and stops under `prefers-reduced-motion`. Two things
   move, and only these: a button presses down a little when you press it (`.press`, 97% for
   0.1s), and Relay, the mark, changes its face when something real happens
   (`components/OttoMark.tsx`, `lib/mark-signals.ts`). Relay never loops and never moves for
   decoration; under reduced motion its face still changes and nothing moves.
8. **The old violet is retired.** Hue 230–305 with real saturation fails CI. People's own
   identity colours (name colours, badge art, music cards) are the exception, by allowlist.

## The tokens

All in `client/src/index.css`, as HSL triples.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `240 7% 97%` | `220 23% 5%` | the canvas |
| `--foreground` | `216 16% 6%` | `216 26% 96%` | ink: text, icons, selection |
| `--card` | `0 0% 100%` | `220 22% 9%` | surfaces |
| `--primary` | `216 16% 6%` | `216 26% 96%` | primary buttons: ink, same as foreground |
| `--muted-foreground` | `218 10% 37%` | `217 14% 68%` | secondary words, at full strength |
| `--accent` | `240 6% 92%` | `220 16% 14%` | hover and soft fills (the darkest light surface) |
| `--brand` | `15 84% 39%` | `15 100% 69%` | Ember: actions, links, status words |
| `--brand-strong` | `15 86% 31%` | `15 100% 78%` | Ember on hover |
| `--success` | `145 63% 28%` | `158 64% 52%` | a good status |
| `--warning` | `32 90% 32%` | `43 96% 56%` | a status that needs care |
| `--danger` | `0 70% 42%` | `0 91% 71%` | a bad status, concerns |
| `--input` | `220 9% 56%` | | control borders and the switch's off track: 3:1 on every light ground |
| `--ring` | `14 88% 46%` | | focus ring |

`--primary` is ink in **both** themes (near-black on light, near-white on dark). So
`bg-primary` is always "the strongest thing on the page", and `text-primary` on a plain
surface is just ink.

## Picking a class

| You want | Use |
|---|---|
| body text, names, headings | `text-foreground` (or nothing) |
| times, counts, captions | `text-muted-foreground`, `text-xs` minimum |
| a section title | `TILE_TITLE` (`components/discover-tile-title.ts`): ink, 15px, semibold, sentence case |
| a link or a text action | `text-brand hover:text-brand-strong` |
| a primary button | the shared `Button` (ink fill) |
| a secondary button | the shared `Button` with `variant="outline"`, `rounded-full` |
| a selected tab or chip | `bg-foreground text-background`, with `aria-pressed` or `aria-selected` |
| "3 new", "@2" | `text-brand` on the word |
| online, saved, trusted | `text-success` on the word |
| concerns, failed | `text-danger` on the word |
| a hover fill | `hover:bg-foreground/[0.04]`–`[0.06]` |
| a reply line or quote edge | `bg-foreground/30` or `border-border` |

## Guards

Each one fails CI. When one fails, fix the screen rather than the guard.

| Guard | What it stops |
|---|---|
| `client/src/no-old-violet.test.ts` | any retired violet (hue 230–305, saturation > 0.35) outside the identity allowlist |
| `client/src/lib/status-contrast.test.ts`, `client/src/status-tokens.test.ts` | status shades below 4.5:1, computed from the real tokens; status colours off their tokens |
| `client/src/input-border-contrast.test.ts` | control borders below 3:1 |
| `client/src/console-readable.test.ts` | operator console text under 12px, chart labels under 12 |
| `client/src/light-mode-calm.test.ts` | loud light-mode treatments coming back |
| `client/src/live-badge.test.ts` | hand-rolled live pills instead of `LiveBadge` |
| `client/src/trust-no-numbers.test.ts`, `client/src/post-trust-bars.test.ts` | trust shown as a number or a verdict |
| `client/src/pages/login-backdrop.test.ts`, `client/src/components/login-banner.test.ts` | space art or a dark scrim behind sign-in; a gradient headline; the old eyebrow and extra rows on the chooser |

Source guards catch the patterns we already know. New screens are checked the other way
round: a browser check opens the page in both themes and measures every word on it for size
and contrast, then fails if the screen didn't render. A check like that has to be seen
failing on the old code before its pass means anything.

## Lessons that still hold

These came from the violet era (2026-07 to 2026-11) and apply to any colour work.

**One shade number is not one contrast.** Status shades were measured against the *darkest*
light surface (`--accent`), not the canvas: at `-700`, blue and red passed (5.45, 5.26) and
amber, yellow, emerald, green, cyan and orange did not (4.08–4.46). Size the floor against
the worst surface a caller can use. The status tokens above replace that table.

**Two ways a surface says it is dark.** A `bg-` class, and a prop:
`isOverlay ? "text-emerald-300" : "text-emerald-700"`. A class scan can't see the second; a
first pass "fixed" twelve of them by darkening the branch that renders on the dark overlay.
When a ternary already names a light shade, the other branch is the dark case, and it is
finished.

**A dark layer under content that already adapts reads as broken.** The sign-in screen laid
`bg-black/50` over both themes while its content picked light values throughout. Since
2026-11-18 both sign-in screens are a plain page in the visitor's theme (`.signin-surface`):
no starfield, cockpit photo, scanlines or scrim in either theme.

**Contrast is not the only way text becomes unreadable.** The sign-in headline passed at
15:1 and was `bg-clip-text text-transparent`, so in forced-colours mode it disappeared. An
11px eyebrow at `0.4em` tracking passed contrast and stopped reading as a word. Both are
fixed and guarded.

**A survey of literals is a starting set.** The old audit counted ~5,250 purple uses, ~2,850
raw status colours and ~790 hex/rgba literals. The first two are gone. Many of the hex/rgba
literals are legitimate (overlays over artwork, shadows) and need reading, not a regex.

## What's left

- **Raw status literals** (`text-amber-700`, `text-emerald-800` …) that predate the status
  tokens. Move them to `text-success` / `text-warning` / `text-danger` screen by screen, with
  the screen open, since some sit on artwork or dark overlays on purpose.
- **Hex and rgba literals.** Read each one; keep the ones over artwork.
- **Identity colours.** The allowlist in `no-old-violet.test.ts` is short on purpose. A new
  entry needs a reason a person would recognise ("this is someone's chosen colour").
