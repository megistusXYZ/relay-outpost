/**
 * A video-only account read as an account with nothing on it.
 *
 * `@Paranoid_Guy` (paranoidguy.divine.video) publishes NIP-71 kind-34236 short
 * videos and no kind-1 notes at all. The profile said "No videos yet" over 173
 * of them. Measured against live relays: 82 kind-34236 events on that pubkey,
 * zero kind-1s.
 *
 * Three independent gates each answered "no", and fixing any one alone changed
 * nothing:
 *   1. PROFILE_POST_KINDS never asked for 34235/34236, so the events were not
 *      fetched.
 *   2. Extraction read `imeta` not at all — it looked for a tag whose FIRST
 *      element was "url", but NIP-71 nests it: ("imeta", "url …", "m video/mp4").
 *   3. Every classifier tested a FILE EXTENSION, and divine.video serves
 *      `https://media.divine.video/<sha256>` with none — so the clips that did
 *      arrive were filed as images.
 */
import { describe, it, expect } from "vitest";
import { isVideoUrl, isVideoMedia, MEDIA_EVENT_KINDS, ADDRESSABLE_VIDEO_KINDS } from "./media-frame";
import { PROFILE_POST_KINDS } from "./feed-kinds";

describe("NIP-71 addressable video kinds", () => {
  it("are fetched for a profile — the gate that made 173 videos invisible", () => {
    expect(PROFILE_POST_KINDS).toContain(34236);
    expect(PROFILE_POST_KINDS).toContain(34235);
  });

  it("count as media event kinds", () => {
    for (const k of ADDRESSABLE_VIDEO_KINDS) expect(MEDIA_EVENT_KINDS).toContain(k);
  });

  it("keeps the regular kinds too — this was an addition, not a swap", () => {
    expect(PROFILE_POST_KINDS).toEqual(expect.arrayContaining([1, 20, 21, 22]));
  });
});

describe("classifying media without a file extension", () => {
  const DIVINE = "https://media.divine.video/cbfe9bb0a5c3903829566e82c647221012a5c1a5e4bc06fbe63f87eee6ec072c";

  it("cannot tell from the URL alone — which is the whole problem", () => {
    expect(isVideoUrl(DIVINE)).toBe(false);
  });

  it("believes the event when it declares video/*", () => {
    expect(isVideoMedia(DIVINE, { isVideo: true })).toBe(true);
  });

  it("falls back to the extension for a bare link that declares nothing", () => {
    expect(isVideoMedia("https://x.test/clip.mp4")).toBe(true);
    expect(isVideoMedia("https://x.test/photo.jpg")).toBe(false);
  });

  it("still treats a declared non-video as an image even if it looks like a clip", () => {
    // The declaration wins in BOTH directions, or it is not a declaration.
    expect(isVideoMedia("https://x.test/thing.mp4", { isVideo: false })).toBe(false);
  });

  it("knows about HLS, which one of the four old copies did not", () => {
    expect(isVideoUrl("https://x.test/stream.m3u8")).toBe(true);
  });
});
