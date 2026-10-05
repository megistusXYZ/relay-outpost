import { describe, it, expect } from "vitest";
import { pickFirstScreen, createProfileReader, createFirstScreenReader, FIRST_SCREEN_NOTES, PROFILE_RELAYS, PROFILE_WAIT_MS } from "./first-screen";
import { RELAY_ANSWER_MS, ROUTE_WAIT_MS } from "./trusted-sample";

const hex = (c: string) => c.repeat(64).slice(0, 64);
const sig = "ab".repeat(64);
const note = (id: string, author: string, at: number) => ({ id: hex(id), pubkey: hex(author), created_at: at, kind: 1, tags: [], content: `note ${id}`, sig });
const profile = (author: string, at: number, name = `name-${author}`) => ({ id: hex("e" + author), pubkey: hex(author), created_at: at, kind: 0, tags: [], content: JSON.stringify({ name }), sig });

describe("the first screen's notes", () => {
  it("are the newest, at most two per person, at most FIRST_SCREEN_NOTES", () => {
    const notes = [note("1", "a", 100), note("2", "a", 99), note("3", "a", 98), note("4", "b", 97), note("5", "c", 96)];
    expect(pickFirstScreen(notes, 4).map((n) => n.id[0])).toEqual(["1", "2", "4", "5"]);
    expect(FIRST_SCREEN_NOTES).toBeGreaterThanOrEqual(12);
  });
  it("come out newest first whatever order they came in", () => {
    const notes = [note("1", "a", 10), note("2", "b", 30), note("3", "c", 20)];
    expect(pickFirstScreen(notes, 10).map((n) => n.created_at)).toEqual([30, 20, 10]);
  });
});

describe("the profile reader", () => {
  const fakeQuery = (answers: Record<string, any[]>, calls: { relay: string; authors: string[] }[]) =>
    async (relay: string, filter: Record<string, any>) => {
      calls.push({ relay, authors: filter.authors });
      return { reached: true, answered: true, events: (answers[relay] ?? []).filter((e) => filter.authors.includes(e.pubkey)) };
    };

  it("asks the profile relays once for everyone it doesn't hold, and keeps each person's newest", async () => {
    const calls: any[] = [];
    const r = createProfileReader({ query: fakeQuery({ [PROFILE_RELAYS[0]]: [profile("a", 1, "old"), profile("b", 5)], [PROFILE_RELAYS[1]]: [profile("a", 9, "new")] }, calls), waitMs: 1000 });
    const got = await r.get([hex("a"), hex("b")]);
    expect(JSON.parse(got.get(hex("a"))!.content).name).toBe("new");
    expect(got.has(hex("b"))).toBe(true);
    expect(calls.length).toBe(PROFILE_RELAYS.length);
  });

  it("answers from memory next time, and asks only about people it hasn't seen", async () => {
    const calls: any[] = [];
    const r = createProfileReader({ query: fakeQuery({ [PROFILE_RELAYS[0]]: [profile("a", 1), profile("c", 1)] }, calls), waitMs: 1000 });
    await r.get([hex("a")]);
    const before = calls.length;
    await r.get([hex("a")]);
    expect(calls.length).toBe(before);
    await r.get([hex("a"), hex("c")]);
    expect(calls.slice(before).every((c: any) => c.authors.length === 1 && c.authors[0] === hex("c"))).toBe(true);
  });

  it("never holds a visitor longer than its wait: what it has, now", async () => {
    const slow = () => new Promise<any>((res) => setTimeout(() => res({ reached: true, answered: true, events: [profile("a", 1)] }), 200));
    const r = createProfileReader({ query: slow, waitMs: 20 });
    const got = await r.get([hex("a")]);
    expect(got.size).toBe(0);
    await new Promise((res) => setTimeout(res, 250));
    expect((await r.get([hex("a")])).size).toBe(1);
  });

  it("ignores anything that isn't a well-formed signed profile", async () => {
    const r = createProfileReader({ query: async () => ({ reached: true, answered: true, events: [{ ...profile("a", 1), sig: "nope" }, { ...profile("b", 1), kind: 1 }] }), waitMs: 100 });
    expect((await r.get([hex("a"), hex("b")])).size).toBe(0);
  });
});

describe("the first screen", () => {
  it("fits inside the route's wait: the sample's relay time plus the profile wait", () => {
    expect(RELAY_ANSWER_MS + PROFILE_WAIT_MS).toBeLessThan(ROUTE_WAIT_MS);
  });

  it("is the sample's newest notes with their authors' scores and profiles", async () => {
    const notes = [note("1", "a", 100), note("2", "b", 99)];
    const fs = createFirstScreenReader({
      sample: async () => ({ reached: true, notes }),
      ranks: async (ns) => Object.fromEntries(ns.map((n) => [n.pubkey, n.pubkey === hex("a") ? 0.9 : 0.4])),
      profiles: { get: async (authors: readonly string[]) => new Map(authors.map((a) => [a, profile(a === hex("a") ? "a" : "b", 1)])) },
    });
    const got = await fs.read();
    expect(got.reached).toBe(true);
    expect(got.notes.map((n) => n.id[0])).toEqual(["1", "2"]);
    expect(got.ranks).toEqual({ [hex("a")]: 0.9, [hex("b")]: 0.4 });
    expect(Object.keys(got.profiles).sort()).toEqual([hex("a"), hex("b")].sort());
  });

  it("leaves out a note whose author's profile isn't in hand — a card never opens on a raw npub", async () => {
    const notes = [note("1", "a", 100), note("2", "b", 99)];
    const fs = createFirstScreenReader({
      sample: async () => ({ reached: true, notes }),
      ranks: async () => ({}),
      profiles: { get: async (authors: readonly string[]) => new Map(authors.filter((a) => a === hex("a")).map((a) => [a, profile("a", 1)])) },
    });
    const got = await fs.read();
    expect(got.notes.map((n) => n.id[0])).toEqual(["1"]);
    expect(Object.keys(got.profiles)).toEqual([hex("a")]);
  });

  it("says it couldn't, rather than nobody posted, when the sample wasn't reached", async () => {
    const fs = createFirstScreenReader({ sample: async () => ({ reached: false, notes: [] }), ranks: async () => ({}), profiles: { get: async () => new Map() } });
    expect((await fs.read()).reached).toBe(false);
  });
});

describe("the first screen, kept warm", () => {
  const notes = [note("1", "a", 100)];
  const reader = (sample: () => Promise<{ reached: boolean; notes: typeof notes }>, now: () => number) => createFirstScreenReader({
    sample, now,
    ranks: async () => ({}),
    profiles: { get: async (authors: readonly string[]) => new Map(authors.map((a) => [a, profile("a", 1)])) },
  });

  // Measured on production 2026-10-04: 0.8–1.7 s per visit, the whole wait
  // before a stranger saw a post — every visit rebuilt it from the relays.
  it("a second visitor within half a minute gets the same screen without it being built again", async () => {
    let builds = 0, t = 0;
    const fs = reader(async () => { builds++; return { reached: true, notes }; }, () => t);
    await fs.read();
    t = 20_000;
    expect((await fs.read()).notes).toHaveLength(1);
    expect(builds).toBe(1);
  });

  it("after that, a visitor gets the last screen at once while a fresh one is built", async () => {
    let builds = 0, t = 0;
    let release!: () => void;
    const fs = reader(async () => {
      builds++;
      if (builds === 2) await new Promise<void>((r) => { release = r; });
      return { reached: true, notes: builds === 1 ? notes : [note("2", "b", 200)] };
    }, () => t);
    await fs.read();
    t = 45_000;
    const stale = await Promise.race([fs.read(), new Promise<null>((r) => setTimeout(() => r(null), 50))]);
    expect(stale?.notes.map((n) => n.id[0])).toEqual(["1"]);
    expect(builds).toBe(2);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect((await fs.read()).notes.map((n) => n.id[0])).toEqual(["2"]);
  });

  it("visitors arriving together share one build", async () => {
    let builds = 0;
    const fs = reader(async () => { builds++; await new Promise((r) => setTimeout(r, 20)); return { reached: true, notes }; }, () => 0);
    await Promise.all([fs.read(), fs.read(), fs.read()]);
    expect(builds).toBe(1);
  });

  it("a screen it couldn't build isn't kept: the next visitor tries again", async () => {
    let builds = 0;
    const fs = reader(async () => { builds++; return builds === 1 ? { reached: false, notes: [] } : { reached: true, notes }; }, () => 0);
    expect((await fs.read()).reached).toBe(false);
    expect((await fs.read()).reached).toBe(true);
  });
});
