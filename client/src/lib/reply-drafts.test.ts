import { describe, it, expect } from "vitest";
import { readReplyDraft, saveReplyDraft, clearReplyDraft, REPLY_DRAFT_TTL_MS, MAX_REPLY_DRAFTS, type ReplyDraft } from "./reply-drafts";

/** A Storage that lives in a Map — or throws, like a blocked one. */
function memoryStorage(opts: { throws?: boolean } = {}): Storage {
  const m = new Map<string, string>();
  const guard = () => { if (opts.throws) throw new Error("SecurityError"); };
  return {
    get length() { return m.size; },
    clear: () => { guard(); m.clear(); },
    getItem: (k) => { guard(); return m.get(k) ?? null; },
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { guard(); m.delete(k); },
    setItem: (k, v) => { guard(); m.set(k, v); },
  };
}

const ME = "a".repeat(64), OTHER = "b".repeat(64);
const draft = (text: string, extra: Partial<ReplyDraft> = {}): Omit<ReplyDraft, "savedAt"> => ({ text, mentions: [], emojis: [], gifUrl: null, ...extra });

describe("reply drafts — what you'd typed comes back when you reopen the box", () => {
  it("brings back the text, the people you tagged, custom emoji and a picked GIF", () => {
    const s = memoryStorage();
    const mentions = [{ id: 3, pubkey: OTHER, displayName: "Carol", token: "​‌‌‌" }];
    saveReplyDraft(ME, "bob-note", draft("@Carol​‌‌‌ half a thought :wave:", { mentions, emojis: [["wave", "https://e.example/wave.png"]], gifUrl: "https://g.example/x.gif" }), { storage: s, now: 1000 });
    const back = readReplyDraft(ME, "bob-note", { storage: s, now: 2000 });
    expect(back?.text).toBe("@Carol​‌‌‌ half a thought :wave:");
    expect(back?.mentions).toEqual(mentions);
    expect(back?.emojis).toEqual([["wave", "https://e.example/wave.png"]]);
    expect(back?.gifUrl).toBe("https://g.example/x.gif");
  });

  it("keeps a draft per post or comment you were answering", () => {
    const s = memoryStorage();
    saveReplyDraft(ME, "bob-note", draft("to Bob"), { storage: s });
    saveReplyDraft(ME, "the-post", draft("to everyone"), { storage: s });
    expect(readReplyDraft(ME, "bob-note", { storage: s })?.text).toBe("to Bob");
    expect(readReplyDraft(ME, "the-post", { storage: s })?.text).toBe("to everyone");
  });

  it("an emptied box leaves no draft behind", () => {
    const s = memoryStorage();
    saveReplyDraft(ME, "bob-note", draft("to Bob"), { storage: s });
    saveReplyDraft(ME, "bob-note", draft("   "), { storage: s });
    expect(readReplyDraft(ME, "bob-note", { storage: s })).toBeNull();
  });

  it("a GIF on its own is still a draft", () => {
    const s = memoryStorage();
    saveReplyDraft(ME, "bob-note", draft("", { gifUrl: "https://g.example/x.gif" }), { storage: s });
    expect(readReplyDraft(ME, "bob-note", { storage: s })?.gifUrl).toBe("https://g.example/x.gif");
  });

  it("sending clears it", () => {
    const s = memoryStorage();
    saveReplyDraft(ME, "bob-note", draft("to Bob"), { storage: s });
    clearReplyDraft(ME, "bob-note", { storage: s });
    expect(readReplyDraft(ME, "bob-note", { storage: s })).toBeNull();
  });

  it("is yours only: someone else signed in on this device doesn't see it", () => {
    const s = memoryStorage();
    saveReplyDraft(ME, "bob-note", draft("to Bob"), { storage: s });
    expect(readReplyDraft(OTHER, "bob-note", { storage: s })).toBeNull();
  });

  it("is forgotten after a week", () => {
    const s = memoryStorage();
    saveReplyDraft(ME, "bob-note", draft("to Bob"), { storage: s, now: 0 });
    expect(readReplyDraft(ME, "bob-note", { storage: s, now: REPLY_DRAFT_TTL_MS - 1 })?.text).toBe("to Bob");
    expect(readReplyDraft(ME, "bob-note", { storage: s, now: REPLY_DRAFT_TTL_MS + 1 })).toBeNull();
  });

  it("keeps only the most recent drafts", () => {
    const s = memoryStorage();
    for (let i = 0; i <= MAX_REPLY_DRAFTS; i++) saveReplyDraft(ME, `note-${i}`, draft(`draft ${i}`), { storage: s, now: 1000 + i });
    expect(readReplyDraft(ME, "note-0", { storage: s, now: 5000 })).toBeNull();
    expect(readReplyDraft(ME, `note-${MAX_REPLY_DRAFTS}`, { storage: s, now: 5000 })?.text).toBe(`draft ${MAX_REPLY_DRAFTS}`);
  });

  it("never breaks the reply box: blocked or garbled storage just means no draft", () => {
    expect(() => saveReplyDraft(ME, "bob-note", draft("x"), { storage: memoryStorage({ throws: true }) })).not.toThrow();
    expect(readReplyDraft(ME, "bob-note", { storage: memoryStorage({ throws: true }) })).toBeNull();
    const s = memoryStorage();
    s.setItem(`ro_reply_drafts:${ME}`, "{not json");
    expect(readReplyDraft(ME, "bob-note", { storage: s })).toBeNull();
    s.setItem(`ro_reply_drafts:${ME}`, JSON.stringify({ "bob-note": { text: 42 } }));
    expect(readReplyDraft(ME, "bob-note", { storage: s })).toBeNull();
  });
});
