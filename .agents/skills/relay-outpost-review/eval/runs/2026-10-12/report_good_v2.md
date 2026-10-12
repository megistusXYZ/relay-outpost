# Threshold review — `eval/known-good.tsx` (MembersPanel)

Context: React/Vite client over Nostr relays, no ESLint, TypeScript, no build-time lint. Universal core C1–C8, security rows S1–S4, Relay Outpost overlay R1–R12. W rows not applied (Button/ul/li/h2 are native semantics; nothing to route). O rows n/a.

- C1 pass — `members`, `state` ("loading" | "answered" | "unreachable"), `follow`, `HEX64`, `Member` all recover intent without tracing; `pk`/`m`/`t` are one-expression locals.
- C2 pass — effect and `follow` are guard-clause flat; the JSX is a four-way chain of ternaries, not nesting, and each branch is one line.
- C3 pass — `RELAYS` and `HEX64` are hoisted; the only literals (`60` name cap, `8` short-pubkey length, `39002`) each appear once, so nothing has to change in N places.
- C4 pass — the effect fetches-parses-sets; `follow` loads-checks-publishes-reports; each is one nameable job and the names fit.
- C5 pass — the repeated `text-muted-foreground/60` and the two "Try again in a moment." strings are coincidental (style/copy), not the same rule; the reach rule lives once in `queryAnswered`, the wipe rule once in `loadFollowBase`.
- C6 pass — all three comments carry why (the tier may be unknown; boundary allowlist; replaceable-from-a-loaded-base), none restate mechanics, none are stale.
- C7 pass — low decision count; nothing to prompt.
- C8 flag — `signer: any` on the props: is there a Signer type in the repo this should take, or is `any` deliberate for the fixture? (Also line 32 is ~170 chars; a line break would not change behaviour.)
- S1 pass — every untrusted string (`m.name`, trust phrase) reaches a JSX text sink; no `dangerouslySetInnerHTML`, `innerHTML` or raw-HTML path.
- S2 pass — no `eval`, `new Function`, string handlers or `document.write`.
- S3 pass — allowlist at the boundary: pubkeys must match `HEX64`, names are trimmed and capped at 60, fallback is a pubkey prefix; tier is left unknown rather than derived from tags.
- S4 pass — reads from a fixed two-relay list; the only write is the user's own follow list through the user's signer; no storage, no dynamic code.
- R1 pass — three states are explicit; "No members yet" renders only when `state === "answered"` and the list is empty, "unreachable" is its own screen, and the empty default `[]` can never be shown as an empty state before the answer lands.
- R2 pass — the component makes no EOSE decision of its own; reachability comes from the shared `queryAnswered` `answered` flag (`client/src/lib/relay-reach.ts:159`). (Whether that primitive's own `oneose → settle(true)` is strict enough is the primitive's bar, not this file's.)
- R3 pass — "Members", "community", "relay", "Following", "follows", "Invite a friend" are the table's words (VOCABULARY.md lines 13, 26, 29); no retired word (crew/orbit/station/Outpost-as-a-thing/DM…) reaches a screen; no second name is coined.
- R4 pass — the trust tier is a plain coloured word from `getTrustPhrase`, not a pill; strong = `text-success` (token exists, `tailwind.config.ts:56`), otherwise `text-muted-foreground/60`; smallest text is `text-xs` (12px); no `/40` greys, no `text-green-*`.
- R5 pass — no violet/brand classes on any text; no light- or dark-mode token touched.
- R6 pass — close is `onClose()` by state from the parent; no `history.back()` / `navigate(-1)`; no guard entries pushed here.
- R7 pass — the tier line renders only when `m.tier` is present (never "untrusted" from absence); unreachable is gated on the positive `answered` flag, not on `events.length === 0`; the follow dedupe reads the loaded base.
- R8 pass — kind-3 is published only from `loadFollowBase`, refused with a toast when `base.known` is false, and the new list is `[...base.pubkeys, pk]` (append); nothing is filtered, no empty or guessed list can be published.
- R9 pass — "Loading…" ends on the real settle (answered or timed out); "Following" is said only when `publishFollowList` returned ok, and the failure copy says what happened ("No relay accepted it"); no fabricated count or activity.
- R10 pass — both `size="icon"`/icon-only Buttons carry `aria-label` ("Close", `Follow ${m.name}`); effect deps `[communityId]` are complete (setters are stable, `RELAYS`/`HEX64` are module constants); `follow` lists `[myPubkey, signer, toast]`, which is everything it closes over.
- R11 n/a — no test or rig is added in this file; the row's bar applies to a new harness, which there is none of here.
- R12 pass — no sats held, routed or split; the only action is handed to the user's own signer and published to public relays; no copy promises moderation of the network.
- O1–O4 n/a — not a Rise web object; no SCORM/iframe/single-file contract applies.

Verdict: no fails. One flag (C8, `signer: any`). Known-good fixture holds.
