/**
 * Moderation actions that must reach the relay, not just this browser.
 *
 * Relay Control's Events list had two actions that only looked like they
 * worked (found 2026-10-03):
 *  - "Block author" wrote a list kept in this browser; the relay never heard.
 *  - "Delete event" published a kind-5 deletion, which relays honour only from
 *    the post's own author, so an operator's delete of someone else's post was
 *    usually ignored.
 * When the relay has a NIP-86 management API, both now go through it (banpubkey,
 * banevent). When it doesn't, or can't be reached, the caller is told plainly
 * so the screen can say nothing reached the relay.
 */
import { checkNip86Support, banPubkey, banEvent, type Nip86SupportStatus } from "./nip86";

export type ModerationOutcome =
  | { onRelay: true }
  | { onRelay: false; reason: "no-api" | "unreachable" }
  | { onRelay: false; reason: "error"; message: string };

export interface ModerationDeps {
  support?: (relayUrl: string) => Promise<Nip86SupportStatus>;
  ban?: (relayUrl: string, pubkey: string, reason?: string) => Promise<{ result?: unknown; error?: string }>;
  banEvent?: (relayUrl: string, eventId: string, reason?: string) => Promise<{ result?: unknown; error?: string }>;
}

// One probe per relay for a few minutes: the support check signs a request.
const supportCache = new Map<string, { status: Nip86SupportStatus; at: number }>();
const SUPPORT_TTL_MS = 5 * 60 * 1000;
async function cachedSupport(relayUrl: string): Promise<Nip86SupportStatus> {
  const hit = supportCache.get(relayUrl);
  if (hit && Date.now() - hit.at < SUPPORT_TTL_MS) return hit.status;
  const status = await checkNip86Support(relayUrl);
  if (status !== "unreachable") supportCache.set(relayUrl, { status, at: Date.now() });
  return status;
}

async function viaApi(
  relayUrl: string,
  call: () => Promise<{ result?: unknown; error?: string }>,
  support: (relayUrl: string) => Promise<Nip86SupportStatus>,
): Promise<ModerationOutcome> {
  const status = await support(relayUrl);
  if (status === "unreachable") return { onRelay: false, reason: "unreachable" };
  if (status !== "supported") return { onRelay: false, reason: "no-api" };
  try {
    const res = await call();
    if (res.error) return { onRelay: false, reason: "error", message: res.error };
    return { onRelay: true };
  } catch (err) {
    return { onRelay: false, reason: "error", message: err instanceof Error ? err.message : "The relay didn't answer" };
  }
}

export function blockAuthorOnRelay(relayUrl: string, pubkey: string, deps: ModerationDeps = {}): Promise<ModerationOutcome> {
  const ban = deps.ban ?? banPubkey;
  return viaApi(relayUrl, () => ban(relayUrl, pubkey, "Blocked from Relay Control"), deps.support ?? cachedSupport);
}

export function removeEventOnRelay(relayUrl: string, eventId: string, deps: ModerationDeps = {}): Promise<ModerationOutcome> {
  const remove = deps.banEvent ?? banEvent;
  return viaApi(relayUrl, () => remove(relayUrl, eventId, "Removed from Relay Control"), deps.support ?? cachedSupport);
}
