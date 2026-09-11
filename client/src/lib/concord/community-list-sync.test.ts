/**
 * Your groups following you between devices, end to end: two devices of the
 * same account sync through one relay, with real NIP-44 and real signatures.
 * The relay keeps one copy per address, newest wins, as NIP-01 requires of
 * addressable and replaceable events; only the key store is in memory.
 */
import { describe, it, expect } from "vitest";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { getPublicKey, generateSecretKey, finalizeEvent, type Event, type Filter } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { syncList, type ListStore } from "./community-list-sync";
import { hexToB64u } from "./community-list";
import type { StoredCommunity } from "./concord-keys";

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const signer = {
  signEvent: async (t: unknown) => finalizeEvent({ ...(t as object) } as never, sk),
  nip44: {
    encrypt: async (pk: string, p: string) => nip44v2.encrypt(p, nip44v2.utils.getConversationKey(sk, pk)),
    decrypt: async (pk: string, c: string) => nip44v2.decrypt(c, nip44v2.utils.getConversationKey(sk, pk)),
  },
} as unknown as ISigner;
const me = { signer, pubkey };

const hex = (b: string) => b.repeat(32);
const group = (idByte: string, over: Partial<StoredCommunity> = {}): StoredCommunity => ({
  community_id: hex(idByte), owner: hex("0b"), owner_salt: hex("0c"), community_root: hex("0d"), root_epoch: 3,
  channels: [{ id: hex("1c"), epoch: 3, name: "general", isPrivate: false }],
  relays: ["wss://r"], name: `Group ${idByte}`, addedAt: 1_719_800_000_000, ...over,
});

function fakeRelay() {
  const stored: Event[] = [];
  const published: Event[] = [];
  let answers = true;
  let partial = false;
  const address = (e: Event) =>
    e.kind >= 30000 && e.kind < 40000 ? `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === "d")?.[1] ?? ""}`
      : e.kind >= 10000 && e.kind < 20000 ? `${e.kind}:${e.pubkey}` : e.id;
  return {
    stored, published,
    goOffline: () => { answers = false; },
    comeBack: () => { answers = true; },
    /** Some relay answered; the one holding the List did not. */
    partly: () => { partial = true; },
    relays: {
      async fetch(filter: Filter) {
        if (!answers) return { events: [], answered: false, allAnswered: false };
        if (partial) return { events: [], answered: true, allAnswered: false };
        return { events: stored.filter((e) => filter.kinds!.includes(e.kind) && filter.authors!.includes(e.pubkey)), answered: true, allAnswered: true };
      },
      async publish(e: Event) {
        if (!answers) throw new Error("offline");
        published.push(e);
        const i = stored.findIndex((x) => address(x) === address(e));
        if (i >= 0 && stored[i].created_at >= e.created_at) return;
        if (i >= 0) stored.splice(i, 1);
        stored.push(e);
      },
    },
  };
}

/** One device of the account: its key store, its leave ledger, its "seen" flag. */
function device(relay: ReturnType<typeof fakeRelay>, groups: StoredCommunity[] = []) {
  const held = new Map(groups.map((g) => [g.community_id, g]));
  const left: Record<string, number> = {};
  let seen = false;
  const store: ListStore = {
    all: async () => [...held.values()],
    add: async (r) => { held.set(r.community_id, r); },
    remove: async (id) => { held.delete(id); },
    advance: async (r) => { held.set(r.community_id, r); },
  };
  const memory = { left: () => ({ ...left }), seen: () => seen, markSeen: () => { seen = true; } };
  return {
    held,
    ids: () => [...held.keys()].sort(),
    sync: (nowMs = 1_790_000_000_000) => syncList(me, relay.relays, store, memory, nowMs),
    leave: (id: string, at: number) => { held.delete(id); left[id] = at; },
  };
}

describe("your groups follow you to your other devices", () => {
  it("a group joined on one device appears on the other", async () => {
    const relay = fakeRelay();
    const phone = device(relay, [group("0a")]);
    const laptop = device(relay);
    await phone.sync();
    const res = await laptop.sync();
    expect(laptop.ids()).toEqual([hex("0a")]);
    expect(res).toMatchObject({ status: "synced", changedHere: true });
    // The keys came with it: this device can open the group.
    expect(laptop.held.get(hex("0a"))?.community_root).toBe(hex("0d"));
  });
});

describe("leaving, and what must never be lost", () => {
  it("a group left on one device is dropped on the other, keys and all", async () => {
    const relay = fakeRelay();
    const phone = device(relay, [group("0a"), group("0b")]);
    const laptop = device(relay);
    await phone.sync();
    await laptop.sync();
    phone.leave(hex("0a"), 1_790_000_000_000);
    await phone.sync(1_790_000_001_000);
    await laptop.sync(1_790_000_002_000);
    expect(laptop.ids()).toEqual([hex("0b")]);
  });

  it("a group left while the relays were out of reach doesn't come back, and the leave goes out later", async () => {
    const relay = fakeRelay();
    const phone = device(relay, [group("0a")]);
    await phone.sync();
    relay.goOffline();
    phone.leave(hex("0a"), 1_790_000_000_000);
    expect(await phone.sync()).toEqual({ status: "unreachable" });
    relay.comeBack();
    // The List still lists the group: it must not be taken back up from it.
    await phone.sync(1_790_000_005_000);
    expect(phone.ids()).toEqual([]);
    const laptop = device(relay, [group("0a")]);
    await laptop.sync(1_790_000_006_000);
    expect(laptop.ids()).toEqual([]);
  });

  it("a device that holds only some of your groups never drops the rest from the list", async () => {
    const relay = fakeRelay();
    await device(relay, [group("0a"), group("0b")]).sync();
    const tablet = device(relay, [group("0c")]);
    await tablet.sync();
    expect(tablet.ids()).toEqual([hex("0a"), hex("0b"), hex("0c")]);
    const laptop = device(relay);
    await laptop.sync();
    expect(laptop.ids()).toEqual([hex("0a"), hex("0b"), hex("0c")]);
  });

  it("when no relay answers, nothing is written and nothing here changes", async () => {
    const relay = fakeRelay();
    relay.goOffline();
    const phone = device(relay, [group("0a")]);
    expect(await phone.sync()).toEqual({ status: "unreachable" });
    expect(relay.published).toEqual([]);
    expect(phone.ids()).toEqual([hex("0a")]);
  });

  it("a list this device has seen, missing from the relay now, is never started over from this device alone", async () => {
    const relay = fakeRelay();
    const phone = device(relay, [group("0a"), group("0b")]);
    await phone.sync();
    relay.stored.length = 0; // the relay lost it, or isn't the one holding it
    phone.held.delete(hex("0b"));
    const before = relay.published.length;
    const res = await phone.sync(1_790_000_010_000);
    expect(relay.published.length).toBe(before);
    expect(res).toMatchObject({ status: "synced", written: 0 });
  });

  it("a newer key version from another device is taken up here, the old one kept for history", async () => {
    const relay = fakeRelay();
    const phone = device(relay, [group("0a")]);
    await phone.sync();
    await device(relay, [group("0a", { root_epoch: 4, community_root: hex("4d") })]).sync();
    await phone.sync(1_790_000_030_000);
    expect(phone.held.get(hex("0a"))).toMatchObject({ root_epoch: 4, community_root: hex("4d") });
    expect(phone.held.get(hex("0a"))?.priorRoots).toContainEqual({ root: hex("0d"), epoch: 3 });
  });
});

describe("moving off the retired backup", () => {
  it("groups in the old backup move into the new list, and the old kind is never written", async () => {
    const relay = fakeRelay();
    const old = group("0a");
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: [{ community_id: old.community_id, seed: old, current: old, added_at: old.addedAt }], tombstones: [] }));
    await relay.relays.publish(await signer.signEvent({ kind: 13302, created_at: 1_780_000_000, tags: [], content } as never) as Event);
    relay.published.length = 0;
    const laptop = device(relay);
    await laptop.sync();
    expect(laptop.ids()).toEqual([hex("0a")]);
    expect(relay.published.map((e) => e.kind)).toEqual([33302]);
    // The new list carries it for the next device, old backup or not.
    relay.stored.splice(relay.stored.findIndex((e) => e.kind === 13302), 1);
    const tablet = device(relay);
    await tablet.sync();
    expect(tablet.ids()).toEqual([hex("0a")]);
  });
});

describe("what goes on the wire", () => {
  it("each fragment is kind 33302 addressed by its index, and only you can read it", async () => {
    const relay = fakeRelay();
    await device(relay, [group("0a")]).sync();
    const [e] = relay.published;
    expect(e.kind).toBe(33302);
    expect(e.tags).toEqual([["d", "0"]]);
    expect(e.content).not.toContain(hexToB64u(hex("0d")));
    const stranger = generateSecretKey();
    expect(() => nip44v2.decrypt(e.content, nip44v2.utils.getConversationKey(stranger, pubkey))).toThrow();
    const payload = JSON.parse(await signer.nip44!.decrypt(pubkey, e.content));
    expect(payload.entries[0].current.community_root).toBe(hexToB64u(hex("0d")));
  });

  it("a sync that finds everything in step writes nothing", async () => {
    const relay = fakeRelay();
    const phone = device(relay, [group("0a")]);
    await phone.sync();
    const n = relay.published.length;
    await phone.sync(1_790_000_020_000);
    expect(relay.published.length).toBe(n);
  });
});

describe("a list that may be out of reach", () => {
  it("a first sync that hears from only some of your relays never starts a list", async () => {
    const relay = fakeRelay();
    relay.partly(); // one relay answered empty; the one holding your List didn't
    const phone = device(relay, [group("0a")]);
    const res = await phone.sync();
    expect(relay.published).toEqual([]);
    expect(res).toMatchObject({ status: "synced", written: 0, waiting: 1 });
  });
});
