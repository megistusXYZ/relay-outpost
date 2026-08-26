import { describe, it, expect } from "vitest";
import { getStreamHost, getStreamHosts, pickStreamSource, hasReplay } from "./live-events";

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
