import { describe, it, expect } from "vitest";
import {
  typeOf, viewKinds, rowPreview, typeWord, countByType, sortEvents, contentFilter, mergePage,
  removalReason, reasonRequired, typedConfirmRequired, confirmPhrase, exportable, toCsv, scopeLine,
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
