import { describe, it, expect } from "vitest";
import {
  buildRsvp,
  rsvpDTag,
  getEventCoordinate,
  aggregateRsvps,
  KIND_CALENDAR_RSVP,
  KIND_TIME_CALENDAR_EVENT,
  type CalendarEventData,
  type RsvpStatus,
} from "./calendar-events";
import type { Event } from "nostr-tools";

const HOST = "a".repeat(64);
const NOW = 1785556800;

function ce(): CalendarEventData {
  return {
    id: "e".repeat(64),
    pubkey: HOST,
    dTag: "my-event",
    title: "Meetup",
    description: "",
    startTime: 1785609000,
    endTime: 1785614400,
    hashtags: [],
    participants: [],
    references: [],
    kind: KIND_TIME_CALENDAR_EVENT,
    event: {
      id: "e".repeat(64), pubkey: HOST, created_at: NOW, kind: KIND_TIME_CALENDAR_EVENT,
      tags: [["d", "my-event"]], content: "", sig: "s".repeat(128),
    },
  };
}

function rsvpEvent(pubkey: string, status: string, createdAt: number, id = pubkey.slice(0, 8) + createdAt): Event {
  return {
    id, pubkey, created_at: createdAt, kind: KIND_CALENDAR_RSVP,
    tags: [
      ["d", "rsvp-x"],
      ["a", getEventCoordinate(ce())],
      ["status", status],
    ],
    content: "", sig: "s".repeat(128),
  };
}

describe("getEventCoordinate", () => {
  it("is kind:pubkey:d", () => {
    expect(getEventCoordinate(ce())).toBe(`${KIND_TIME_CALENDAR_EVENT}:${HOST}:my-event`);
  });
});

describe("rsvpDTag — stable per user+event", () => {
  it("is deterministic", () => {
    const coord = getEventCoordinate(ce());
    expect(rsvpDTag("u1", coord)).toBe(rsvpDTag("u1", coord));
  });
  it("differs by user", () => {
    const coord = getEventCoordinate(ce());
    expect(rsvpDTag("u1", coord)).not.toBe(rsvpDTag("u2", coord));
  });
  it("differs by event", () => {
    expect(rsvpDTag("u1", "31923:x:a")).not.toBe(rsvpDTag("u1", "31923:x:b"));
  });
});

describe("buildRsvp", () => {
  const t = buildRsvp(ce(), "accepted", "viewer1", NOW, "wss://relay.example");

  it("is kind 31925 at the injected time", () => {
    expect(t.kind).toBe(KIND_CALENDAR_RSVP);
    expect(t.created_at).toBe(NOW);
  });
  it("carries d / a / e / p / status tags", () => {
    const coord = getEventCoordinate(ce());
    expect(t.tags).toContainEqual(["d", rsvpDTag("viewer1", coord)]);
    expect(t.tags).toContainEqual(["a", coord, "wss://relay.example"]);
    expect(t.tags).toContainEqual(["e", "e".repeat(64), "wss://relay.example"]);
    expect(t.tags).toContainEqual(["p", HOST]);
    expect(t.tags).toContainEqual(["status", "accepted"]);
  });
  it("adds fb=busy only when accepted", () => {
    expect(t.tags).toContainEqual(["fb", "busy"]);
    const maybe = buildRsvp(ce(), "tentative", "viewer1", NOW);
    expect(maybe.tags.find((tag) => tag[0] === "fb")).toBeUndefined();
  });
  it("omits relay hint when none given", () => {
    const noHint = buildRsvp(ce(), "declined", "viewer1", NOW);
    expect(noHint.tags).toContainEqual(["a", getEventCoordinate(ce())]);
  });
});

describe("aggregateRsvps", () => {
  it("counts going and maybe", () => {
    const agg = aggregateRsvps([
      rsvpEvent("u1", "accepted", 100),
      rsvpEvent("u2", "accepted", 100),
      rsvpEvent("u3", "tentative", 100),
      rsvpEvent("u4", "declined", 100),
    ]);
    expect(agg.goingCount).toBe(2);
    expect(agg.tentativeCount).toBe(1);
    expect(agg.goingPubkeys.sort()).toEqual(["u1", "u2"]);
  });

  it("keeps only the latest RSVP per author", () => {
    const agg = aggregateRsvps([
      rsvpEvent("u1", "accepted", 100),
      rsvpEvent("u1", "declined", 200), // u1 changed their mind → declined
    ]);
    expect(agg.goingCount).toBe(0);
  });

  it("a later tentative overrides an earlier accepted", () => {
    const agg = aggregateRsvps([
      rsvpEvent("u1", "accepted", 100),
      rsvpEvent("u1", "tentative", 200),
    ]);
    expect(agg.goingCount).toBe(0);
    expect(agg.tentativeCount).toBe(1);
  });

  it("reports the viewer's own latest status", () => {
    const agg = aggregateRsvps(
      [rsvpEvent("viewer", "accepted", 100), rsvpEvent("viewer", "tentative", 300)],
      "viewer",
    );
    expect(agg.myStatus).toBe("tentative");
  });

  it("myStatus is null when the viewer hasn't RSVP'd", () => {
    const agg = aggregateRsvps([rsvpEvent("u1", "accepted", 100)], "viewer");
    expect(agg.myStatus).toBeNull();
  });

  it("ignores non-RSVP kinds and unknown statuses", () => {
    const bad: Event = { ...rsvpEvent("u1", "maybe", 100) };
    const wrongKind: Event = { ...rsvpEvent("u2", "accepted", 100), kind: 1 };
    const agg = aggregateRsvps([bad, wrongKind]);
    expect(agg.goingCount).toBe(0);
    expect(agg.tentativeCount).toBe(0);
  });

  it("breaks created_at ties deterministically by id", () => {
    const a: Event = { ...rsvpEvent("u1", "accepted", 100, "aaa") };
    const b: Event = { ...rsvpEvent("u1", "declined", 100, "zzz") };
    // Same timestamp; higher id ('zzz') wins → declined → not going.
    expect(aggregateRsvps([a, b]).goingCount).toBe(0);
    expect(aggregateRsvps([b, a]).goingCount).toBe(0);
  });
});
