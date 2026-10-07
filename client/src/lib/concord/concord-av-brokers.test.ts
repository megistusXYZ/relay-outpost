/**
 * Which call service a group's call uses (owner, 2026-10-06: interop with
 * Armada). The group's details list its call services (`av_brokers`, CORD-02
 * §6 / CORD-07 §5, concord PR #22 — what Armada ships); every app orders them
 * by sha256(room's 32 bytes || origin) smallest first, so everyone meets in
 * the same one. Owner's rules: no list + people already in a call → join
 * them; no list, nobody → ours; not ours → ask once per group.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { canonicalOrigin, readAvBrokers, rankBrokers, planCallBroker, chooseCallService, noteCallPresence, callServicesIn } from "./concord-av-brokers";
import { buildPresenceRumor } from "./concord-presence";

const ROOM = "a".repeat(62) + "01"; // a voice room: 32 bytes as hex
const independentHash = (origin: string) => createHash("sha256").update(Buffer.concat([Buffer.from(ROOM, "hex"), Buffer.from(origin, "utf8")])).digest("hex");

describe("an address as the spec hashes it", () => {
  it("lowercase https origin, no default port, no path, no slash", () => {
    expect(canonicalOrigin("HTTPS://Armada.Buzz:443/some/path/")).toBe("https://armada.buzz");
    expect(canonicalOrigin("https://relayop.xyz/")).toBe("https://relayop.xyz");
    expect(canonicalOrigin("https://calls.example:8443")).toBe("https://calls.example:8443");
  });
  it("anything that isn't an https origin is ignored, not an error", () => {
    expect(canonicalOrigin("http://insecure.example")).toBeNull();
    expect(canonicalOrigin("wss://relay.example")).toBeNull();
    expect(canonicalOrigin("not a url")).toBeNull();
    expect(readAvBrokers(["https://a.example", 42, "nope", "https://B.example/"])).toEqual(["https://a.example", "https://b.example"]);
    expect(readAvBrokers(undefined)).toEqual([]);
  });
});

describe("the same pick as every other app", () => {
  it("orders by sha256(room bytes + origin), smallest first", () => {
    const list = ["https://armada.buzz", "https://relayop.xyz", "https://calls.example"];
    const expected = [...list].sort((a, b) => (independentHash(a) < independentHash(b) ? -1 : 1));
    expect(rankBrokers(ROOM, list)).toEqual(expected);
  });
});

describe("where a call goes", () => {
  const own = "https://relayop.xyz";

  it("a group with a list: its services, in the shared order", () => {
    const listed = ["https://armada.buzz", "https://relayop.xyz"];
    const plan = planCallBroker({ room: ROOM, listed, present: ["https://other.example"], own, agreed: [] });
    expect(plan.candidates).toEqual(rankBrokers(ROOM, listed));
  });

  it("no list, people already in a call: their service", () => {
    expect(planCallBroker({ room: ROOM, listed: [], present: ["https://armada.buzz"], own, agreed: [] }).candidates).toEqual(["https://armada.buzz"]);
  });

  it("no list, nobody in a call: ours", () => {
    expect(planCallBroker({ room: ROOM, listed: [], present: [], own, agreed: [] }).candidates).toEqual([own]);
  });

  it("asks before using a service that isn't ours — once per group", () => {
    const listed = ["https://armada.buzz"];
    expect(planCallBroker({ room: ROOM, listed, present: [], own, agreed: [] }).ask).toEqual(["https://armada.buzz"]);
    expect(planCallBroker({ room: ROOM, listed, present: [], own, agreed: ["https://armada.buzz"] }).ask).toEqual([]);
    expect(planCallBroker({ room: ROOM, listed: [], present: [], own, agreed: [] }).ask).toEqual([]);
  });
});

describe("the service a call actually uses", () => {
  const own = "https://relayop.xyz";
  const answers = (up: string[]) => {
    const asked: string[] = [];
    return { asked, probe: async (o: string) => { asked.push(o); return up.includes(o); } };
  };

  it("the first of the group's services, in the shared order, that answers", async () => {
    const listed = ["https://armada.buzz", "https://calls.example"];
    const [, second] = rankBrokers(ROOM, listed);
    const { probe } = answers([second]);
    expect(await chooseCallService({ room: ROOM, listed, present: [], own, agreed: [], probe }))
      .toEqual({ origin: second, ask: true });
  });

  it("when none of the group's services answers, it says so instead of quietly starting a separate call on ours", async () => {
    const { probe } = answers([]);
    expect(await chooseCallService({ room: ROOM, listed: ["https://armada.buzz"], present: [], own, agreed: [], probe })).toBeNull();
  });

  it("no list, and the service people are on doesn't answer: ours", async () => {
    const { probe } = answers([]);
    expect(await chooseCallService({ room: ROOM, listed: [], present: ["https://armada.buzz"], own, agreed: [], probe }))
      .toEqual({ origin: own, ask: false });
  });

  it("ours needs no check first: joining says so itself if it's down", async () => {
    const { asked, probe } = answers([]);
    expect(await chooseCallService({ room: ROOM, listed: [own], present: [], own, agreed: [], probe })).toEqual({ origin: own, ask: false });
    expect(asked).toEqual([]);
  });

  it("doesn't ask again in a group where the person already agreed", async () => {
    const { probe } = answers(["https://armada.buzz"]);
    expect(await chooseCallService({ room: ROOM, listed: ["https://armada.buzz"], present: [], own, agreed: ["https://armada.buzz"], probe }))
      .toEqual({ origin: "https://armada.buzz", ask: false });
  });
});

describe("who's already in a room's call, and where", () => {
  const seat = (who: string, broker: string, at: number) =>
    buildPresenceRumor(who, ROOM, 0n, { state: "joined", identity: `seat-${who.slice(0, 4)}`, broker }, 0, at);
  const T = 1_789_240_000;

  it("names the services people in the call are on, https only, each once", () => {
    const room = "room-1";
    noteCallPresence(room, seat("a".repeat(64), "https://armada.buzz", T));
    noteCallPresence(room, seat("b".repeat(64), "https://Armada.buzz/", T));
    noteCallPresence(room, seat("c".repeat(64), "http://plain.example", T));
    expect(callServicesIn(room, T * 1000 + 5_000)).toEqual(["https://armada.buzz"]);
  });

  it("forgets people whose presence went stale, and rooms nobody heard", () => {
    const room = "room-2";
    noteCallPresence(room, seat("a".repeat(64), "https://armada.buzz", T));
    expect(callServicesIn(room, T * 1000 + 120_000)).toEqual([]);
    expect(callServicesIn("never-heard", T * 1000)).toEqual([]);
  });
});
