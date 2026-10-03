import { describe, it, expect } from "vitest";
import { generateSecretKey, finalizeEvent, getPublicKey } from "nostr-tools";
import { readFirstScreen } from "./first-screen";

const alice = generateSecretKey(), bob = generateSecretKey();
const A = getPublicKey(alice), B = getPublicKey(bob);
// As the server sends them: plain JSON. (finalizeEvent marks its result as
// verified, and that mark would survive a spread and skip the real check.)
const plain = <T,>(e: T): T => JSON.parse(JSON.stringify(e));
const note = (sk: Uint8Array, text: string) => plain(finalizeEvent({ kind: 1, created_at: 1_700_000_000, tags: [], content: text }, sk));
const prof = (sk: Uint8Array, name: string) => plain(finalizeEvent({ kind: 0, created_at: 1_700_000_000, tags: [], content: JSON.stringify({ name }) }, sk));

describe("the first screen the server sends", () => {
  it("gives back the notes, their authors' profiles and scores", () => {
    const got = readFirstScreen({ notes: [note(alice, "hi"), note(bob, "yo")], profiles: { [A]: prof(alice, "alice"), [B]: prof(bob, "bob") }, ranks: { [A]: 0.9, [B]: 0.3 } });
    expect(got?.notes.map((n) => n.content)).toEqual(["hi", "yo"]);
    expect(got?.profiles.map((p) => JSON.parse(p.content).name).sort()).toEqual(["alice", "bob"]);
    expect(got?.ranks.get(A)).toBe(0.9);
  });

  it("drops a note or profile whose signature doesn't hold — nothing is shown on the server's word", () => {
    const forged = { ...note(alice, "hi"), content: "changed" };
    const forgedProfile = { ...prof(bob, "bob"), content: JSON.stringify({ name: "mallory" }) };
    const got = readFirstScreen({ notes: [forged, note(bob, "yo")], profiles: { [B]: forgedProfile }, ranks: {} });
    expect(got?.notes.map((n) => n.content)).toEqual(["yo"]);
    expect(got?.profiles).toEqual([]);
  });

  it("keeps a profile only under its own author and only for someone on the screen", () => {
    const carol = generateSecretKey();
    const got = readFirstScreen({ notes: [note(alice, "hi")], profiles: { [A]: prof(bob, "bob"), [getPublicKey(carol)]: prof(carol, "carol") }, ranks: {} });
    expect(got?.profiles).toEqual([]);
  });

  it("only takes scores between 0 and 1 for people on the screen", () => {
    const got = readFirstScreen({ notes: [note(alice, "hi")], profiles: {}, ranks: { [A]: 7, [B]: 0.5 } });
    expect(got?.ranks.size).toBe(0);
  });

  it("is nothing when the answer isn't a first screen, or every note failed its check", () => {
    expect(readFirstScreen(null)).toBeNull();
    expect(readFirstScreen({ notes: "x" })).toBeNull();
    expect(readFirstScreen({ notes: [{ ...note(alice, "hi"), sig: "00".repeat(64) }], profiles: {}, ranks: {} })).toBeNull();
  });
});
