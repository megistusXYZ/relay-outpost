import { describe, it, expect } from "vitest";
import {
  selectUpNext,
  eventCandidateFromPinned,
  startOfLocalDay,
  DM_REPLY_MIN_AGE_MS,
  DM_REPLY_MAX_AGE_MS,
  SCHEDULED_WINDOW_MS,
  type UpNextEventCandidate,
  type UpNextScheduledCandidate,
  type UpNextDmCandidate,
} from "./up-next";

const H = 3_600_000;
// A local 09:00 "now" so today's-day math is unambiguous in any TZ.
const NOW = new Date(2026, 6, 17, 9, 0, 0).getTime();

const ev = (over: Partial<UpNextEventCandidate> & { id: string }): UpNextEventCandidate => ({
  title: `Event ${over.id}`,
  startMs: NOW + 2 * H,
  ...over,
});
const sched = (over: Partial<UpNextScheduledCandidate> & { id: string | number }): UpNextScheduledCandidate => ({
  snippet: `Post ${over.id}`,
  publishAtMs: NOW + 3 * H,
  pending: true,
  ...over,
});
const dm = (over: Partial<UpNextDmCandidate> & { peerPubkey: string }): UpNextDmCandidate => ({
  lastMessageMs: NOW - 2 * DM_REPLY_MIN_AGE_MS,
  lastIsInbound: true,
  ...over,
});

describe("priority order", () => {
  it("event beats scheduled beats dm", () => {
    const all = {
      events: [ev({ id: "e1" })],
      scheduled: [sched({ id: "s1" })],
      dms: [dm({ peerPubkey: "p1" })],
    };
    expect(selectUpNext(NOW, all)?.kind).toBe("event");
    expect(selectUpNext(NOW, { ...all, events: [] })?.kind).toBe("scheduled");
    expect(selectUpNext(NOW, { ...all, events: [], scheduled: [] })?.kind).toBe("dm");
  });

  it("returns null when nothing is timely", () => {
    expect(selectUpNext(NOW, {})).toBeNull();
    expect(
      selectUpNext(NOW, {
        events: [ev({ id: "tomorrow", startMs: NOW + 30 * H })],
        scheduled: [sched({ id: "later", publishAtMs: NOW + SCHEDULED_WINDOW_MS + 1 })],
        dms: [dm({ peerPubkey: "fresh", lastMessageMs: NOW - H })],
      }),
    ).toBeNull();
  });
});

describe("events: happening TODAY", () => {
  it("only local-today events qualify; soonest wins", () => {
    const pick = selectUpNext(NOW, {
      events: [
        ev({ id: "yesterday", startMs: NOW - 26 * H }),
        ev({ id: "later-today", startMs: NOW + 6 * H }),
        ev({ id: "soon", startMs: NOW + 1 * H }),
        ev({ id: "tomorrow", startMs: startOfLocalDay(NOW) + 25 * H }),
      ],
    });
    expect(pick).toMatchObject({ kind: "event", id: "soon" });
  });

  it("drops an event that already ended, keeps one still running", () => {
    expect(
      selectUpNext(NOW, {
        events: [ev({ id: "over", startMs: NOW - 3 * H, endMs: NOW - H })],
      }),
    ).toBeNull();
    expect(
      selectUpNext(NOW, {
        events: [ev({ id: "running", startMs: NOW - 3 * H, endMs: NOW + H })],
      }),
    ).toMatchObject({ id: "running" });
  });

  it("an all-day event today stays relevant all day", () => {
    const dayStart = startOfLocalDay(NOW);
    const pick = selectUpNext(NOW, {
      events: [ev({ id: "allday", startMs: dayStart, endMs: dayStart + 24 * H, allDay: true })],
    });
    expect(pick).toMatchObject({ kind: "event", id: "allday", allDay: true });
  });
});

describe("scheduled: within 24h, pending only", () => {
  it("boundary: inside window counts, outside/past/non-pending do not", () => {
    expect(
      selectUpNext(NOW, { scheduled: [sched({ id: "edge", publishAtMs: NOW + SCHEDULED_WINDOW_MS })] }),
    ).toMatchObject({ kind: "scheduled", id: "edge" });
    expect(selectUpNext(NOW, { scheduled: [sched({ id: "past", publishAtMs: NOW - 1 })] })).toBeNull();
    expect(
      selectUpNext(NOW, { scheduled: [sched({ id: "done", pending: false })] }),
    ).toBeNull();
  });

  it("soonest pending post wins", () => {
    expect(
      selectUpNext(NOW, {
        scheduled: [sched({ id: "b", publishAtMs: NOW + 5 * H }), sched({ id: "a", publishAtMs: NOW + 2 * H })],
      }),
    ).toMatchObject({ id: "a" });
  });
});

describe("dm: unanswered inbound, 24h–7d", () => {
  it("thresholds: younger than 24h or older than 7d never nags", () => {
    expect(
      selectUpNext(NOW, { dms: [dm({ peerPubkey: "young", lastMessageMs: NOW - DM_REPLY_MIN_AGE_MS + 1 })] }),
    ).toBeNull();
    expect(
      selectUpNext(NOW, { dms: [dm({ peerPubkey: "dead", lastMessageMs: NOW - DM_REPLY_MAX_AGE_MS - 1 })] }),
    ).toBeNull();
    expect(
      selectUpNext(NOW, { dms: [dm({ peerPubkey: "ripe", lastMessageMs: NOW - DM_REPLY_MIN_AGE_MS })] }),
    ).toMatchObject({ kind: "dm", peerPubkey: "ripe" });
  });

  it("outbound last message means already answered — no nag", () => {
    expect(
      selectUpNext(NOW, { dms: [dm({ peerPubkey: "answered", lastIsInbound: false })] }),
    ).toBeNull();
  });

  it("most recent qualifying thread wins", () => {
    expect(
      selectUpNext(NOW, {
        dms: [
          dm({ peerPubkey: "older", lastMessageMs: NOW - 3 * DM_REPLY_MIN_AGE_MS }),
          dm({ peerPubkey: "newer", lastMessageMs: NOW - 2 * DM_REPLY_MIN_AGE_MS }),
        ],
      }),
    ).toMatchObject({ peerPubkey: "newer" });
  });
});

describe("eventCandidateFromPinned", () => {
  it("timed events use unix-seconds startTime/endTime", () => {
    const c = eventCandidateFromPinned({ id: "t", title: "Standup", startTime: 1700000000, endTime: 1700003600 });
    expect(c).toMatchObject({ id: "t", title: "Standup", startMs: 1700000000000, endMs: 1700003600000, allDay: false });
  });

  it("all-day events parse YYYY-MM-DD as a LOCAL day spanning to day end", () => {
    const c = eventCandidateFromPinned({ id: "d", title: "Conf", startDate: "2026-07-17" });
    expect(c!.allDay).toBe(true);
    expect(c!.startMs).toBe(new Date(2026, 6, 17).getTime());
    expect(c!.endMs).toBe(new Date(2026, 6, 17).getTime() + 24 * H);
  });

  it("returns null without a usable start; untitled falls back to 'Event'", () => {
    expect(eventCandidateFromPinned({ id: "x" })).toBeNull();
    expect(eventCandidateFromPinned({ id: "x", startDate: "not-a-date" })).toBeNull();
    expect(eventCandidateFromPinned({ id: "u", startTime: 1700000000 })!.title).toBe("Event");
  });
});
