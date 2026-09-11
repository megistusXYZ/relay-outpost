/**
 * Loading a relay's Featured feeds has three outcomes, not two: the feeds (none
 * yet is a real answer), a relay we never got to ask, and a relay that doesn't
 * list you as its operator. The dialog offered "Name your first feed" for a
 * relay that was down, then failed on Create — a dead relay read as empty.
 */
import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent, type Event } from "nostr-tools";
import { loadRelayFeeds } from "./featured-append";
import { buildCurationSetTags, KIND_CURATION_SET } from "./curation-set";

const RELAY = "wss://relay.example";
const meSk = generateSecretKey();
const me = getPublicKey(meSk);
const strangerSk = generateSecretKey();

const feed = (sk: Uint8Array, title: string): Event => finalizeEvent({
  kind: KIND_CURATION_SET, created_at: 100, content: "",
  tags: buildCurationSetTags({ dTag: title.toLowerCase(), title, items: [] }),
}, sk);

/** A relay as the loader sees it: can we connect, what its NIP-11 says, and what the query returned. */
const relay = (opts: { reach?: boolean; doc?: { pubkey?: string; moderators?: string[] } | null; events?: Event[]; answered?: boolean }) => {
  let queried = false;
  return {
    get queried() { return queried; },
    deps: {
      reach: async () => opts.reach ?? true,
      nip11: async () => (opts.doc === undefined ? { pubkey: me } : opts.doc),
      query: async () => { queried = true; return { events: opts.events ?? [], answered: opts.answered ?? true }; },
    },
  };
};

describe("loadRelayFeeds: what a relay's Featured feeds really are", () => {
  it("a relay we can't connect to is unreachable, never 'no feeds yet'", async () => {
    const r = relay({ reach: false });
    expect(await loadRelayFeeds(RELAY, me, r.deps)).toEqual({ status: "unreachable" });
    expect(r.queried).toBe(false);
  });

  it("a relay whose info won't load is unreachable too: we couldn't ask who runs it", async () => {
    expect(await loadRelayFeeds(RELAY, me, relay({ doc: null }).deps)).toEqual({ status: "unreachable" });
  });

  it("a relay whose info doesn't name you isn't yours to feature on", async () => {
    const r = relay({ doc: { pubkey: getPublicKey(strangerSk) } });
    expect(await loadRelayFeeds(RELAY, me, r.deps)).toEqual({ status: "not-operator" });
    expect(r.queried).toBe(false);
    expect(await loadRelayFeeds(RELAY, null, relay({}).deps)).toEqual({ status: "not-operator" });
  });

  it("a moderator the relay lists counts", async () => {
    const out = await loadRelayFeeds(RELAY, me, relay({ doc: { pubkey: getPublicKey(strangerSk), moderators: [me] } }).deps);
    expect(out.status).toBe("ok");
  });

  it("a query nobody answered is unreachable, even with the relay's info in hand", async () => {
    expect(await loadRelayFeeds(RELAY, me, relay({ answered: false }).deps)).toEqual({ status: "unreachable" });
  });

  it("a relay that answered with no feeds has none yet", async () => {
    expect(await loadRelayFeeds(RELAY, me, relay({ events: [] }).deps)).toEqual({ status: "ok", feeds: [] });
  });

  it("only the operator's own feeds are the relay's", async () => {
    const out = await loadRelayFeeds(RELAY, me, relay({ events: [feed(meSk, "Weekly Picks"), feed(strangerSk, "Spam")] }).deps);
    expect(out.status === "ok" && out.feeds.map((f) => f.title)).toEqual(["Weekly Picks"]);
  });
});
