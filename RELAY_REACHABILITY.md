# Three outcomes, not two

A relay fetch can end three ways: **data**, **genuinely empty**, and **we never
got to ask**. Almost every fetch in this codebase is written with two, so the
third collapses into the second and the UI states it confidently:

> "No Chat Rooms Found — be the first, create a channel!" *(relay was offline)*
> "This outpost doesn't have chat yet" *(NIP-11 502'd)*
> "Nothing has been moderated here yet." *(audit log we couldn't read)*

All three shipped. Each invited someone to act on a claim we had no basis for.

## Why it keeps happening

Nostr fetches here are `new Promise(resolve => …)` over a subscription,
resolving on EOSE and again on a timeout. **None of them reject.** That is
reasonable for a protocol where partial answers are normal — and it means every
caller's `.catch()` is dead code, and `[]` is the only thing failure can say.

## EOSE is not the signal

This is the trap, and it is convincing enough that I built on it first, wrote
passing unit tests, and shipped a UI state that could never appear.

`SimplePool` fires `oneose` when a relay **fails to connect** — across a relay
set it means "everyone has answered or given up". Measured, repeatedly:

```
UNREACHED tigerbalm.feeds.relay.tools   252ms   (ensureRelay rejects)
REACHED   nos.lol                       440ms
EOSE from the DEAD relay after 158ms with 0 events
```

A dead relay EOSEs faster than a healthy one connects, with zero events —
byte-identical to a healthy relay that hosts nothing.

**Connecting is the signal.** `pool.ensureRelay(url)` rejects on a relay that is
down and resolves ~instantly for an already-open socket, so the check is free on
the happy path.

## The primitive

`client/src/lib/relay-reach.ts`:

```ts
const { data: groups, reached } = await withReach(url, [], () => fetchGroups(url));
if (!reached) return <CouldntReach />;   // NOT "no groups"
```

`Reached<T>` · `canReachRelay` · `withReach` · `canReachAny` (for a relay set:
reached if **any** answered — one live relay out of five is a thin answer, but
it is an answer).

`withReach` deliberately does **not** swallow errors from the fetch. A fetch
that genuinely throws is a different problem from a relay that is down, and
hiding it there would rebuild the same defect one layer up.

## Where a wrong answer is worst

Ranked by consequence, not frequency. A sentence is bad; these are worse.

1. **It publishes.** An empty read used as the BASE for a replaceable event
   erases the real one. `fetchSimpleGroupsList` → kind-10009 did this from six
   call sites. `lib/follow-list.ts` solved the identical bug for kind-3 in July.
   → **Never rebuild a replaceable event on a base you did not load.** Return a
   `blocked` flag and abort.
2. **It changes behaviour silently.** `checkNip86Support` turning a 502 into
   "not supported" also routed the operator's bans to localStorage.
3. **It decides authority.** Empty admins collapses every capability.
4. **It decides membership.** Empty members told people already in a room that
   they weren't, and replaced the composer with a Join button.
5. **It writes durable state.** OverviewTab appended `totalEvents: 0` to the
   operator's storage-trend history, drawing a cliff that never happened.

## Verify on the wire

Every defect in this class was found by pointing something at a live relay or
clicking in a browser. **None** were found by the test suite — including while
the suite was green and specifically covering the code in question.

Two ways I got this wrong, both worth repeating because both felt like rigour:

- **I wrote the mock to match my assumption.** The EOSE tests passed because I
  had encoded my belief about `SimplePool` into the fixture instead of
  measuring the library. A test you wrote the mock for only proves you are
  consistent with yourself.
- **I matched on an error string I had not observed.** The first NIP-86 fix
  keyed off `"HTTP 502"`, which never appears: our proxy catches the 502, fails
  to parse the HTML body, and answers **200** with `"Relay returned an HTML
  page"` — the same body a healthy relay serving its landing page produces. Only
  the upstream status separates them, and the proxy was discarding it.

`client/src/lib/nip86-reach.test.ts` is therefore pinned to payloads captured
from the real proxy against a real 502 and a real strfry, not to invented ones.

## Fixed

| Fetcher | Was claimed |
|---|---|
| `fetchGroupMetadata` (#570, + ops console) | "No Chat Rooms Found — be the first" |
| `fetchSimpleGroupsList` | every joined room shows "Join" — **and wiped the list** |
| `fetchGroupAdmins` | "No admins defined"; authority collapsed |
| `fetchGroupMembers` | "No members yet"; locked real members out of the composer |
| `fetchJoinRequests` | "Nobody is waiting." |
| `fetchGroupRoles` | "No roles defined by relay" |
| `fetchModerationLog` | "Nothing has been moderated here yet." |
| `checkNip86Support` | "Local-only mode"; bans silently local |
| `subscribeWithTimeout` | analytics zeros, written to durable history |

## What the library actually does (measured, and one of these corrects me)

Before designing anything for live subscriptions, four facts from
`node_modules/nostr-tools/lib/esm/index.js`:

- **A dead relay EOSEs.** `handleClose` calls `handleEose(i)` *before* recording
  the close (`:1188-97`), and a connect failure routes straight into it
  (`:1222-26`). EOSE can never promote anything to "connected".
- **A relay that never connected is ABSENT from `listConnectionStatus()`, not
  present-and-false.** `ensureRelay` does `catch { this.relays.delete(url); throw }`
  (`:1125-28`). *This corrects an earlier claim of mine that present-and-false
  meant "tried, down".* It means something narrower — see the next point.
- **A socket that dies after opening never fires `onclose`.** We pass
  `enableReconnect: true` (`nostr.ts:26`), so `handleHardClose` (`:668-82`)
  takes the `reconnect()` branch and calls neither `onclose` nor
  `closeAllSubscriptions`. The most common failure of a long-lived subscription
  is invisible to the failure channel; only the map sees it (`connected === false`).
- **`openPersistentSub` can ask nobody at all.** Three branches at
  `nostr.ts:800-812` call `handlers.oneose()` and return a no-op closer — empty
  relay list, invalid filter, or every relay filtered out by health. A pure
  "we never asked" that touches no socket, and today it renders "No messages yet."

Consequence: neither signal alone is sufficient. `onclose` is the only channel
that reports "the connect never happened"; polling is the only channel that
reports "we stopped being able to ask".

## Fixed as a side effect: relay health was being fed failures as successes

Because a dead relay EOSEs, `subscribeToFeed` (`nostr.ts:641`) and
`throttledPoolSubscribe` (`:984`) called `markRelaySuccess` for relays whose
socket never opened. That function does not merely fail to penalise:

```
successCount++
failures = Math.max(0, failures - 1)   // removes a prior failure
cooldownUntil = 0                      // wipes the cooldown
```

So a dead relay **cleared its own cooldown by failing**, was handed straight
back by `getHealthyRelays`, and failed again — it could never cool down on this
path. Both sites now defer the credit by a microtask and cancel it if `onclose`
lands, which works only because the close arrives in the same turn.
`relay-health-credit.test.ts` pins that ordering against the real library and
asserts both halves: crediting synchronously still would be wrong, crediting a
microtask later is not.

## Not fixed — and why `withReach` is the wrong tool there

An audit confirmed **10 more** instances. They are real, and they are a
different shape: **long-lived, multi-relay subscriptions**, not one-shot fetches
against one named relay.

- `subscribeChannel` → "No messages yet. Say hello." on an active channel
- `subscribeGovernance` → "Nothing has happened here yet."; roster of 1
- `subscribeDiscussion` → "No comments yet" on the public guest page
- `subscribeToFeed` → "No posts yet." as a profile's note stream
- `fetchUserProfileStats` / `fetchFollowersList` / `fetchThreadRepliesStreaming`
  (primal-cache) → "0 followers", "No followers found", "No replies yet"
- `acceptInviteLink` → "Invite invalid or revoked" for a good invite
- `fetchBadgeDefinitionsByAuthor`, `probeAuthorActivityBatch` → "No activity seen"

Gating these on `ensureRelay` would be wrong twice over: it adds a
connect-round-trip to the hottest paths in the app, and the answer goes stale
the moment a relay reconnects — which for a subscription that lives for minutes
is most of its lifetime. These need a **connection-state signal that updates
over the life of the subscription**, surfaced as "still connecting / lost the
relay" rather than a prefetch gate. That is a design task, not a sweep.

`acceptInviteLink` is its own case: a bundle that has not propagated yet is
indistinguishable from one that was revoked, and no reachability check fixes
that — it needs a retry-and-say-so flow.

## Rule

**Never state a fact about the world derived from a fetch that could not
happen.** If the fetch can't fail loudly, give it a `reached` flag and make the
UI branch on it. If the empty value feeds a *publish*, abort instead.
