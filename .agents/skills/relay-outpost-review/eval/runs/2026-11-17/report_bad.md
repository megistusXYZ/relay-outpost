# Threshold review: known-bad.tsx (community members panel)

Context: React 18 + TypeScript client component, nostr-tools pool, Tailwind; Relay Outpost overlay active, Rise overlay n/a.

C1 flag — `CrewPanel` names a members panel with a retired word, and `mine` in `follow` holds the community's member list, not my follows. Could these be `MembersPanel` and `memberTags`, since the current name hides the R8 bug?
C2 pass — at most two levels (a ternary chain in JSX, a filter/map in a callback).
C3 flag — kind 39002 and kind 3 are literals even though `KIND_GROUP_MEMBERS` (lib/nip29.ts) and `KIND_FOLLOW_LIST` (lib/nostr-helpers.ts) exist, and `RELAYS` adds another fixed relay list beside the shared ones. Should these reference the existing constants and relay sources?
C4 flag — the component fetches members, builds and publishes a follow list, and renders. Should the follow job leave the panel (see C5)?
C5 fail — `follow` re-implements the follow-list publish that `useFollowAction()` (hooks/use-follow-action.ts) exists to own as the one guarded copy; call `useFollowAction().follow(pk)` instead.
C6 flag — no why on the choices that aren't obvious: every member is hard-set to `tier: "none"`, and the relays are fixed. Is that intended, and where is it explained?
C7 pass — low decision count; nothing to screen.
C8 flag — smells: `signer: any`; `reachable` is set and never read (an unused local under noUnusedLocals); `myPubkey` is never used, which is why the follow base is wrong; `tierWord` has three branches that can never run; `pool.publish` is fire-and-forget. Will each of these be looked at?
S1 pass — relay-supplied `name` goes to the screen as React text and an escaped attribute; nothing reaches an HTML sink.
S2 pass — no eval, Function, or string-built handlers.
S3 fail — p-tag values from an unauthored 39002 on public relays go straight into a signed kind-3 with no checks (anyone can publish that d-tag, and `t[1]` may be missing). Add `authors: [<group relay pubkey>]` to the filter and keep only tags whose `t[1]` is 64-char hex.
S4 flag — the panel takes a full `any` signer and publishes to two fixed third-party relays instead of the user's own write relays. Is that reach needed?
R1 fail — `members.length === 0` renders "No members yet" with no answered/reached signal, so "no relay answered" looks like an empty community. Use `queryAnswered`/`withReach` (lib/relay-reach.ts) and give the unreachable case its own state.
R2 fail — `oneose` sets `reachable(true)`, and nostr-tools fires that for dead relays and timeouts too. Gate on `pool.ensureRelay` / `onrelayeose` / `queryAnswered`.
R3 fail — retired words reach the screen: "Crew" (heading) and "broadcast" ("be the first to broadcast here"). Use "Members" and "be the first to post here".
R4 fail — the tier is a pill (`rounded-full bg-green-500/15 text-green-500 … text-[10px]`), "Loading…" is `text-[9px] text-muted-foreground/40`, and the empty state is `text-muted-foreground/60`. Make the tier a plain `text-xs` word on the status token (`text-success`, or `text-muted-foreground` for neutral), and use `text-xs text-muted-foreground` for both secondary lines.
R5 fail — `text-violet-600` on the "Crew" heading is the retired violet; use `text-foreground`.
R6 fail — `close` calls `window.history.back()` before `onClose()`. Close by state only (`onClick={onClose}`) and let the guard pop on its own.
R7 fail — every member gets `tier: "none"` without any trust lookup, so each one is labelled "New here", a status inferred from an answer nobody asked for. Leave tier unknown until the trust lookup answers and show no tier word until then. Also: the 39002 is asked of public relays rather than the group's own NIP-29 relay, and an empty reply from the wrong relays then reads as "no members".
R8 fail — the kind-3 is built from `members` (the community list) plus `pk`, which replaces the user's whole follow list. Load the base with `loadFollowBase(myPubkey)`, refuse when it is blocked or unknown, and append `pk`. Simpler: use `useFollowAction`.
R9 fail — `setLoading(false)` runs synchronously right after `subscribeMany`, so the spinner ends before any relay answers. Clear it on the real settle (relay EOSE or maxWait), and await `pool.publish` and report the result instead of dropping it.
R10 flag — the icon-only close `<Button size="icon">` (X) has no `aria-label`; should it be `aria-label="Close"`? Hook deps are complete (`[communityId]`, `[members, signer]`).
R11 n/a — no test or rig in this change.
R12 pass — no money handled, no dependence on a relay we run, no network-wide moderation promised.
O1 n/a — Rise overlay; not a Rise web object.
O2 n/a — Rise overlay; not a Rise web object.
O3 n/a — Rise overlay; not a Rise web object.
O4 n/a — Rise overlay; not a Rise web object.
