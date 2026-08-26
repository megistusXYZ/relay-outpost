/**
 * Resolve a Concord invite LINK card to the real group it points at — the
 * group's photo, name, and a short description — by fetching + decrypting the
 * kind-33301 invite bundle the link's naddr coordinate carries.
 *
 * The group name/icon/channels live ENCRYPTED in the bundle; a link card can't
 * show them from URL-shape parsing alone. This module derives the fetch params
 * (link_signer pubkey + bootstrap relays + secret token) from the invite target
 * and decrypts the bundle with the fragment token — the SAME data the accept
 * screen already decrypts, so it leaks nothing the recipient doesn't already
 * hold (the token is in the link they were sent). It reuses the accept-path
 * helpers (`decodeFragment`, `decryptBundle`, `isRevokedBundleEvent`) and the
 * fixed canonical `bundleKeyFromToken`.
 *
 * SECURITY/PRIVACY: the `#fragment` secret stays client-side — it is decoded
 * here and used only to derive the local NIP-44 key; it is never sent anywhere.
 * The network fetch is injected (the caller passes a relay-subscribe closure),
 * so this module stays free of the I/O layer and its pure mapping/derivation is
 * unit-testable in the node env.
 *
 * Resolution is CACHED by naddr (module-level): a link resolves ONCE, not per
 * render, and concurrent card instances share one in-flight fetch.
 */
import { nip19, type Event } from "nostr-tools";
import { decodeFragment, decryptBundle, isRevokedBundleEvent, type InviteBundle } from "./concord-invites";
import { KIND_INVITE_BUNDLE } from "./concord-events";

/** What the fixed-height card actually renders — content swapped into its existing slots. */
export interface InviteDisplay {
  /** Group icon URL for the photo slot; undefined → keep the lock glyph. */
  photo?: string;
  /** Group name → the card title. */
  title: string;
  /** Short description → the card subtitle. */
  subtitle: string;
}

/**
 * Pure map: decrypted bundle → the three display fields, with the generic
 * fallbacks the card already shows when a field is absent. Never throws.
 *   name  → title      (fallback "Group chat invite")
 *   label → subtitle   (an invite/description note, when present)
 *   else channels.length → "N channels · encrypted"
 *   else  → "Join this encrypted group in Relay Outpost"
 *   icon  → photo       (fallback: undefined → lock glyph)
 */
export function bundleToDisplay(
  bundle: Pick<InviteBundle, "name" | "icon" | "channels" | "label">,
): InviteDisplay {
  const title = bundle.name?.trim() || "Group chat invite";

  const desc = typeof bundle.label === "string" ? bundle.label.trim() : "";
  let subtitle: string;
  if (desc) {
    subtitle = desc;
  } else if (Array.isArray(bundle.channels) && bundle.channels.length) {
    const n = bundle.channels.length;
    subtitle = `${n} channel${n === 1 ? "" : "s"} · encrypted`;
  } else {
    subtitle = "Join this encrypted group in Relay Outpost";
  }

  // Armada bundles carry `icon` as an encrypted-blob OBJECT — decryptBundle
  // normalizes that away, but stay string-guarded here too ("never throws").
  const photo = typeof bundle.icon === "string" ? bundle.icon.trim() || undefined : undefined;
  return { photo, title, subtitle };
}

/** Fetch params derived from an invite link (all client-side; the token never leaves). */
export interface InviteResolveParams {
  /** The one-use link_signer pubkey that authored the 33301 bundle. */
  linkSigner: string;
  /** Bootstrap relays to fetch the bundle from (naddr relays ∪ fragment relays). */
  relays: string[];
  /** The 16-byte secret token used to derive the NIP-44 bundle key. */
  token: Uint8Array;
}

/**
 * Pure extraction of the naddr + token: decode the fragment (token + bootstrap
 * relays) and the naddr (link_signer + coordinate relays), verifying the naddr
 * is a kind-33301 invite-bundle coordinate. Returns null when there is no
 * fragment (can't decrypt), the fragment is malformed, or the naddr is wrong —
 * every case where the card must stay generic.
 */
export function deriveInviteResolveParams(invite: { naddr: string; fragment: string }): InviteResolveParams | null {
  if (!invite.fragment) return null; // no secret in the link → nothing to decrypt
  const frag = decodeFragment(invite.fragment);
  if (!frag) return null;

  let decoded: nip19.DecodedResult;
  try {
    decoded = nip19.decode(invite.naddr);
  } catch {
    return null;
  }
  if (decoded.type !== "naddr" || decoded.data.kind !== KIND_INVITE_BUNDLE) return null;

  const relays = [...new Set([...(decoded.data.relays ?? []), ...frag.relays])];
  return { linkSigner: decoded.data.pubkey, relays, token: frag.token };
}

// ── Cache (keyed by naddr) ────────────────────────────────────────────────────
const resolved = new Map<string, InviteBundle>(); // successful decrypts
const dead = new Set<string>();                    // definitively unresolvable (revoked/expired/undecryptable/bad params)
const inflight = new Map<string, Promise<InviteBundle | null>>();

/** Fetch the freshest 33301 for `linkSigner` from `relays`, or null. */
export type FetchBundleEvent = (linkSigner: string, relays: string[]) => Promise<Event | null>;

/**
 * Resolve the group bundle for an invite link, cached by naddr so it fetches +
 * decrypts once. Returns the decrypted bundle, or null on ANY failure (no
 * token, malformed, revoked, expired, unreachable, or undecryptable/legacy) —
 * the caller renders the generic card for null. A transient "no event found"
 * is NOT cached (a later render can retry); definitive negatives are.
 */
export async function resolveInviteBundle(
  invite: { naddr: string; fragment: string },
  fetchEvent: FetchBundleEvent,
): Promise<InviteBundle | null> {
  const key = invite.naddr;
  const hit = resolved.get(key);
  if (hit) return hit;
  if (dead.has(key)) return null;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<InviteBundle | null> => {
    const params = deriveInviteResolveParams(invite);
    if (!params) {
      dead.add(key);
      return null;
    }
    const event = await fetchEvent(params.linkSigner, params.relays).catch(() => null);
    if (!event) return null; // transient (unreachable/not-yet-propagated) — allow retry, don't poison
    if (isRevokedBundleEvent(event)) {
      dead.add(key);
      return null;
    }
    const bundle = decryptBundle(event.content, params.token);
    if (!bundle) {
      dead.add(key);
      return null;
    }
    if (bundle.expires_at && Date.now() > bundle.expires_at) {
      dead.add(key);
      return null;
    }
    resolved.set(key, bundle);
    return bundle;
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/** Test-only: clear the module cache between cases. */
export function __clearInviteBundleCache(): void {
  resolved.clear();
  dead.clear();
  inflight.clear();
}
