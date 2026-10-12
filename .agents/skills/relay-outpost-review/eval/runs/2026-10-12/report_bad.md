# Threshold review — `eval/known-bad.tsx` (CrewPanel)

Context: React/Vite client over Nostr relays (nostr-tools `pool`), no ESLint; the repo's own conventions are the R rows. Rise overlay n/a.

C1 flag — `reachable` is set on `oneose`, so the name claims something the code never established; `loading` never covers the fetch. Would `eosed` / `settled` describe what is actually known, and is `CrewPanel` a name a reader can map to the product's own word ("your people" / members)?
C2 pass — control flow is one level deep throughout; the ternary chain in JSX is flat.
C3 flag — `RELAYS` is a hard-coded two-relay list private to this file and `slice(0, 8)` is an unnamed short-pubkey width; do both have an authoritative home already (the user's relay list / outbox, a shortPubkey helper) that this file should reference instead?
C4 pass — each routine has one nameable job (subscribe, build-and-publish follow, close, tier word); `close` doing history + state is a contract problem (R6), not a cohesion one.
C5 fail — `tierWord` re-states the tier→phrase table that already lives in `client/src/lib/trust-words.ts` (`getTrustPhrase`); a copy change must now be made in two places. Delete `tierWord` and import `getTrustPhrase`.
C6 flag — no "why" on the non-obvious choices: why these two relays, why close the subscription on the first EOSE, why `name` falls back to an 8-char pubkey prefix. Which of these are deliberate and worth a one-line reason?
C7 pass — decision points are few; nothing here warrants a restructure prompt on complexity.
C8 flag — smells to investigate: `signer: any` (what is the real signer type in `@/lib/nostr`?); `setLoading(false)` runs synchronously after `subscribeMany` so `loading` is true for one render only (is it meant to track the fetch?); each `onevent` replaces the whole list, so a second 39002 from another relay overwrites rather than merges (intended, or should the newer `created_at` win?); the result of `pool.publish` is discarded (is the user ever told whether the follow landed?).
S1 pass — `m.name` and the tier word render as JSX text nodes; no `innerHTML`/`dangerouslySetInnerHTML` sinks.
S2 pass — no `eval`, `new Function`, string handlers or `document.write`.
S3 fail — `t[1]` from a relay-supplied `p` tag is used unvalidated as the member pubkey, the React key, and then signed into the user's kind-3 follow list; `t[2]` is rendered as the name untrimmed and unbounded. Allowlist at the boundary: keep only tags whose `t[1]` matches `/^[0-9a-f]{64}$/`, and trim/cap `t[2]` before it becomes `name`.
S4 pass — no storage, dynamic code or network capability beyond the relay subscribe/publish the panel needs.
R1 fail — `members.length === 0` renders "No members yet" with no signal that any relay answered; `reachable` is written but never read. Fetch via `queryAnswered(RELAYS, filter)` (`client/src/lib/relay-reach.ts`) and render `answered === false` as its own "couldn't reach the relays" state, separate from the genuinely-empty one.
R2 fail — `oneose() { setReachable(true) }` treats nostr-tools' EOSE as "the relay answered"; it fires on connection failure and is invented on timeout. Gate reachability on `pool.ensureRelay` / `onrelayeose` / `queryAnswered`, not on `oneose`.
R3 fail — retired words reach the screen: the heading "Crew" (VOCABULARY.md row "People": crew is retired) and "be the first to broadcast here" (row "Posting": broadcast is retired). Use "People" (or "Members") for the heading and "be the first to post here" for the empty state; rename `CrewPanel` to match.
R4 fail — the tier status is a pill (`rounded-full bg-green-500/15 text-green-500 px-2 py-0.5`), the loading line is `text-[9px] text-muted-foreground/40`. Render the tier as a plain word in `text-success`; make the loading line `text-xs text-muted-foreground/60` (10px minimum, grey never below /60).
R5 pass — no brand violet on informational text; no dark-mode token touched.
R6 fail — `close` calls `window.history.back()` and then `onClose()`, so a manual close pops history (and pops a second time when the guard fires). Drop the `history.back()`; close by state and let the modal guard pop its own entry.
R7 fail — every member is hard-coded `tier: "none"` and shown as "New here": a status asserted without ever asking for the trust answer. Look the tier up (the trust-words/score path) and show nothing until it is answered; never label people from a value that was never fetched.
R8 fail — `follow` publishes a kind-3 whose `p` tags are built from the *community member list* (`members`), not from the user's loaded follow list; one tap replaces the user's real follows with this panel's roster (and from an empty base if the fetch never answered). Load the follow base (`loadFollowBase` pattern), append the one `["p", pk]`, and refuse the publish when the base is unknown.
R9 fail — `setLoading(false)` runs synchronously right after `subscribeMany`, so "Loading…" ends before any relay answers; the follow's `pool.publish` results are never awaited or reported. End loading on the real settle (`queryAnswered` resolving / the relay's own EOSE) and report the publish answer ("Followed on 2 of 2 relays" / failure) instead of saying nothing.
R10 flag — the close `<Button variant="ghost" size="icon">` carries only an `<X>` icon and no `aria-label` (the follow button has one; `useEffect`/`useCallback` deps are complete). Should it be `aria-label="Close"`?
R11 n/a — no test or rig is added in this change; nothing to prove red.
R12 pass — no sats held or routed; the panel reads/publishes to public relays, not one we run; no copy promises network-wide moderation.
O1–O4 n/a — not a Rise single-file web object; the O overlay does not apply in this repo.
