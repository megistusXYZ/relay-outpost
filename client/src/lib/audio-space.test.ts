/**
 * Audio spaces (lib/audio-space.ts) — Corny Chat / Nostr Nests / HiveTalk
 * rooms as first-class live things instead of dead links and broken players.
 *
 * Measured before written (2026-08-26):
 *  - Corny Chat publishes standard kind-30311 with streaming/service = the
 *    room PAGE (https://cornychat.com/<room>) — a URL our live pipeline
 *    treats as a video stream and fails to play.
 *  - cornychat.com sends NO X-Frame-Options/CSP → embeddable in-app.
 *  - nostrnests.com sends X-Frame-Options: SAMEORIGIN → external tab only.
 *  - HiveTalk publishes kind-30312 meeting rooms (service URL), unmeasured
 *    for framing → treated external until measured.
 */
import { describe, expect, it } from "vitest";
import { audioSpaceFromUrl, isAudioSpace } from "./audio-space";

describe("audioSpaceFromUrl", () => {
  it("recognizes a Corny Chat room link — embeddable in-app (measured: no frame-blocking headers)", () => {
    const space = audioSpaceFromUrl("https://cornychat.com/moooooonboi?t=1787265022");
    expect(space).not.toBeNull();
    expect(space!.service).toBe("Corny Chat");
    expect(space!.embeddable).toBe(true);
    expect(space!.joinUrl).toBe("https://cornychat.com/moooooonboi");
    expect(space!.room).toBe("moooooonboi");
  });

  it("ignores the cornychat.com landing page — no room, no card", () => {
    expect(audioSpaceFromUrl("https://cornychat.com")).toBeNull();
    expect(audioSpaceFromUrl("https://cornychat.com/")).toBeNull();
  });

  it("leaves ordinary links alone", () => {
    expect(audioSpaceFromUrl("https://example.com/moooooonboi")).toBeNull();
    expect(audioSpaceFromUrl("not a url")).toBeNull();
  });
});

describe("isAudioSpace — a 30311 whose stream URL is a room page must not reach a video player", () => {
  it("Corny Chat's live events (streaming tag = the room page, measured shape) are rooms", () => {
    expect(isAudioSpace({ streamUrl: "https://cornychat.com/taint", hlsUrl: undefined })).toBe(true);
  });

  it("a real video stream is not a room, even from an audio-space host", () => {
    expect(isAudioSpace({ streamUrl: "https://cornychat.com/recordings/ep1.m3u8", hlsUrl: "https://cornychat.com/recordings/ep1.m3u8" })).toBe(false);
  });

  it("ordinary streams stay streams", () => {
    expect(isAudioSpace({ streamUrl: "https://data.zap.stream/stream/abc.m3u8", hlsUrl: "https://data.zap.stream/stream/abc.m3u8" })).toBe(false);
    expect(isAudioSpace({ streamUrl: undefined, hlsUrl: undefined })).toBe(false);
  });
});
