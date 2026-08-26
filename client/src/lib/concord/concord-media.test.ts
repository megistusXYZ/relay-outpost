import { describe, it, expect } from "vitest";
import {
  mediaToTag, tagToMedia, mediaFromTags, isEncrypted, mediaKind,
  encryptedUploadServers, summarizeUploadFailures, ENCRYPTED_MEDIA_FALLBACK_SERVERS,
  type ConcordMedia,
} from "./concord-media";

const enc: ConcordMedia = { url: "https://blossom/abc", mime: "image/png", key: "aa".repeat(32), iv: "bb".repeat(12), dim: "800x600", name: "cat.png" };
const pub: ConcordMedia = { url: "https://tenor/x.gif", mime: "image/gif" };

describe("concord media imeta codec", () => {
  it("roundtrips an encrypted descriptor", () => {
    const out = tagToMedia(mediaToTag(enc));
    expect(out).toEqual(enc);
    expect(isEncrypted(out!)).toBe(true);
  });
  it("roundtrips a public (GIF) descriptor with no key/iv", () => {
    const tag = mediaToTag(pub);
    expect(tag).not.toContain("encryption-algorithm aes-gcm");
    const out = tagToMedia(tag);
    expect(out!.url).toBe(pub.url);
    expect(isEncrypted(out!)).toBe(false);
  });
  it("tolerates urls containing spaces-free query strings and returns null without a url", () => {
    expect(tagToMedia(["imeta", "m image/png"])).toBeNull();
    expect(tagToMedia(["e", "not-imeta"])).toBeNull();
  });
  it("extracts multiple media from a tag list, ignoring non-imeta tags", () => {
    const tags = [["channel", "x"], mediaToTag(enc), ["epoch", "1"], mediaToTag(pub)];
    const media = mediaFromTags(tags);
    expect(media).toHaveLength(2);
    expect(media[0].url).toBe(enc.url);
    expect(media[1].url).toBe(pub.url);
  });
  it("classifies media kind by mime", () => {
    expect(mediaKind({ url: "u", mime: "image/png" })).toBe("image");
    expect(mediaKind({ url: "u", mime: "video/mp4" })).toBe("video");
    expect(mediaKind({ url: "u", mime: "audio/mpeg" })).toBe("audio");
    expect(mediaKind({ url: "u", mime: "application/pdf" })).toBe("file");
  });
});

describe("encryptedUploadServers", () => {
  it("puts the user's servers first, then the ciphertext-friendly fallbacks", () => {
    expect(encryptedUploadServers(["https://my.blossom"])).toEqual([
      "https://my.blossom",
      ...ENCRYPTED_MEDIA_FALLBACK_SERVERS,
    ]);
  });
  it("falls back to the vetted servers when the user has none (the empty-list trap)", () => {
    // Regression: an unseeded Blossom list used to mean ZERO upload attempts →
    // an instant "Upload failed on all servers" without a single network call.
    expect(encryptedUploadServers([])).toEqual(ENCRYPTED_MEDIA_FALLBACK_SERVERS);
  });
  it("dedupes a user-listed fallback host (trailing slash + case insensitive)", () => {
    const out = encryptedUploadServers(["https://Nostr.download/", "https://my.blossom"]);
    expect(out).toEqual(["https://Nostr.download", "https://my.blossom", "https://files.sovbit.host"]);
  });
  it("drops empty entries", () => {
    expect(encryptedUploadServers(["", "  "], ["https://f.example"])).toEqual(["https://f.example"]);
  });
});

describe("summarizeUploadFailures", () => {
  it("surfaces the first server's real reason with its hostname", () => {
    const msg = summarizeUploadFailures([
      { server: "https://blossom.primal.net", message: "Blossom upload failed (415): upload rejected: unsupported media type application/octet-stream" },
      { server: "https://nostr.build", message: "not a Blossom server (returned a non-JSON response)" },
    ]);
    expect(msg).toContain("all 2 servers");
    expect(msg).toContain("blossom.primal.net");
    expect(msg).toContain("unsupported media type");
  });
  it("uses a single-server phrasing when only one was tried", () => {
    const msg = summarizeUploadFailures([{ server: "https://my.blossom", message: "Blossom upload failed (401): auth required" }]);
    expect(msg).toContain("my.blossom");
    expect(msg).toContain("auth required");
    expect(msg).not.toContain("all ");
  });
  it("explains the zero-server case instead of claiming servers failed", () => {
    expect(summarizeUploadFailures([])).toMatch(/no media servers/i);
  });
  it("compacts whitespace and caps very long server messages", () => {
    const msg = summarizeUploadFailures([{ server: "https://s.example", message: "line1\n\nline2  " + "x".repeat(500) }]);
    expect(msg).toContain("line1 line2");
    expect(msg.length).toBeLessThan(260);
  });
});
