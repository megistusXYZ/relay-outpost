/**
 * NIP-42 AUTH with DERIVED Concord stream keys (Armada interop).
 *
 * Armada-flavored community relays (relay.ditto.pub, relay.dreamith.to) gate
 * kind-1059 REQs: `CLOSED "auth-required: all authors or all #p tags must be
 * authenticated"`. The authors of a Concord wrap REQ are the community's
 * derived PLANE pubkeys (control/guestbook/channel/rekey planes), so the
 * challenge must be answered with kind-22242s signed by the PLANE secret keys
 * — which every invite-holder derives from `community_root` — not the user's
 * key. Without this, every governance/channel fetch on such relays returns
 * zero events and a joined Armada community stays blank.
 *
 * Mechanics: the Concord subscribe entry points register their plane keys per
 * community relay. When a relay challenges,
 *  - `planeAuthForSubscription` (wired into the pool subscription's `onauth`)
 *    recognizes a REQ whose authors are ALL registered planes, signs one 22242
 *    per plane, sends all but the first directly on the relay socket, and
 *    returns the first for nostr-tools to send + track. Relays process frames
 *    in order, so every plane is authenticated before nostr-tools' own AUTH
 *    resolves and the re-REQ goes out (verified against the live relays).
 *  - `armPlaneAuth` (called on registration + before each subscribe) covers
 *    the paths nostr-tools' one-AUTH-per-connection cache can't: it
 *    direct-sends AUTH frames for not-yet-authenticated planes whenever the
 *    connection already holds a challenge, so a later subscription (channel
 *    planes registered after governance already authed) or a resilient reopen
 *    still authenticates before its REQ frame.
 *
 * Scope/safety: read-side only — a 22242 AUTH response is a socket handshake,
 * not a stored relay event, and it identifies a derived plane (not the user).
 * Registrations are session-scoped (module memory; the sks are already held in
 * IDB for every joined community). Publishing is untouched.
 */
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools";
import { getPoolRelay } from "@/lib/nip42-auth";
import type { GroupKey } from "./concord-crypto";

/** normalized relay url → plane pk → plane sk */
const registry = new Map<string, Map<string, Uint8Array>>();
/** normalized relay url → AUTHs already sent for the connection's current challenge */
const sentByRelay = new Map<string, { challenge: string; sent: Set<string> }>();

const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

function buildPlaneAuth(relayTagUrl: string, challenge: string, sk: Uint8Array): VerifiedEvent {
  return finalizeEvent({
    kind: 22242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["relay", relayTagUrl], ["challenge", challenge]],
    content: "",
  }, sk);
}

function sentFor(relayKey: string, challenge: string): Set<string> {
  let s = sentByRelay.get(relayKey);
  if (!s || s.challenge !== challenge) {
    s = { challenge, sent: new Set() };
    sentByRelay.set(relayKey, s); // reconnect ⇒ fresh challenge ⇒ resend all
  }
  return s.sent;
}

/**
 * Register the plane keys a Concord subscription will REQ as `authors` on
 * `relays`. Idempotent; retroactively AUTHs any already-challenged connection
 * so planes registered after the connection's first (cached) nostr-tools auth
 * still authenticate.
 */
export function registerPlaneAuth(relays: string[], planes: GroupKey[]): void {
  if (planes.length === 0) return;
  for (const r of relays) {
    const key = norm(r);
    if (!key) continue;
    let m = registry.get(key);
    if (!m) { m = new Map(); registry.set(key, m); }
    for (const p of planes) if (!m.has(p.pk)) m.set(p.pk, p.sk);
    armPlaneAuth(r, planes.map((p) => p.pk));
  }
}

/**
 * Direct-send AUTH frames for the given plane authors on an already-challenged
 * relay connection. No-op when the relay has no pending challenge, none of the
 * authors are registered planes, or the frames were already sent for this
 * challenge. Frames go out before any subsequent REQ frame on the same socket,
 * so the relay sees them first.
 */
export function armPlaneAuth(relayUrl: string, authors: readonly string[] | undefined): void {
  if (!authors?.length) return;
  const key = norm(relayUrl);
  const m = registry.get(key);
  if (!m) return;
  const relay = getPoolRelay(relayUrl);
  const challenge = relay?.challenge;
  if (!relay || !challenge) return;
  const sent = sentFor(key, challenge);
  for (const pk of authors) {
    const sk = m.get(pk);
    if (!sk || sent.has(pk)) continue;
    try {
      const evt = buildPlaneAuth(relay.url ?? relayUrl, challenge, sk);
      void relay.send('["AUTH",' + JSON.stringify(evt) + "]")?.catch?.(() => {});
      sent.add(pk);
    } catch { /* connection died — the resilient reopen re-arms */ }
  }
}

/**
 * The `onauth` hook: when a CLOSED-auth-required subscription's filter authors
 * are ALL registered planes for this relay, answer with plane-key AUTH — the
 * extras direct-sent (in-order before nostr-tools' AUTH + re-REQ), the first
 * returned for nostr-tools to send and await the OK for. Returns null when
 * this isn't a plane REQ, so the caller falls through to the user-key signer
 * (the DM inbox-relay path) unchanged.
 */
export function planeAuthForSubscription(
  relayUrl: string,
  authors: readonly string[] | undefined,
  template: EventTemplate,
): VerifiedEvent | null {
  if (!authors?.length) return null;
  const key = norm(relayUrl);
  const m = registry.get(key);
  if (!m || !authors.every((a) => m.has(a))) return null;
  const challenge = template.tags?.find((t) => t[0] === "challenge")?.[1];
  if (!challenge) return null;

  const relayTagUrl = template.tags?.find((t) => t[0] === "relay")?.[1] || relayUrl;
  const sent = sentFor(key, challenge);
  const relay = getPoolRelay(relayUrl);
  const [primary, ...extras] = authors;
  for (const pk of extras) {
    const sk = m.get(pk);
    if (!sk || sent.has(pk)) continue;
    try {
      const evt = buildPlaneAuth(relayTagUrl, challenge, sk);
      void relay?.send('["AUTH",' + JSON.stringify(evt) + "]")?.catch?.(() => {});
      sent.add(pk);
    } catch { /* best-effort; the re-REQ CLOSED path re-arms via armPlaneAuth */ }
  }
  // Always (re-)sign the primary — nostr-tools needs a fresh event to send and
  // await; a duplicate AUTH for an already-authenticated plane is harmless.
  sent.add(primary);
  return buildPlaneAuth(relayTagUrl, challenge, m.get(primary)!);
}

/** Test-only: reset module state between cases. */
export function __clearPlaneAuth(): void {
  registry.clear();
  sentByRelay.clear();
}
