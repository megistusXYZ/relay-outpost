# Media feed — one thread, every medium first-class

*Decided 2026-07-31 in a `/grilling` session. Thirteen questions, each with the
evidence that settled it. This document is the source of truth; the numbers in
it live as constants in `lib/media-frame.ts`, not sprinkled through JSX.*

## The problem, as it actually is

A portrait video in the feed renders as a **wide black box with the clip
pillarboxed in the middle**. A portrait photo fares worse — it gets
**centre-cropped into a landscape box**. Neither is a style choice; both are
fallbacks firing when metadata is missing.

Measured on the live feed (scrolled ~20k px, sampled every mounted element):

| | finding |
|---|---|
| image ratios in the wild | **0.462 → 2.215** — there is no single box |
| current image fallback | `aspectRatio: "16 / 10"` + `object-cover` → hard crop of anything portrait |
| current video fallback | `16 / 9` → pillarbox of anything portrait |
| when `imeta dim` IS present | already correct (caught videos boxed at 0.75) |

Probed three relays for the last 300 events of kinds 20/21/22:

| relay | 20 picture | 21 video | 22 short video | has `imeta` | has `dim` |
|---|---|---|---|---|---|
| relay.damus.io | 240 | 27 | 33 | 294 | 207 (69%) |
| nos.lol | 191 | 55 | 54 | 291 | 144 (48%) |
| relay.primal.net | 80 | 7 | 30 | 113 | 107 (91%) |

The feed subscribes to **kinds 1 and poll only**. All of the above is invisible
to our users today — including kind 22, which NIP-71 defines as short-form
*portrait* video. The shorts kind.

## The thirteen decisions

**1 · Inline shape in the feed, immersive pager on tap.** Not snap-paging the
feed itself. Snap-paging is hostile to text, and half the feed is text —
Instagram is the proof: scrolling cards in the feed, Reels as a separate
surface. Both built in this initiative.

**2 · Full-bleed for media-dominant posts.** Media stops being an attachment
inside a card and becomes the post — edge to edge, square corners on mobile,
column-width on desktop. `bubbles` feed style keeps today's inset look; media
escaping an SMS bubble would be incoherent.

**3 · Probe during overscan, and a box on screen never changes.** Three tiers:
`imeta dim` → exact box, free. Missing → probe on mount, which happens ~6 rows
before visible, so the correction lands off-screen. Still unknown at scroll-in →
neutral box with the media letterboxed and the bars filled by a blurred copy of
itself, frozen until the row leaves. The freeze is the load-bearing part: without
it a correction can shove the post you are reading.

**4 · Video to 9:16, images to 3:4-with-fade.** The difference between the two
ceilings *is* the difference between the two references. Video fills the screen
like a short. Images cap at 3:4 and taller ones are **topped, not cropped** — the
top of the image with a soft bottom fade and "tap to view full". Instagram
centre-crops to 4:5; that is wrong here, because a large share of Nostr's tall
images are screenshots and memes read top-down, and a centre crop removes both
the setup and the punchline.

**5 · Autoplay ON by default, with five guards.** Muted until tapped · one at a
time · never under `prefers-reduced-motion` · never on save-data/2G · never on
low-end devices (`deviceMemory ≤ 4` or `hardwareConcurrency ≤ 4`). This
*overrides* the "calm defaults" principle deliberately: that principle was set
when video was a small inline element, and a 700px static black rectangle is not
calm, it is broken. Muted video startles nobody. The setting already writes
literal `"true"`/`"false"` and syncs over NIP-78, so the flip is fail-open
(`!== "false"`) and anyone who explicitly turned it off keeps it off.

**6 · `isMediaDominant` — one rule, one number.**

```
1. no image/video attached        → false
2. renders a quoted-note card     → false     (two focal points; stay inset)
3. strip media URLs, trim → prose
4. prose.length ≤ 220             → true      (~3 lines: a caption)
5. otherwise                      → false     (media is evidence, not subject)
```

220 is a guess dressed as a threshold and will be wrong at the margins. It is a
constant, watched against real posts, tuned — not settled.

**7 · Instagram chrome placement in the feed; overlay belongs to the pager.**
Author row above, action bar below, both on the page. A fixed target beats a
moving one — casual scrolling runs on muscle memory, and a right-rail like
button would have to be re-found on every post. Overlay also needs a scrim,
which darkens the photo we went to the trouble of showing. **This pays off the
separation debt from decision 2 for free:** the author row above each full-bleed
photo *is* the separator between consecutive posts.

**8 · The pager is videos-only, from the feed you were in.** Paging is a queue
with momentum, and momentum comes from duration — a photo full-screen just sits
there, so the pager would have to invent an advance rule. Photos already have the
right interaction (lightbox, pinch-zoom). Entry is a tap on the video itself: a
700px target beats an expand button nobody finds. Non-negotiable: pushes a
**history entry** so hardware back closes it, and exit restores the **exact feed
position**. Subsumes `VideoLightbox` rather than adding a third video surface.
Limitation accepted: the queue is bounded by what the feed has loaded. Making it
endless means the pager fetching its own events, which is a global video feed —
a different product that should not be arrived at by accident.

**9 · Read kinds 20/21/22, keep publishing kind 1.** Rendering them is pure
upside: hundreds of events per relay, better metadata hygiene than kind-1 media,
and kind 22 is literally the thing this initiative is for. Publishing them is
not: a photo posted as kind 20 is invisible to every client without NIP-68, which
is most of them. Kind 1 with `imeta` reaches everyone. Our users stay visible,
their feed gets richer. The spam/quality filters are author-based, so new kinds
flow through them unchanged.

*Amended 2026-08: kind 20 is now an opt-in publish path* (`lib/picture-post.ts`,
pilot request). The invisibility argument was about defaults, not about an
author who asks for the picture kind: kind 1 remains what the composer emits
unless the post is picture-dominant (all attachments pictures, caption-length
prose) **and** the author flips "post as picture" — the toggle's helper text
names the reach trade-off. Kinds 21/22 are still never published.

**10 · One vh rule, page-background gutters.** `height = min(trueAspect × width,
85vh)` — expressed in viewport height, so desktop falls out with no second code
path. At 1440×900 the feed column is 714px and a 9:16 clip lands at 405×720,
centred. The leftover width is **page background, nothing**. That is the whole
difference between "this video is portrait" and "this video is broken": black
bars are a box that claims the width and fails to fill it. Explicitly *not*
blurred fill here — blur says *framed*, and this is a feed.

**11 · Scope: images + video + the new kinds. One shared frame for everyone.**
Audio wants a control surface, an article wants a headline, a poll wants tappable
options — those are different objects, not variations of the media frame. But
there is no shared post shell today: `NostrPost` rolls its own chrome,
`ArticleFeedCard` another, `MediaInteractionBar` a third. **`PostFrame` is built
once and every kind moves onto it** — same author row, same action bar, same
rhythm, same edges — with only the middle varying. A mixed feed reads as one
professional thread not because everything looks the same but because everything
is *framed* the same. Other kinds' middles are untouched here; each becomes a
small follow-on PR.

**12 · ±1 screen of live video, poster fallback.** The virtualizer keeps its
overscan of 6 for measurement and probing, but a real `<video>` element only
exists within ±1 screen of the viewport — at ~700px a row, 6 rows of live video
is ~4,200px of decoding and a mid-range Android will stutter. Posters come from
`imeta image`/blurhash so the placeholder is the real frame. A fast scroll may
show a poster for a beat before the element mounts; jank is felt continuously, a
200ms poster is felt once.

**13 · Bug fix first and alone. Then flag-gated, default ON.** `ro_media_feed`,
fail-open, only a literal `"0"` turns it off — same shape as the IA and Concord
flags. Default-OFF would teach us nothing; no flag would mean a bad result on
real devices needs a deploy to undo.

**Decided without asking:** a video under a content warning never autoplays — it
stays blurred behind its overlay until revealed, which is the entire point of the
warning.

## Landing order

Each row is independently shippable.

| # | PR | Notes |
|---|---|---|
| 1 | **Aspect bug fix** — probe + frozen box | unflagged, ships immediately; fixes today's crop/pillarbox |
| 2 | **`media-frame.ts`** — classifier, ceilings, constants | pure, tested, ships dark |
| 3 | **`PostFrame` shell**, `NostrPost` adopts it | refactor only, deliberately no visual change |
| 4 | **Full-bleed media-dominant** | behind `ro_media_feed` |
| 5 | **Autoplay flip** + five guards + ±1 screen budget | |
| 6 | **Kinds 20/21/22** ingestion + render | |
| 7 | **Immersive pager** | subsumes `VideoLightbox` |
| 8 | **Other kinds onto `PostFrame`** | polls, articles, audio, live — one small PR each |

PR 3 looks like wasted motion and is not: a refactor that changes nothing
visually is what makes 4 through 8 small.

## What this initiative does NOT do

- Redesign audio, article, poll or live *internals* — they move onto the frame,
  their middles stay as they are
- Publish kinds 20/21/22
- Build a global video feed
- Put images in the pager
- Snap-page the main feed

## Known risks, stated up front

- **Density.** At these ceilings five video posts are five screens. If the mix
  skews video the feed stops feeling like a feed. The fix is one number.
- **Cellular cost.** Autoplay burns real money on metered plans. Guards 4 and 5
  only catch users whose browser reports the condition; many will not.
- **220 will be wrong sometimes.** No character count captures intent.
- **Phasing makes existing kinds look worse** before PR 8 lands, because the good
  treatment sets a new bar. This is the price of shipping incrementally and the
  strongest argument for doing the sweep in one go.
