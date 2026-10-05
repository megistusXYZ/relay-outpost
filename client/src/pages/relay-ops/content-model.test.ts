import { describe, it, expect } from "vitest";
import {
  typeOf, viewKinds, rowPreview, typeWord, countByType, sortEvents, contentFilter, mergePage,
  removalReason, reasonRequired, typedConfirmRequired, confirmPhrase, exportable, toCsv, scopeLine,
  featureWhat,
} from "./content-model";

const ev = (kind: number, content = "", tags: string[][] = [], over: Partial<{ id: string; pubkey: string; created_at: number }> = {}) => ({
  id: over.id ?? `${kind}-${content}`.padEnd(64, "0").slice(0, 64), pubkey: over.pubkey ?? "aa".repeat(32),
  created_at: over.created_at ?? 1_700_000_000, kind, content, tags, sig: "s",
});

describe("what kind of thing a post is", () => {
  it("sorts kinds into the views an operator looks for", () => {
    expect(typeOf(1)).toBe("notes");
    expect(typeOf(30023)).toBe("articles");
    expect(typeOf(20)).toBe("media");
    expect(typeOf(7)).toBe("reactions");
    expect(typeOf(9735)).toBe("thanks");
    expect(typeOf(1059)).toBe("private");
    expect(typeOf(10000)).toBe("lists");
    expect(typeOf(0)).toBe("profiles");
    expect(typeOf(31990)).toBe("other");
  });

  it("asks the relay for just that view's kinds", () => {
    expect(viewKinds("notes")).toEqual([1, 1111]);
    expect(viewKinds("all")).toBeUndefined();
    expect(viewKinds("other")).toBeUndefined();
  });

  it("names each in a word", () => {
    expect(typeWord(1)).toBe("Note");
    expect(typeWord(9735)).toBe("Thanks");
    expect(typeWord(1059)).toBe("Private message");
  });

  it("counts what's loaded per view", () => {
    const c = countByType([ev(1, "a"), ev(1, "b"), ev(7, "+"), ev(31990)]);
    expect(c.all).toBe(4);
    expect(c.notes).toBe(2);
    expect(c.reactions).toBe(1);
    expect(c.other).toBe(1);
  });
});

describe("the one line a row shows", () => {
  it("never shows a private message's contents", () => {
    expect(rowPreview(ev(4, "ciphertext?iv=abc"))).toBe("Private message — its contents stay sealed");
    expect(rowPreview(ev(1059, "sealed"))).not.toContain("sealed\"");
  });

  it("reads a note's first line", () => {
    expect(rowPreview(ev(1, "  hello there\nsecond line"))).toBe("hello there");
  });

  it("says what a reaction, a repost or thanks did", () => {
    expect(rowPreview(ev(7, "+"))).toBe("Liked a post");
    expect(rowPreview(ev(7, "🔥"))).toBe("Reacted 🔥 to a post");
    expect(rowPreview(ev(6, "{}"))).toBe("Reposted a post");
    expect(rowPreview(ev(9735))).toBe("Sent thanks");
  });

  it("uses an article's title and a list's size", () => {
    expect(rowPreview(ev(30023, "body", [["title", "Harbour rules"]]))).toBe("Harbour rules");
    expect(rowPreview(ev(30000, "", [["d", "mods"], ["p", "x"], ["p", "y"]]))).toBe("List “mods” · 2 entries");
  });

  it("says encrypted content is encrypted, instead of showing ciphertext", () => {
    expect(rowPreview(ev(30078, "AngEUb+JmSSEraeBxgJXTLDoJ+oQ2k3m9aXJzZp0N8nE4xY7T1sRzq0v8mBt3Lw5GhKk"))).toBe("Encrypted content");
    expect(rowPreview(ev(10013, "c2VjcmV0?iv=aXZpdml2"))).toBe("Encrypted content");
    expect(rowPreview(ev(1, "a perfectly normal sentence that happens to be long enough to pass sixty"))).not.toBe("Encrypted content");
  });

  it("falls back to the kind when there's nothing to read", () => {
    expect(rowPreview(ev(31990))).toBe("Kind 31990");
  });
});

describe("a row reads like a feed preview", () => {
  const BOB = "b".repeat(64);
  const npub = "npub1hwh0ndsdlm32gkhpq0g6u0e9vfecd97cjrw3atvpmhk8t3lu6nuq3ue2mx"; // not Bob — any valid npub
  it("mentions read as names, not codes", () => {
    const { nip19 } = require("nostr-tools");
    const bobNpub = nip19.npubEncode(BOB);
    const e = ev(1, `hi nostr:${bobNpub} how are you`);
    expect(rowPreview(e, { nameOf: (pk) => (pk === BOB ? "Bob" : undefined) })).toBe("hi @Bob how are you");
    expect(rowPreview(ev(1, `see nostr:${npub}`), { nameOf: () => undefined })).toMatch(/^see @npub1hwh0nd…$/);
  });

  it("a quoted post reads as a quote", () => {
    expect(rowPreview(ev(1, "nostr:note1qqqrcgw2t6p54afxssclv8xdkaqsqtnjyj58ces28mgtevyc3kwsffe668"))).toBe("Quoted a post");
    expect(rowPreview(ev(1, "so true nostr:note1qqqrcgw2t6p54afxssclv8xdkaqsqtnjyj58ces28mgtevyc3kwsffe668"))).toBe("so true · quoted a post");
  });

  it("a post that's only a picture, GIF or video says so", () => {
    expect(rowPreview(ev(1, "https://cdn.example.com/a/b/cat.jpg"))).toBe("Photo");
    expect(rowPreview(ev(1, "https://media.tenor.com/x/dance.gif"))).toBe("GIF");
    expect(rowPreview(ev(1, "https://v.example.com/clip.mp4"))).toBe("Video");
    expect(rowPreview(ev(1, "look at this https://cdn.example.com/cat.png"))).toBe("look at this · Photo");
  });

  it("a bare link shows the site it goes to", () => {
    expect(rowPreview(ev(1, "https://www.theverge.com/2026/10/3/some-story"))).toBe("Link · theverge.com");
  });

  it("a reaction or repost names the post it's about, when we have it", () => {
    const target = ev(1, "Thanks, we've been looking for reliable iOS support", [], { id: "c".repeat(64) });
    const like = ev(7, "+", [["e", "c".repeat(64)]]);
    const boost = ev(6, "", [["e", "c".repeat(64)]]);
    const ctx = { targetOf: (id: string) => (id === "c".repeat(64) ? target : undefined) };
    expect(rowPreview(like, ctx)).toBe("Liked: Thanks, we've been looking for reliable iOS support");
    expect(rowPreview(boost, ctx)).toBe("Reposted: Thanks, we've been looking for reliable iOS support");
    expect(rowPreview(like, { targetOf: () => undefined })).toBe("Liked a post");
  });
});

describe("sorting the list", () => {
  const a = ev(1, "a", [], { created_at: 3, pubkey: "a".repeat(64) });
  const b = ev(7, "+", [], { created_at: 1, pubkey: "b".repeat(64) });
  const c = ev(30023, "c", [], { created_at: 2, pubkey: "c".repeat(64) });
  const names: Record<string, string> = { ["a".repeat(64)]: "Zed", ["b".repeat(64)]: "amy", ["c".repeat(64)]: "Bob" };
  const nameOf = (pk: string) => names[pk];

  it("newest first by default", () => {
    expect(sortEvents([b, a, c], "time", "desc", nameOf).map((e) => e.created_at)).toEqual([3, 2, 1]);
  });

  it("by who, ignoring case", () => {
    expect(sortEvents([a, b, c], "who", "asc", nameOf).map((e) => nameOf(e.pubkey))).toEqual(["amy", "Bob", "Zed"]);
  });

  it("by type, then newest", () => {
    expect(sortEvents([a, b, c], "type", "asc", nameOf).map((e) => e.kind)).toEqual([30023, 1, 7]);
  });
});

describe("what's asked of the relay", () => {
  const now = 1_700_000_000;
  it("a view narrows the kinds; a typed kind wins over the view", () => {
    expect(contentFilter({}, { range: "any" }, "notes", now, { search: false, limit: 200 }).kinds).toEqual([1, 1111]);
    expect(contentFilter({ kind: 7 }, { range: "any" }, "notes", now, { search: false, limit: 200 }).kinds).toEqual([7]);
  });

  it("words go to the relay only when it can search", () => {
    expect(contentFilter({ text: "boat" }, { range: "any" }, "all", now, { search: true, limit: 200 }).search).toBe("boat");
    expect(contentFilter({ text: "boat" }, { range: "any" }, "all", now, { search: false, limit: 200 }).search).toBeUndefined();
  });

  it("further back asks for what's older than the oldest loaded", () => {
    expect(contentFilter({}, { range: "any" }, "all", now, { search: false, limit: 200, until: 1_600_000_000 }).until).toBe(1_600_000_000);
  });

  it("an event id is asked for alone", () => {
    expect(contentFilter({ id: "ab".repeat(32) }, { range: "24h" }, "notes", now, { search: false, limit: 200 })).toEqual({ ids: ["ab".repeat(32)] });
  });
});

describe("loading further back", () => {
  it("adds only what's new, keeps newest first, and knows when nothing more came", () => {
    const one = ev(1, "1", [], { id: "1".repeat(64), created_at: 5 });
    const two = ev(1, "2", [], { id: "2".repeat(64), created_at: 4 });
    const r = mergePage([one], [one, two]);
    expect(r.events.map((e) => e.created_at)).toEqual([5, 4]);
    expect(r.added).toBe(1);
    expect(mergePage(r.events, [two]).added).toBe(0);
  });
});

describe("removing things", () => {
  it("a reason is optional for one, required for many or for a rule", () => {
    expect(reasonRequired(1, false)).toBe(false);
    expect(reasonRequired(2, false)).toBe(true);
    expect(reasonRequired(1, true)).toBe(true);
  });

  it("typing to confirm only for a rule or a big batch", () => {
    expect(typedConfirmRequired(25, false)).toBe(false);
    expect(typedConfirmRequired(26, false)).toBe(true);
    expect(typedConfirmRequired(3, true)).toBe(true);
    expect(confirmPhrase(214)).toBe("remove 214");
  });

  it("writes the reason the relay keeps", () => {
    expect(removalReason("Spam", "  link farm ")).toBe("Spam: link farm");
    expect(removalReason("Harassment", "")).toBe("Harassment");
    expect(removalReason(undefined, "")).toBeUndefined();
  });
});

describe("exporting", () => {
  it("keeps private messages' contents out of the file", () => {
    const out = exportable([ev(1, "hi"), ev(1059, "sealed-stuff")]);
    expect(out[0].content).toBe("hi");
    expect(out[1].content).toBe("");
  });

  it("writes a CSV a spreadsheet opens, quotes and all", () => {
    const csv = toCsv([ev(1, 'say "hi"\nthere', [], { created_at: 0 })], () => "Amy");
    const [head, row] = csv.split("\n");
    expect(head).toBe('"time","author","author key","type","kind","id","content"');
    expect(row).toContain('"Amy"');
    expect(row).toContain('"say ""hi"" there"');
    expect(row).toContain('"1970-01-01T00:00:00.000Z"');
  });
});

describe("saying how much was searched", () => {
  it("never lets a relay we couldn't reach read as empty", () => {
    expect(scopeLine({ reached: false, loaded: 0 })).toMatch(/couldn't reach/i);
  });

  it("a relay that searches: the whole relay", () => {
    expect(scopeLine({ reached: true, loaded: 12, relaySearched: true })).toBe("Searched the whole relay");
  });

  it("otherwise: the latest it loaded, and how far back", () => {
    expect(scopeLine({ reached: true, loaded: 500, oldest: Date.UTC(2026, 9, 2) / 1000 })).toMatch(/^Searched the latest 500, back to /);
  });

  it("says when that's everything", () => {
    expect(scopeLine({ reached: true, loaded: 40, exhausted: true })).toBe("That's everything on this relay for this search");
  });
});

describe("what Feature puts in a featured feed", () => {
  const post = ev(1, "Harbour news", [], { id: "b".repeat(64) });
  it("a note, picture, video, article, live show or listing is featured itself", () => {
    for (const k of [1, 20, 21, 34235, 30023, 30311, 30402]) {
      const e = ev(k, "x", [], { id: "c".repeat(64) });
      expect(featureWhat(e)).toEqual({ id: e.id, own: true });
    }
  });
  it("a like or repost features the post it's about", () => {
    expect(featureWhat(ev(7, "+", [["e", post.id], ["p", "aa".repeat(32)]]))).toEqual({ id: post.id, own: false });
    expect(featureWhat(ev(6, JSON.stringify(post), [["e", post.id]]))).toEqual({ id: post.id, own: false });
  });
  it("a like of nothing we can name features nothing", () => {
    expect(featureWhat(ev(7, "+", []))).toBeNull();
  });
  it("thanks, delete requests, lists, profiles and private messages can't be featured", () => {
    for (const e of [ev(9735, "", [["e", post.id]]), ev(5, "", [["e", post.id]]), ev(30000, "", [["d", "crew"]]), ev(0, "{}"), ev(4, "x?iv=y"), ev(1059, "x")]) {
      expect(featureWhat(e)).toBeNull();
    }
  });
});

describe("thanks and delete requests say what they are", () => {
  const post = ev(1, "Harbour news: the ferry runs late", [], { id: "d".repeat(64) });
  const ctx = { targetOf: (id: string) => (id === post.id ? post : undefined) };
  it("thanks say how much, and for what", () => {
    const zap = ev(9735, "", [["e", post.id], ["bolt11", "lnbc210n1qa"]]);
    expect(rowPreview(zap, ctx)).toBe("Sent 21 sats: Harbour news: the ferry runs late");
    expect(rowPreview(ev(9735, "", [["bolt11", "lnbc210n1qa"]]))).toBe("Sent 21 sats");
    expect(rowPreview(ev(9735, "", []))).toBe("Sent thanks");
  });
  it("a delete request says it asks to delete, with the reason and the post", () => {
    expect(rowPreview(ev(5, "", [["e", post.id]]), ctx)).toBe("Asked to delete: Harbour news: the ferry runs late");
    expect(rowPreview(ev(5, "posted by mistake", [["e", post.id]]))).toBe("Asked to delete a post · posted by mistake");
    expect(rowPreview(ev(5, "", []))).toBe("Asked to delete a post");
  });
});
