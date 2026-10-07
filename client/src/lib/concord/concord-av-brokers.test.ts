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
  const ARMADA = "https://armada.buzz";
  const answers = (up: string[]) => {
    const asked: string[] = [];
    return { asked, probe: async (o: string) => { asked.push(o); return up.includes(o); } };
  };
  const consenting = (yes: boolean) => {
    const asked: string[][] = [];
    return { asked, consent: async (origins: string[]) => { asked.push(origins); return yes; } };
  };

  it("the first of the group's services, in the shared order, that answers", async () => {
    const listed = [ARMADA, "https://calls.example"];
    const [, second] = rankBrokers(ROOM, listed);
    const { probe } = answers([second]);
    const { consent } = consenting(true);
    expect(await chooseCallService({ room: ROOM, listed, present: [], own, agreed: [], probe, consent }))
      .toEqual({ origin: second, agreedTo: rankBrokers(ROOM, listed) });
  });

  // Privacy: even a check tells a service your address and that you're about to call.
  it("contacts no other app's service before the person agrees, and asks once for all of them", async () => {
    const { asked: probed, probe } = answers([ARMADA]);
    const { asked, consent } = consenting(false);
    expect(await chooseCallService({ room: ROOM, listed: [ARMADA], present: [], own, agreed: [], probe, consent }))
      .toEqual({ origin: own, agreedTo: [] });
    expect(probed).toEqual([]);
    expect(asked).toEqual([[ARMADA]]);
  });

  it("when none of the group's services answers, it says so instead of quietly starting a separate call on ours", async () => {
    const { probe } = answers([]);
    const { consent } = consenting(true);
    expect(await chooseCallService({ room: ROOM, listed: [ARMADA], present: [], own, agreed: [], probe, consent })).toBeNull();
  });

  it("no list, and the service people are on doesn't answer: ours", async () => {
    const { probe } = answers([]);
    const { consent } = consenting(true);
    expect((await chooseCallService({ room: ROOM, listed: [], present: [ARMADA], own, agreed: [], probe, consent }))?.origin).toBe(own);
  });

  it("ours needs no check and no question: joining says so itself if it's down", async () => {
    const { asked: probed, probe } = answers([]);
    const { asked, consent } = consenting(true);
    expect(await chooseCallService({ room: ROOM, listed: [own], present: [], own, agreed: [], probe, consent })).toEqual({ origin: own, agreedTo: [] });
    expect(probed).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("doesn't ask again in a group where the person already agreed", async () => {
    const { probe } = answers([ARMADA]);
    const { asked, consent } = consenting(false);
    expect(await chooseCallService({ room: ROOM, listed: [ARMADA], present: [], own, agreed: [ARMADA], probe, consent }))
      .toEqual({ origin: ARMADA, agreedTo: [] });
    expect(asked).toEqual([]);
  });
});

describe("services on someone's own network are never contacted", () => {
  // A group's details or a caller's presence could name a router or a printer;
  // the member's browser would then knock on it from inside their network.
  it("ignores addresses, local names and one-word hosts", () => {
    expect(readAvBrokers([
      "https://192.168.1.1", "https://10.0.0.2:8443", "https://[::1]", "https://127.0.0.1",
      "https://localhost", "https://printer.local", "https://nas.lan", "https://router", "https://box.internal",
      "https://armada.buzz",
    ])).toEqual(["https://armada.buzz"]);
  });
  it("…in a caller's presence too", () => {
    const T = 1_789_240_000;
    noteCallPresence("room-lan", buildPresenceRumor("d".repeat(64), ROOM, 0n, { state: "joined", identity: "seat-d", broker: "https://192.168.0.1" }, 0, T));
    expect(callServicesIn("room-lan", T * 1000)).toEqual([]);
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
