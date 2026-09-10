/**
 * The profile's live treatment (components/profile/LiveNowBanner.tsx).
 *
 * Owner request 2026-09-10, phone screenshot: the live notice was a separate
 * red card between the cover and the identity card, costing a whole row. It
 * now lives INSIDE the cover as an overlay and the cover itself is the tap
 * target. What must not change: the link goes to the stream AUTHOR's address
 * — the streamer hosts, the platform publishes, and encoding the viewed
 * profile would mint an naddr for an event that does not exist.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import { nip19 } from "nostr-tools";
import { LiveBannerOverlay, liveStreamHref } from "./LiveNowBanner";

const AUTHOR = "ab".repeat(32);
const stream = {
  dTag: "meshtadel-2026-09-10",
  pubkey: AUTHOR,
  title: "Meshtadel Dispatch",
  currentParticipants: 16 as number | undefined,
  image: undefined as string | undefined,
};

const render = (s: typeof stream) =>
  renderToString(createElement(Router, { ssrPath: "/profile/x" }, createElement(LiveBannerOverlay, { stream: s })));

describe("liveStreamHref", () => {
  it("addresses the stream by its AUTHOR, not the profile being viewed", () => {
    const href = liveStreamHref(stream);
    expect(href.startsWith("/live/naddr1")).toBe(true);
    const decoded = nip19.decode(href.slice("/live/".length));
    expect(decoded.type).toBe("naddr");
    expect(decoded.data).toMatchObject({ pubkey: AUTHOR, identifier: "meshtadel-2026-09-10", kind: 30311 });
  });

  it("falls back to the Live index when the address can't be encoded", () => {
    expect(liveStreamHref({ ...stream, pubkey: "not-hex" })).toBe("/live");
  });
});

describe("LiveBannerOverlay", () => {
  it("is one link to the stream that says what it is", () => {
    const html = render(stream);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain(`href="${liveStreamHref(stream)}"`);
    expect(html).toContain('aria-label="Watch Meshtadel Dispatch live"');
    expect(html).toContain(">Live<");
    expect(html).toContain("Watch");
    expect(html).toContain("Meshtadel Dispatch");
  });

  it("shows the viewer count only when someone is watching", () => {
    expect(render(stream)).toContain('data-testid="profile-live-viewers"');
    expect(render({ ...stream, currentParticipants: 0 })).not.toContain("profile-live-viewers");
    expect(render({ ...stream, currentParticipants: undefined })).not.toContain("profile-live-viewers");
  });

  it("names an untitled stream honestly", () => {
    const html = render({ ...stream, title: "  " });
    expect(html).toContain("Streaming now");
    expect(html).toContain('aria-label="Watch this live stream"');
  });
});
