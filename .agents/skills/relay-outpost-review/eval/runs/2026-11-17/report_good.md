# Threshold review: eval/known-good.tsx (MembersPanel)

C1 pass — names carry intent (MembersPanel, loadFollowBase, state = "loading" | "answered" | "unreachable"); the short names (t, pk, a/b) only live inside one-line lambdas.
C2 pass — at most two levels in the effect and the callback; the JSX is one flat four-way ternary.
C3 flag — RELAYS hard-codes two URLs that are already in DEFAULT_RELAYS (lib/relay-constants.ts), and the repo has had to edit "the fixed lists" before (#493). Should this point at the shared list, or at the community's own relay, instead of keeping its own copy? (60 and 8 each appear once and are fine.)
C4 pass — the effect does one job (fetch and parse the member list) and follow does one job (add one key on top of a loaded base).
C5 flag — parseGroupMembers (lib/nip29.ts) already decides which tags in a 39002 are members, and the inline filter/map is a second copy (it adds HEX64, which the shared one lacks). Also, in NIP-29 the p-tag's t[2] is not a display name, so most rows would show an 8-hex prefix. Should this reuse parseGroupMembers (with the hex check moved into it) and take names from getDisplayName / petnames?
C6 pass — the comments explain why (the boundary rule, the replaceable-list rule, the tier left unknown on purpose) and don't restate the code.
C7 pass — few decision points, and all of them hang together. Nothing to look into.
C8 flag — smells: (1) nothing in this file ever sets Member.tier, so the trust-phrase branch and the getTrustPhrase import are dead. Is a tier lookup coming? If it is, should "flagged" (which reads "Your network has concerns") use text-warning instead of muted? (2) `signer: any`. (3) The imports don't match the repo. FollowBase in lib/follow-list.ts is { base, blocked }, not { known, pubkeys }. There is no publishFollowList export. SignalTier is exported from lib/graperank, not lib/trust-words. As written, this file would not type-check against the codebase. (4) events.sort mutates the array that came back (harmless here).
S1 pass — relay-supplied names only reach the DOM as React text children and as an escaped aria-label. No innerHTML-style sink.
S2 pass — no eval, new Function, string handlers or document.write.
S3 flag — the shape is checked against an allowlist (HEX64 pubkeys, names trimmed and capped to 60). Who signed the event is not checked: the filter has no `authors`, and the newest kind-39002 from any key wins. On damus/nos.lol anyone can publish a newer 39002 with this d tag and replace the list shown. Should the read be pinned to the community relay's key, or asked of the relay that enforces who may write it?
S4 pass — reads two relays and writes only the user's own follow list, and only when they tap.
R1 pass — queryAnswered's `answered` drives its own "unreachable" state. "No members yet" only renders after a relay actually answered.
R2 pass — the file never touches oneose. It gates on queryAnswered's `answered` (a relay's EOSE inside the pool's maxWait), not on an EOSE nostr-tools invented.
R3 pass — Members, community, follows, Following and Invite a friend are all current words. None hits the RETIRED list in client/src/vocabulary.test.ts.
R4 pass — the trust status is a plain text-xs word on text-success or the full text-muted-foreground. All copy is text-sm or text-xs. No pill, no faded grey, nothing under 12px.
R5 pass — no Ember on information, no selected-state tint, no glow or icon tile, no violet. The heading is in ink and the buttons are ghost.
R6 pass — Close calls the onClose prop (closing by state) and never touches history.
R7 flag — the member list (kind 39002, a NIP-29 group record) is asked of two fixed general relays, not of the community's own relay (lib/nip29.ts asks the group's relayUrl). If damus/nos.lol answer empty, the panel says "No members yet. Invite a friend." Is that the right question to be asking? The positive gates themselves (m.tier &&, base.known) are correct.
R8 pass — the follow list is only published from loadFollowBase's result. An unknown base is refused with a toast. The new key is appended to the loaded list and never replaces it.
R9 flag — the outcome words come from answers ("Following" only when ok is true; "No relay accepted it" otherwise). Two questions: (a) "Couldn't reach this community's relay" names a relay the code never asked (it asked RELAYS). It also shows when members did arrive before the timeout (queryAnswered returns them with answered=false). Should arrived members render? (b) Follow shows nothing while it works, through a base load (up to ~6 s) and a publish. Two quick taps on different members build from the same base, the second replaces the first, and one "Following" toast ends up untrue. Should the button be disabled while a follow is in flight?
R10 pass — both icon-only Buttons have aria-label ("Close", "Follow {name}"). The effect's deps [communityId] are complete (RELAYS is module-level and setters are stable). follow's deps [myPubkey, signer, toast] are complete.
R11 n/a — the change adds no test or rig.
R12 pass — no money handled. Reads and writes go to public relays and the user's own follow list. The copy makes no promise about moderating the network.
O1 n/a — Rise web-object overlay; not this repo.
O2 n/a — Rise web-object overlay; not this repo.
O3 n/a — Rise web-object overlay; not this repo.
O4 n/a — Rise web-object overlay; not this repo.
