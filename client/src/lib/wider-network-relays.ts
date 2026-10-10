/**
 * What flipping the wider-network switch publishes (owner, 2026-10-10;
 * lib/network-mode.ts): the account's kind-10002 relay list and its kind-10050
 * DM inbox, rewritten for the new mode by lib/signup-relays.ts.
 *
 * kind-10002 is REPLACEABLE. A list built on a read nobody answered would
 * erase the real one, so the flip refuses rather than guesses — the rule
 * every relay-list write here follows (updateNip65RelayList). The caller
 * (the switch sheet) reverts the switch on "unanswered" or "failed".
 */
import { relayTagsForMode, floorDmRelayList } from "./signup-relays";

export type RelayListPublishResult = "published" | "unanswered" | "failed";

export interface RelayListDeps {
  pubkey: string;
  signer: { signEvent: (t: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<unknown> };
  fetchCurrent: (pubkey: string) => Promise<{ tags: string[][]; answered: boolean }>;
  publish: (event: any, relays?: string[]) => Promise<boolean>;
  publishDmList: (relays: string[]) => Promise<boolean>;
  joinedCommunityRelays: string[];
}

/** The open DM fallbacks an account with the wider network on advertises. */
const OPEN_DM_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

export async function publishRelayListForMode(on: boolean, deps: RelayListDeps): Promise<RelayListPublishResult> {
  const { tags, answered } = await deps.fetchCurrent(deps.pubkey);
  if (!answered) return "unanswered";
  const next = relayTagsForMode(on, tags, deps.joinedCommunityRelays);
  const signed = await deps.signer.signEvent({ kind: 10002, created_at: Math.floor(Date.now() / 1000), tags: next, content: "" });
  if (!signed) return "failed";
  const ok = await deps.publish(signed);
  if (!ok) return "failed";
  // Best effort: the inbox list is small and replaceable in the same way,
  // but a miss here costs reach, not data — the 10002 already went out.
  try { await deps.publishDmList(on ? [...OPEN_DM_RELAYS] : floorDmRelayList()); } catch {}
  return "published";
}

/** The app's real wiring for the sheet (slice 2). Lazy imports keep this module pure for tests. */
export async function publishRelayListForModeLive(on: boolean, pubkey: string, signer: RelayListDeps["signer"]): Promise<RelayListPublishResult> {
  const [{ fetchCurrentRelayList, getOutpostRelays }, { publishEvent }, { publishDMRelayList, RELAY_LIST_RELAYS }] = await Promise.all([
    import("./outpost-relays"),
    import("./nostr"),
    import("./outbox"),
  ]);
  return publishRelayListForMode(on, {
    pubkey,
    signer,
    fetchCurrent: fetchCurrentRelayList,
    publish: (ev) => publishEvent(ev, [...RELAY_LIST_RELAYS]),
    publishDmList: (relays) => publishDMRelayList(relays, signer),
    joinedCommunityRelays: getOutpostRelays().map((r) => r.url),
  });
}
