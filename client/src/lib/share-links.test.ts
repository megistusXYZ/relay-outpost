/**
 * Share-link encoding (lib/share-links.ts).
 *
 * A share link used to be a bare event id — no relay hints, no author — so a
 * guest opening it had NOTHING to follow to where the post actually lives
 * (measured live 2026-08-18: a real shared post existed on none of the guest
 * relays; only fallbacks saved it). Share links now carry an nevent with the
 * relays the event was SEEN on plus the author (the outbox recovery key).
 */
import { describe, expect, it } from "vitest";
import { nip19 } from "nostr-tools";
import { pickShareHints, noteShareId } from "./share-links";

const ID = "47787381187cbb5672013803c10dd12b3813994d4b6d3d8cfe69d9d72468696f";
const AUTHOR = "dabe380b225adf262f3e2cf96460d4879b15fafd2f4325939600fc5c3b50a122";

describe("pickShareHints", () => {
  it("keeps only ws(s) urls, dedupes trailing-slash variants, caps at 3", () => {
    expect(pickShareHints([
      "wss://relay.damus.io",
      "wss://relay.damus.io/",
      "https://not-a-relay.example",
      "wss://nos.lol",
      "wss://relay.primal.net",
      "wss://relay.nostr.band",
    ])).toEqual(["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"]);
  });

  it("drops local/loopback hosts — useless to anyone else's client", () => {
    expect(pickShareHints(["ws://localhost:5002", "wss://127.0.0.1", "wss://relay.damus.io"]))
      .toEqual(["wss://relay.damus.io"]);
  });

  it("garbage in, empty out", () => {
    expect(pickShareHints(["not a url", ""])).toEqual([]);
  });
});

describe("noteShareId", () => {
  it("encodes an nevent carrying id, author, and seen-on hints", () => {
    const encoded = noteShareId(ID, AUTHOR, ["wss://relay.damus.io", "wss://nos.lol"]);
    const d = nip19.decode(encoded);
    expect(d.type).toBe("nevent");
    const data = d.data as { id: string; author?: string; relays?: string[] };
    expect(data.id).toBe(ID);
    expect(data.author).toBe(AUTHOR);
    expect(data.relays).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
  });

  it("still encodes with no hints and no author (id alone beats a raw hex)", () => {
    const d = nip19.decode(noteShareId(ID));
    expect(d.type).toBe("nevent");
    expect((d.data as { id: string }).id).toBe(ID);
  });
});
