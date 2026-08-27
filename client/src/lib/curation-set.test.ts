import { describe, it, expect } from "vitest";
import { parseCurationSet, buildCurationSetTags, relayFeaturedSets, detectFeedPaste, curationItemLabel, eventToCurationItem } from "./curation-set";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";

const OP = "a".repeat(64);
const AUTHOR = "b".repeat(64);

function setEvent(tags: string[][], over: Partial<Event> = {}): Event {
  return {
    id: "e".repeat(64), pubkey: OP, kind: 30004, created_at: 1000,
    content: "", tags, sig: "s",
    ...over,
  } as Event;
}

describe("parseCurationSet", () => {
  it("parses d, title, description, image, and items in tag order across e/a/r", () => {
    const ev = setEvent([
      ["d", "weekly-picks"],
      ["title", "Weekly Picks"],
      ["description", "the best of the relay"],
      ["image", "https://x/y.jpg"],
      ["e", "1".repeat(64), "wss://r1.example"],
      ["a", `30023:${AUTHOR}:my-article`, "wss://r2.example"],
      ["r", "https://news.example/story"],
      ["e", "2".repeat(64)],
    ]);
    const set = parseCurationSet(ev);
    expect(set).not.toBeNull();
    expect(set!.dTag).toBe("weekly-picks");
    expect(set!.title).toBe("Weekly Picks");
    expect(set!.description).toBe("the best of the relay");
    expect(set!.image).toBe("https://x/y.jpg");
    expect(set!.items).toEqual([
      { type: "note", id: "1".repeat(64), relayHint: "wss://r1.example" },
      { type: "address", kind: 30023, pubkey: AUTHOR, identifier: "my-article", relayHint: "wss://r2.example" },
      { type: "url", url: "https://news.example/story" },
      { type: "note", id: "2".repeat(64) },
    ]);
  });
});

describe("parseCurationSet edge shapes", () => {
  it("returns null for a set with no d tag (not addressable, not a set)", () => {
    expect(parseCurationSet(setEvent([["title", "no identity"]]))).toBeNull();
  });

  it("falls back to the d tag as title when title is missing or blank", () => {
    expect(parseCurationSet(setEvent([["d", "picks"]]))!.title).toBe("picks");
    expect(parseCurationSet(setEvent([["d", "picks"], ["title", "  "]]))!.title).toBe("picks");
  });

  it("skips malformed a tags rather than inventing items", () => {
    const set = parseCurationSet(setEvent([["d", "x"], ["a", "not-a-coordinate"], ["a", "abc:"]]));
    expect(set!.items).toEqual([]);
  });
});

describe("buildCurationSetTags", () => {
  it("round-trips through parseCurationSet, preserving item order and hints", () => {
    const items = [
      { type: "note" as const, id: "1".repeat(64), relayHint: "wss://r1.example" },
      { type: "url" as const, url: "https://news.example/a" },
      { type: "address" as const, kind: 30311, pubkey: AUTHOR, identifier: "show:1", relayHint: "wss://r2.example" },
    ];
    const tags = buildCurationSetTags({ dTag: "picks", title: "Picks", description: "desc", image: "https://i.example/c.png", items });
    const parsed = parseCurationSet(setEvent(tags));
    expect(parsed!.dTag).toBe("picks");
    expect(parsed!.title).toBe("Picks");
    expect(parsed!.description).toBe("desc");
    expect(parsed!.image).toBe("https://i.example/c.png");
    expect(parsed!.items).toEqual(items);
  });

  it("omits empty description/image tags entirely", () => {
    const tags = buildCurationSetTags({ dTag: "d1", title: "T", items: [] });
    expect(tags.some((t) => t[0] === "description")).toBe(false);
    expect(tags.some((t) => t[0] === "image")).toBe(false);
  });
});

describe("relayFeaturedSets (only the relay's own operator/mods get the front page)", () => {
  it("keeps sets authored by the NIP-11 operator or moderators, drops strangers", () => {
    const opSet = setEvent([["d", "op-picks"]], { id: "1".repeat(64), pubkey: OP });
    const modSet = setEvent([["d", "mod-picks"]], { id: "2".repeat(64), pubkey: AUTHOR });
    const stranger = setEvent([["d", "spam"]], { id: "3".repeat(64), pubkey: "c".repeat(64) });
    const got = relayFeaturedSets([opSet, modSet, stranger], { pubkey: OP, moderators: [AUTHOR] });
    expect(got.map((s) => s.dTag).sort()).toEqual(["mod-picks", "op-picks"]);
  });

  it("normalizes an npub-form NIP-11 pubkey before comparing", () => {
    const npub = nip19.npubEncode(OP);
    const opSet = setEvent([["d", "op-picks"]], { pubkey: OP });
    expect(relayFeaturedSets([opSet], { pubkey: npub })).toHaveLength(1);
  });

  it("returns nothing when NIP-11 names no operator — never guess authority", () => {
    expect(relayFeaturedSets([setEvent([["d", "x"]])], {})).toHaveLength(0);
  });

  it("keeps only the NEWEST edition per author:d, ordered newest-first", () => {
    const stale = setEvent([["d", "picks"], ["title", "old"]], { id: "4".repeat(64), created_at: 100 });
    const fresh = setEvent([["d", "picks"], ["title", "new"]], { id: "5".repeat(64), created_at: 200 });
    const other = setEvent([["d", "second"]], { id: "6".repeat(64), created_at: 150 });
    const got = relayFeaturedSets([stale, fresh, other], { pubkey: OP });
    expect(got.map((s) => s.title)).toEqual(["new", "second"]);
  });
});

describe("detectFeedPaste (one box accepts any content reference)", () => {
  it("decodes nevent with its relay hint, note1, and bare hex ids as note items", () => {
    const id = "7".repeat(64);
    const nevent = nip19.neventEncode({ id, relays: ["wss://hint.example"] });
    expect(detectFeedPaste(nevent)).toEqual({ type: "note", id, relayHint: "wss://hint.example" });
    expect(detectFeedPaste(nip19.noteEncode(id))).toEqual({ type: "note", id });
    expect(detectFeedPaste(id)).toEqual({ type: "note", id });
  });

  it("decodes naddr as an address item and tolerates nostr:/link wrappers", () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: OP, identifier: "art", relays: ["wss://h.example"] });
    expect(detectFeedPaste(`nostr:${naddr}`)).toEqual({ type: "address", kind: 30023, pubkey: OP, identifier: "art", relayHint: "wss://h.example" });
    expect(detectFeedPaste(`https://njump.me/${naddr}`)).toEqual({ type: "address", kind: 30023, pubkey: OP, identifier: "art", relayHint: "wss://h.example" });
  });

  it("flags npub/nprofile as a profile (the Phase-2 picker), not an item", () => {
    expect(detectFeedPaste(nip19.npubEncode(OP))).toEqual({ type: "profile", pubkey: OP });
  });

  it("treats a plain web URL as a url item, and garbage as null", () => {
    expect(detectFeedPaste("https://news.example/story?id=1")).toEqual({ type: "url", url: "https://news.example/story?id=1" });
    expect(detectFeedPaste("hello world")).toBeNull();
    expect(detectFeedPaste("")).toBeNull();
  });
});

describe("curationItemLabel (reader vocabulary, never kind numbers for known kinds)", () => {
  it("names each flavor", () => {
    expect(curationItemLabel({ type: "note", id: "1".repeat(64) })).toBe("Post");
    expect(curationItemLabel({ type: "url", url: "https://x.example" })).toBe("Link");
    expect(curationItemLabel({ type: "address", kind: 30023, pubkey: OP, identifier: "a" })).toBe("Article");
    expect(curationItemLabel({ type: "address", kind: 30402, pubkey: OP, identifier: "a" })).toBe("Listing");
    expect(curationItemLabel({ type: "address", kind: 30311, pubkey: OP, identifier: "a" })).toBe("Stream");
    expect(curationItemLabel({ type: "address", kind: 34235, pubkey: OP, identifier: "a" })).toBe("Video");
    expect(curationItemLabel({ type: "address", kind: 31337, pubkey: OP, identifier: "a" })).toBe("Item");
  });
});

describe("eventToCurationItem (picker: any event becomes the right item shape)", () => {
  it("maps addressable kinds to address items via their d tag", () => {
    const ev = setEvent([["d", "my-article"]], { kind: 30023, pubkey: AUTHOR });
    expect(eventToCurationItem(ev, "wss://r.example")).toEqual({
      type: "address", kind: 30023, pubkey: AUTHOR, identifier: "my-article", relayHint: "wss://r.example",
    });
  });

  it("maps an addressable event with no d tag to identifier \"\" (its real coordinate)", () => {
    const ev = setEvent([], { kind: 30311, pubkey: AUTHOR });
    const item = eventToCurationItem(ev);
    expect(item).toEqual({ type: "address", kind: 30311, pubkey: AUTHOR, identifier: "" });
  });

  it("maps regular kinds (posts, short video) to note items", () => {
    const post = setEvent([], { kind: 1, id: "9".repeat(64) });
    expect(eventToCurationItem(post)).toEqual({ type: "note", id: "9".repeat(64) });
    const video = setEvent([], { kind: 22, id: "8".repeat(64) });
    expect(eventToCurationItem(video)).toEqual({ type: "note", id: "8".repeat(64) });
  });
});
