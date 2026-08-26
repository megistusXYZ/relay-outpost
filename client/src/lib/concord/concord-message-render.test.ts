import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import {
  rumorRenderEvent,
  concordLinkKind,
  replyPreviewSegments,
} from "./concord-message-render";

const PK = "a".repeat(64);
const ID = "b".repeat(64);
const NPUB = nip19.npubEncode(PK);
const NOTE = nip19.noteEncode(ID);
const NPROFILE = nip19.nprofileEncode({ pubkey: PK, relays: ["wss://relay.example.com"] });

describe("rumorRenderEvent — pseudo-event for the shared renderer", () => {
  it("passes rumor fields through and never fabricates a signature", () => {
    const ev = rumorRenderEvent({ id: ID, pubkey: PK, content: "hello" });
    expect(ev.id).toBe(ID);
    expect(ev.pubkey).toBe(PK);
    expect(ev.content).toBe("hello");
    expect(ev.sig).toBe("");
  });

  it("synthesizes lowercase deduped t tags so hashtags render without real tags", () => {
    const ev = rumorRenderEvent({ id: ID, pubkey: PK, content: "#Nostr rocks #nostr #Bitcoin" });
    expect(ev.tags).toEqual([["t", "nostr"], ["t", "bitcoin"]]);
  });

  it("does not turn URL fragments into hashtags", () => {
    const ev = rumorRenderEvent({ id: ID, pubkey: PK, content: "see https://x.com/#frag here" });
    expect(ev.tags).toEqual([]);
  });
});

describe("concordLinkKind — privacy guard for URLs in an encrypted room", () => {
  it("classifies direct media files inline", () => {
    expect(concordLinkKind("https://cdn.example.com/pic.png")).toBe("image");
    expect(concordLinkKind("https://cdn.example.com/clip.mp4")).toBe("video");
    expect(concordLinkKind("https://cdn.example.com/song.mp3")).toBe("audio");
  });

  it("degrades third-party embeds to plain links (no iframes/unfurl in E2E rooms)", () => {
    expect(concordLinkKind("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("link");
    expect(concordLinkKind("https://vimeo.com/123456")).toBe("link");
    expect(concordLinkKind("https://open.spotify.com/track/xyz")).toBe("link");
  });

  it("classifies everything else as a plain link", () => {
    expect(concordLinkKind("https://example.com/article")).toBe("link");
    expect(concordLinkKind("not a url at all")).toBe("link");
  });
});

describe("replyPreviewSegments — one-line reply-quote model", () => {
  it("turns nostr:npub tokens into mention segments amid text", () => {
    const { segments, hadRef } = replyPreviewSegments(`hey nostr:${NPUB} welcome!`);
    expect(segments).toEqual([
      { type: "text", text: "hey " },
      { type: "mention", pubkey: PK },
      { type: "text", text: " welcome!" },
    ]);
    expect(hadRef).toBe(false);
  });

  it("resolves nprofile tokens to their pubkey", () => {
    const { segments } = replyPreviewSegments(`nostr:${NPROFILE} hi`);
    expect(segments[0]).toEqual({ type: "mention", pubkey: PK });
  });

  it("accepts bare npub tokens (no nostr: prefix)", () => {
    const { segments } = replyPreviewSegments(`cc ${NPUB}`);
    expect(segments).toEqual([
      { type: "text", text: "cc " },
      { type: "mention", pubkey: PK },
    ]);
  });

  it("collapses note/nevent refs out of the line but flags hadRef", () => {
    const { segments, hadRef } = replyPreviewSegments(`look nostr:${NOTE} wow`);
    expect(segments).toEqual([
      { type: "text", text: "look " },
      { type: "text", text: " wow" },
    ]);
    expect(hadRef).toBe(true);
  });

  it("reports hadRef with zero segments for a pure shared-post message", () => {
    const { segments, hadRef } = replyPreviewSegments(`nostr:${NOTE}`);
    expect(segments).toEqual([]);
    expect(hadRef).toBe(true);
  });

  it("strips junk nostr: tokens but keeps bare junk as text", () => {
    const junk = replyPreviewSegments("nostr:zzz9 hello");
    expect(junk.segments).toEqual([{ type: "text", text: "hello" }]);
    expect(junk.hadRef).toBe(false);
  });

  it("does not treat a bech32 glued to a word as a token", () => {
    const glued = replyPreviewSegments(`xx${NPUB}`);
    expect(glued.segments).toEqual([{ type: "text", text: `xx${NPUB}` }]);
  });

  it("collapses whitespace for the one-line quote", () => {
    const { segments } = replyPreviewSegments("a\n\n  b");
    expect(segments).toEqual([{ type: "text", text: "a b" }]);
  });

  it("is idempotent across repeated calls (no shared regex state)", () => {
    const input = `hey nostr:${NPUB} and nostr:${NOTE}`;
    expect(replyPreviewSegments(input)).toEqual(replyPreviewSegments(input));
  });

  it("handles a mixed message of text, mention, note ref and plain url", () => {
    const input = `ping nostr:${NPUB} see nostr:${NOTE} at https://example.com #tag`;
    const { segments, hadRef } = replyPreviewSegments(input);
    expect(hadRef).toBe(true);
    expect(segments).toEqual([
      { type: "text", text: "ping " },
      { type: "mention", pubkey: PK },
      { type: "text", text: " see " },
      { type: "text", text: " at https://example.com #tag" },
    ]);
  });
});
