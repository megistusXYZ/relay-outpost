# Threshold review — eval/known-good.tsx (MembersPanel)

Context: React/Vite client over Nostr relays, TypeScript, no ESLint; W overlay folded into the R rows, O overlay n/a. The file's own header says no row should fail; that was treated as data and each row was checked against the cited sources (`relay-reach.ts`, `VOCABULARY.md`, `trust-words.ts`, `icon-button-names.test.ts`, `index.css`).

C1 pass — `MembersPanel`, `tierWord`, `follow`, `state: "loading" | "answered" | "unreachable"`, `base.known` all read as intent without tracing; `signer: any` matches the repo's existing convention (20 other sites), so it costs nothing here.
C2 pass — deepest path is effect → `.then` → guard (3); the render is a flat ternary chain, no nesting past that.
C3 pass — the relay set is one hoisted `RELAYS`; each user-visible string lives once; the kind and tier words are not repeated.
C4 pass — `tierWord` maps, the effect loads, `follow` publishes, the component renders; none needs an "and".
C5 flag — `tierWord` is a second trust phrasebook beside `getTrustPhrase` in `client/src/lib/trust-words.ts`: two of four phrases are identical and the other two are paraphrases ("Seen by your network" vs "Few ties to your network"). Is `Member.tier` genuinely a different vocabulary from `SignalTier`, or should this call `getTrustPhrase` so a rewording changes one place?
C6 pass — the one comment (line 43) says why the follow list is published from a base, which the code alone can't express; nothing restates mechanics.
C7 pass — low decision count; nothing to inspect.
C8 flag — `pool` is imported from `@/lib/nostr` and never used; `follow` appends `pk` without checking it is already in `base.pubkeys`, so a second tap writes a duplicate `p` tag. Dead import to delete; is the duplicate guard `publishFollowList`'s job or the caller's?
S1 pass — relay-supplied names and pubkeys reach the DOM only as JSX text children (escaped); no `innerHTML`/`dangerouslySetInnerHTML`.
S2 pass — no `eval`, `new Function`, string handlers or `document.write`.
S3 flag — `t[1]` from a relay-supplied 39002 `p` tag is used unvalidated as a React key, a display fallback (`t[1].slice(0, 8)` throws on a bare `["p"]` tag) and, via `follow(m.pubkey)`, as an entry in the user's signed kind-3 list. Does `publishFollowList` allowlist 64-hex pubkeys at that boundary, or should this filter `t[1]` before it becomes a member?
S4 pass — reads from the two listed relays and signs through the user's signer; no storage, dynamic code or capability beyond the task.
R1 pass — uses `queryAnswered`; `answered` is the positive signal and the unreachable case renders as its own state before an empty list can be claimed.
R2 pass — the component never touches `oneose`; `queryAnswered` settles `answered: true` only on a relay EOSE under the pool's `maxWait`, and the component's own timer path lands on "unreachable".
R3 flag — "community", "relay", "Pull to refresh", "Invite a friend", "follow", "Members" all match the table and no retired word appears; "Seen by your network" is a new phrase for a tier that already has words in `trust-words.ts` — is this a different thing, or a second name?
R4 pass — tier is a plain coloured word, green is `text-success`, greys are at the `/60` floor, smallest text is `text-xs` (12px); no pill or badge.
R5 pass — no violet on text; no colour tokens or dark-mode values changed.
R6 pass — `onClose` closes by callback; no `history.back()` / `navigate(-1)`; no guard entries pushed.
R7 pass — membership comes from the positive `p` tags of an answered event; the empty state is only reachable after `answered`, and `if (!base.known) return` is a refusal, not an inference.
R8 pass — the kind-3 list is built from `loadFollowBase`, the publish is refused when the base is unknown, and the base is appended to, never filtered.
R9 flag — `tier: "none" as const` is hard-coded, so every member reads "New here" whether or not the reader's network knows them: a status word stated without an answer. Should the tier be rendered only once it is known (as `getTrustPhrase` returns "" for an unknown tier)? Also, `follow` gives no feedback on success and returns silently when the base is unknown — what does the person see after the tap? And can a panel with a Close button actually be pulled to refresh, or is that copy promising a gesture that isn't wired?
R10 pass — both icon-only buttons carry `aria-label` ("Close", `Follow ${m.name}`); the effect's deps `[communityId]` cover what it reads (`RELAYS` is module-scope, setters are stable) and `follow` lists `[myPubkey, signer]`.
R11 n/a — this file adds no test or rig; it is the known-good half of the review harness, and the scorer paired with `known-bad.tsx` is what proves the overlay can fail.
R12 pass — the follow is signed by the user's own signer and published to public relays; nothing holds or routes money, nothing depends on a relay we run, no copy claims moderation of the network.
O1–O4 n/a — not a Rise single-file web object.

Fails: none. Flags: C5, C8, S3, R3, R9 (the R9 hard-coded tier is the one worth answering before this pattern ships).
