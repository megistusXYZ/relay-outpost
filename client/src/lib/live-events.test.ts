import { describe, it, expect } from "vitest";
import { getStreamHost, getStreamHosts, pickStreamSource, hasReplay, streamsOfPerson, isDirectMedia, parseLiveEvent, isShowableLive, type LiveEventData } from "./live-events";

const AUTHOR = "author_platform_pubkey";
const HOST = "host_streamer_pubkey";
const HOST2 = "cohost_pubkey";
const SPEAKER = "speaker_pubkey";

function make(participants: { pubkey: string; role: string }[]) {
  return { pubkey: AUTHOR, participants };
}

describe("getStreamHost", () => {
  it("returns the host-role participant, not the event author", () => {
    const stream = make([
      { pubkey: SPEAKER, role: "Speaker" },
      { pubkey: HOST, role: "host" },
    ]);
    expect(getStreamHost(stream)).toBe(HOST);
  });

  it("matches the host role case-insensitively", () => {
    expect(getStreamHost(make([{ pubkey: HOST, role: "Host" }]))).toBe(HOST);
    expect(getStreamHost(make([{ pubkey: HOST, role: "HOST" }]))).toBe(HOST);
  });

  it("falls back to the author pubkey when no host role is present", () => {
    const stream = make([{ pubkey: SPEAKER, role: "Speaker" }]);
    expect(getStreamHost(stream)).toBe(AUTHOR);
  });

  it("falls back to the author pubkey when there are no participants", () => {
    expect(getStreamHost(make([]))).toBe(AUTHOR);
  });

  it("returns the first host when several are tagged", () => {
    const stream = make([
      { pubkey: HOST, role: "host" },
      { pubkey: HOST2, role: "Host" },
    ]);
    expect(getStreamHost(stream)).toBe(HOST);
  });

  it("ignores non-host roles", () => {
    const stream = make([
      { pubkey: SPEAKER, role: "Speaker" },
      { pubkey: HOST2, role: "Participant" },
    ]);
    expect(getStreamHost(stream)).toBe(AUTHOR);
  });
});

describe("getStreamHosts", () => {
  it("returns all host/co-host pubkeys in tag order", () => {
    const stream = make([
      { pubkey: HOST, role: "host" },
      { pubkey: SPEAKER, role: "Speaker" },
      { pubkey: HOST2, role: "HOST" },
    ]);
    expect(getStreamHosts(stream)).toEqual([HOST, HOST2]);
  });

  it("returns an empty array when no host role is present", () => {
    expect(getStreamHosts(make([{ pubkey: SPEAKER, role: "Speaker" }]))).toEqual([]);
  });
});

describe("pickStreamSource (user report: ended stream's Rumble recording never played)", () => {
  it("an ended stream prefers its recording over a stale streaming tag", () => {
    expect(pickStreamSource("ended", "https://x/live.m3u8", "https://rumble.com/v123-replay.html"))
      .toBe("https://rumble.com/v123-replay.html");
  });

  it("an ended stream without a recording still offers the stream URL", () => {
    expect(pickStreamSource("ended", "https://x/live.m3u8", undefined)).toBe("https://x/live.m3u8");
  });

  it("a live stream plays the stream, recording only as fallback", () => {
    expect(pickStreamSource("live", "https://x/live.m3u8", "https://y/replay.mp4")).toBe("https://x/live.m3u8");
    expect(pickStreamSource("live", undefined, "https://y/replay.mp4")).toBe("https://y/replay.mp4");
  });

  it("nothing playable answers undefined, not empty string", () => {
    expect(pickStreamSource("ended", undefined, undefined)).toBeUndefined();
    expect(pickStreamSource(undefined, "", "")).toBeUndefined();
  });
});

describe("hasReplay (Past broadcasts show only watchable streams)", () => {
  it("a declared recording is the availability signal", () => {
    expect(hasReplay({ recordingUrl: "https://rumble.com/v123.html" })).toBe(true);
  });

  it("no recording, no listing — a stale streaming tag is not a replay", () => {
    expect(hasReplay({ recordingUrl: undefined })).toBe(false);
    expect(hasReplay({ recordingUrl: "" })).toBe(false);
    expect(hasReplay({ recordingUrl: "   " })).toBe(false);
  });
});

describe("streamsOfPerson (owner report: past broadcasts missing from profiles)", () => {
  const person = HOST;
  const s = (over: Partial<Parameters<typeof streamsOfPerson>[0][number]>) =>
    ({
      pubkey: AUTHOR,
      dTag: "show",
      participants: [{ pubkey: HOST, role: "Host" }],
      event: { created_at: 100 },
      ...over,
    }) as Parameters<typeof streamsOfPerson>[0][number];

  it("keeps streams the person authored OR is a tagged participant of", () => {
    const authored = s({ pubkey: person, dTag: "own", participants: [] });
    const hosted = s({ dTag: "hosted" });
    expect(streamsOfPerson([authored, hosted], person)).toHaveLength(2);
  });

  it("drops streams where the person is neither author nor participant", () => {
    const stranger = s({ participants: [{ pubkey: SPEAKER, role: "Speaker" }] });
    expect(streamsOfPerson([stranger], person)).toHaveLength(0);
  });

  it("keeps the NEWEST edition per author:dTag — the ended edition with the recording, not a stale live one", () => {
    const stale = s({ event: { created_at: 100 } as never });
    const current = s({ event: { created_at: 200 } as never });
    const got = streamsOfPerson([stale, current], person);
    expect(got).toHaveLength(1);
    expect(got[0].event.created_at).toBe(200);
  });

  it("dedupes on author:dTag, never dTag alone — two platforms can reuse a d value", () => {
    const a = s({ pubkey: AUTHOR });
    const b = s({ pubkey: "other_platform", participants: [{ pubkey: HOST, role: "Host" }] });
    expect(streamsOfPerson([a, b], person)).toHaveLength(2);
  });

  it("orders newest-first", () => {
    const older = s({ dTag: "one", event: { created_at: 50 } as never });
    const newer = s({ dTag: "two", event: { created_at: 150 } as never });
    expect(streamsOfPerson([older, newer], person).map((x) => x.dTag)).toEqual(["two", "one"]);
  });
});

describe("isDirectMedia (dead play button on YouTube-page recordings)", () => {
  it("accepts direct stream/file URLs, with query strings", () => {
    expect(isDirectMedia("https://cdn.zap.stream/abc/index.m3u8")).toBe(true);
    expect(isDirectMedia("https://media.example.com/show.mp4?token=x")).toBe(true);
    expect(isDirectMedia("https://media.example.com/audio.mp3")).toBe(true);
    expect(isDirectMedia("https://media.example.com/a.webm")).toBe(true);
  });

  it("rejects platform page links a <video> element cannot load", () => {
    expect(isDirectMedia("https://www.youtube.com/watch?v=cD_9xDIt0-Q")).toBe(false);
    expect(isDirectMedia("https://youtu.be/cD_9xDIt0-Q")).toBe(false);
    expect(isDirectMedia("https://rumble.com/v123-my-show.html")).toBe(false);
    expect(isDirectMedia("https://zap.stream/naddr1xyz")).toBe(false);
  });
});

// ── parseLiveEvent status ladder + isShowableLive (the stale-stream fixes,
//    owner ask 2026-08-31: no stream shown when it is no longer live) ────────
const NOW = Math.floor(Date.now() / 1000);
const H = 60 * 60;

function ev30311(tags: string[][], createdAt: number) {
  return { id: "e".repeat(64), kind: 30311, pubkey: "p".repeat(64), created_at: createdAt, content: "", tags: [["d", "show"], ...tags], sig: "" } as never;
}

describe("parseLiveEvent — the liveness claim's shelf life", () => {
  it("an explicit live event republished recently is live (the radio pattern: started long ago, refreshed constantly)", () => {
    const s = parseLiveEvent(ev30311([
      ["status", "live"], ["title", "Radio"], ["streaming", "https://x/s.m3u8"],
      ["starts", String(NOW - 400 * 24 * H)], ["current_participants", "12"],
    ], NOW - 5 * 60))!;
    expect(s.status).toBe("live");
  });

  it("a participants tag does not immortalize a stale claim — 13h without a republish is ended", () => {
    const s = parseLiveEvent(ev30311([
      ["status", "live"], ["title", "Old"], ["streaming", "https://x/s.m3u8"],
      ["starts", String(NOW - 13 * H)], ["current_participants", "3"],
    ], NOW - 13 * H))!;
    expect(s.status).toBe("ended");
  });

  it("a declared end that has passed, with no republish backing the claim, means ended", () => {
    const s = parseLiveEvent(ev30311([
      ["status", "live"], ["title", "Show"], ["streaming", "https://x/s.m3u8"],
      ["ends", String(NOW - 4 * H)], ["current_participants", "0"],
    ], NOW - 5 * H))!;
    expect(s.status).toBe("ended");
  });

  it("a passed end is forgiven while the event keeps being republished (running over is normal)", () => {
    const s = parseLiveEvent(ev30311([
      ["status", "live"], ["title", "Overtime"], ["streaming", "https://x/s.m3u8"],
      ["ends", String(NOW - 1 * H)], ["current_participants", "50"],
    ], NOW - 10 * 60))!;
    expect(s.status).toBe("live");
  });
});

describe("isShowableLive — the Live tab's single admission rule", () => {
  const base = (over: Partial<LiveEventData>): LiveEventData => ({
    id: "id", pubkey: "pk", dTag: "d", title: "T", summary: "", streamUrl: "https://x/s.m3u8",
    status: "live", hashtags: [], participants: [], relays: [], chatEnabled: true, isZapStream: false,
    event: { created_at: NOW - 10 * 60 } as never,
    ...over,
  });

  it("a verified-live probe answer always admits; offline always drops", () => {
    const old = base({ event: { created_at: NOW - 40 * H } as never });
    expect(isShowableLive(old, "verified-live", NOW)).toBe(true);
    expect(isShowableLive(base({}), "offline", NOW)).toBe(false);
  });

  it("unknown liveness falls back to freshness — and a participants tag no longer bypasses the gate", () => {
    const staleWithViewers = base({ currentParticipants: 7, event: { created_at: NOW - 5 * H } as never });
    expect(isShowableLive(staleWithViewers, "unknown", NOW)).toBe(false);
    expect(isShowableLive(base({}), "unknown", NOW)).toBe(true);
  });

  it("only status live is admitted at all", () => {
    expect(isShowableLive(base({ status: "ended" }), "verified-live", NOW)).toBe(false);
  });
});
