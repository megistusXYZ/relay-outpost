/**
 * A direct invite we send must open in Armada. Until 2026-09-12 only the other
 * direction had been tried (an Armada group joined here); the first invite from
 * a group made here reached the recipient's inbox and showed nothing in Armada.
 *
 * Armada's receive steps, copied from its source (gitlab soapbox-pub/armada,
 * main, 2026-09): the scan `{kinds:[1059], "#p":[me], "#k":["3313"]}` on the
 * recipient's inbox relays (useDirectInvites.ts, inviteRelays.ts), the unwrap
 * (directInvite.ts `unwrapDirectInvite`: kind-13 seal, rumor author = seal
 * author), the parse (`parseDirectInviteRumor`: kind 3313, string id + name),
 * and the validation (invite.ts `validateBundle`: ≤256 channels, and the id
 * must reproduce from owner + salt, derive.ts `communityIdOf`).
 */
import { describe, it, expect, vi } from "vitest";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { generateSecretKey, getPublicKey, finalizeEvent, type Event } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";

const inboxSends: { relays: string[]; event: Event }[] = [];
vi.mock("@/lib/outbox", () => ({
  fetchDMRelayList: async () => {},
  hasDMRelayList: () => true,
  getDMRelaysForContact: () => ["wss://inbox.example"],
  getDMRelayListCached: () => ["wss://inbox.example"],
  getLocalDMRelays: () => [],
  getMyDMReceiveRelays: () => [],
  DM_FALLBACK_RELAYS: [],
}));
vi.mock("@/lib/dm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dm")>()),
  publishWithFallback: async (relays: string[], event: Event) => { inboxSends.push({ relays, event }); },
}));

import { sendDirectInvite } from "./concord-invites";
import { deriveCommunityId } from "./concord-crypto";
import type { StoredCommunity } from "./concord-keys";

const person = () => {
  const sk = generateSecretKey();
  const signer = {
    signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
    nip44: {
      encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
      decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
    },
  } as unknown as ISigner & { nip44: { decrypt: (pk: string, c: string) => Promise<string> } };
  return { pubkey: getPublicKey(sk), signer };
};

// ── Armada's receive steps ──────────────────────────────────────────────────
async function armadaUnwrap(wrap: Event, me: ReturnType<typeof person>) {
  if (wrap.kind !== 1059) return undefined;
  try {
    const seal = JSON.parse(await me.signer.nip44.decrypt(wrap.pubkey, wrap.content)) as Event;
    if (seal.kind !== 13) return undefined;
    const rumor = JSON.parse(await me.signer.nip44.decrypt(seal.pubkey, seal.content)) as { kind: number; content: string; pubkey: string };
    if (rumor.pubkey !== seal.pubkey) return undefined;
    return { rumor, sender: seal.pubkey };
  } catch { return undefined; }
}

function armadaParse(kind: number, content: string) {
  if (kind !== 3313) return undefined;
  try {
    const b = JSON.parse(content);
    if (typeof b.community_id !== "string" || typeof b.name !== "string") return undefined;
    if (!Array.isArray(b.channels)) b.channels = [];
    if (b.channels.length > 256) return undefined;
    const id = bytesToHex(sha256(concatBytes(utf8ToBytes("concord/community"), hexToBytes(b.owner), hexToBytes(b.owner_salt))));
    return id === b.community_id.toLowerCase() ? b : undefined;
  } catch { return undefined; }
}

const hex32 = () => bytesToHex(generateSecretKey());

function groupOwnedBy(owner: string): StoredCommunity {
  const owner_salt = hex32();
  return {
    community_id: deriveCommunityId(owner, owner_salt), owner, owner_salt,
    community_root: hex32(), root_epoch: 0, control_pk: getPublicKey(generateSecretKey()),
    channels: [{ id: hex32(), epoch: 0, name: "general", isPrivate: false }],
    relays: ["wss://relay.damus.io", "wss://nos.lol"], name: "Testing 51", addedAt: 1,
  } as StoredCommunity;
}

async function sendTo(recipient: ReturnType<typeof person>) {
  const me = person();
  const group = groupOwnedBy(me.pubkey);
  const sent: { relays: string[]; event: Event }[] = [];
  inboxSends.length = 0;
  const ok = await sendDirectInvite(me.signer, me.pubkey, recipient.pubkey, group, async (event, relays) => { sent.push({ relays, event }); });
  return { me, group, ok, groupSend: sent[0], inboxSend: inboxSends[0] };
}

describe("a direct invite we send, as Armada receives it", () => {
  it("opens: a kind-13 seal from us, a kind-3313 rumor, and a group Armada accepts", async () => {
    const handled = person();
    const { me, group, ok, groupSend } = await sendTo(handled);
    expect(ok).toBe(true);
    const opened = await armadaUnwrap(groupSend.event, handled);
    expect(opened?.sender).toBe(me.pubkey);
    const bundle = armadaParse(opened!.rumor.kind, opened!.rumor.content);
    expect(bundle?.community_id).toBe(group.community_id);
    expect(bundle?.name).toBe("Testing 51");
  });

  it("is addressed the way Armada looks for it: p-tagged to them, k=3313, on their inbox relays", async () => {
    const handled = person();
    const { inboxSend } = await sendTo(handled);
    expect(inboxSend.relays).toEqual(["wss://inbox.example"]);
    // Armada's `#p` / `#k` filter matches on the value alone (a relay hint may follow).
    expect(inboxSend.event.tags.some((t) => t[0] === "p" && t[1] === handled.pubkey)).toBe(true);
    expect(inboxSend.event.tags.some((t) => t[0] === "k" && t[1] === "3313")).toBe(true);
  });

  it("the copied check can refuse: a group whose owner doesn't reproduce its id is dropped", () => {
    const g = groupOwnedBy(getPublicKey(generateSecretKey()));
    expect(armadaParse(3313, JSON.stringify({ ...g, owner: getPublicKey(generateSecretKey()) }))).toBeUndefined();
  });
});
