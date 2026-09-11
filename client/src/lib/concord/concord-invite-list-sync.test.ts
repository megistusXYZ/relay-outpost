import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent, type Event, type Filter } from "nostr-tools";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import { KIND_INVITE_LIST } from "./concord-events";
import { syncInviteList, type InviteStore } from "./concord-invite-list-sync";
import type { ListRelays } from "./community-list-sync";
import type { StoredInviteSigner } from "./concord-keys";

const GROUP = "cd".repeat(32);
const url = (s: { token: string }) => `https://example.app/invite/x#${s.token}`;

const account = () => {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signer = {
    signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
    nip44: {
      encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
      decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
    },
  } as unknown as ISigner;
  return { pubkey, signer, sk };
};

/** One relay holding replaceable events, and how the sync sees it. */
const relay = () => {
  const events: Event[] = [];
  const at = (answered = true, allAnswered = answered): ListRelays => ({
    fetch: async (f: Filter) => ({ events: answered ? events.filter((e) => f.kinds!.includes(e.kind) && f.authors!.includes(e.pubkey)) : [], answered, allAnswered }),
    publish: async (e) => {
      const i = events.findIndex((x) => x.kind === e.kind && x.pubkey === e.pubkey);
      if (i >= 0) events.splice(i, 1);
      events.push(e);
    },
  });
  return { events, at };
};

/** A device's link store, as IndexedDB keeps it. */
const device = (links: StoredInviteSigner[] = []) => {
  const rows = new Map(links.map((l) => [l.linkSignerPubkey, l]));
  const store: InviteStore = { all: async () => [...rows.values()], put: async (s) => { rows.set(s.linkSignerPubkey, s); } };
  let seen = false;
  return { rows, store, memory: { seen: () => seen, markSeen: () => { seen = true; } } };
};

const minted = (over: Partial<StoredInviteSigner> = {}): StoredInviteSigner => {
  const sk = generateSecretKey();
  return {
    communityId: GROUP, linkSignerPubkey: getPublicKey(sk), linkSignerSecret: bytesToHex(sk),
    token: bytesToHex(generateSecretKey().slice(0, 16)), createdAt: 1_719_800_000_000, label: "Bio link", ...over,
  };
};

describe("syncInviteList: your links on every device", () => {
  it("a link made on one device reaches the other, with what it needs to turn it off", async () => {
    const me = account(), r = relay();
    const link = minted();
    const a = device([link]), b = device();
    expect(await syncInviteList(me, r.at(), a.store, a.memory, url)).toMatchObject({ status: "synced", written: true });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].kind).toBe(KIND_INVITE_LIST);
    expect(r.events[0].content).not.toContain(link.linkSignerSecret); // encrypted to yourself

    await syncInviteList(me, r.at(), b.store, b.memory, url);
    expect(b.rows.get(link.linkSignerPubkey)).toEqual(link);
  });

  it("a link turned off on one device is turned off on the other, and stays off", async () => {
    const me = account(), r = relay();
    const link = minted();
    const a = device([link]), b = device([link]);
    await syncInviteList(me, r.at(), a.store, a.memory, url);
    await b.store.put({ ...link, revoked: true });
    await syncInviteList(me, r.at(), b.store, b.memory, url);
    await syncInviteList(me, r.at(), a.store, a.memory, url);
    expect(a.rows.get(link.linkSignerPubkey)?.revoked).toBe(true);
    // A's stale copy can't bring it back.
    const again = await syncInviteList(me, r.at(), a.store, a.memory, url);
    expect(again).toMatchObject({ written: false });
  });

  it("writes nothing when no relay answered", async () => {
    const me = account(), r = relay();
    const a = device([minted()]);
    expect(await syncInviteList(me, r.at(false), a.store, a.memory, url)).toEqual({ status: "unreachable" });
    expect(r.events).toHaveLength(0);
  });

  it("never starts a list over one it couldn't see: a first write needs every relay to answer", async () => {
    const me = account(), r = relay();
    const a = device([minted()]);
    expect(await syncInviteList(me, r.at(true, false), a.store, a.memory, url)).toMatchObject({ written: false });
    expect(r.events).toHaveLength(0);
  });

  it("never overwrites a list it can't open", async () => {
    const me = account(), r = relay();
    await r.at().publish(finalizeEvent({ kind: KIND_INVITE_LIST, created_at: 1, tags: [], content: "not for us" }, me.sk));
    const a = device([minted()]);
    expect(await syncInviteList(me, r.at(), a.store, a.memory, url)).toEqual({ status: "unreadable" });
    expect(r.events[0].content).toBe("not for us");
  });

  it("leaves a list that already has everything alone", async () => {
    const me = account(), r = relay();
    const a = device([minted()]);
    await syncInviteList(me, r.at(), a.store, a.memory, url);
    const before = r.events[0].id;
    expect(await syncInviteList(me, r.at(), a.store, a.memory, url)).toMatchObject({ written: false });
    expect(r.events[0].id).toBe(before);
  });
});
