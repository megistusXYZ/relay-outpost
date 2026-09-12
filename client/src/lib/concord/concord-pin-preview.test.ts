/**
 * What the pinned bar says when a pinned message has no words to show.
 * Found in the browser: a pinned GIF/photo post read "Handled:" and nothing
 * else, because the preview drops media links and had no fallback.
 */
import { describe, it, expect } from "vitest";
import { pinMediaLabel } from "./concord-pin-preview";
import { mediaToTag } from "./concord-media";

const pinned = (content: string, tags: string[][] = []) => ({ content, tags });

describe("a pinned message with nothing to read", () => {
  it("a photo reads 'Photo', never blank", () => {
    const photo = mediaToTag({ url: "https://blossom.example/a.bin", mime: "image/jpeg", key: "k".repeat(64), iv: "i".repeat(24) });
    expect(pinMediaLabel(pinned("", [photo]))).toBe("Photo");
  });

  it("a GIF reads 'GIF', attached or pasted as a link", () => {
    const gif = mediaToTag({ url: "https://media.tenor.com/x.gif", mime: "image/gif" });
    expect(pinMediaLabel(pinned("", [gif]))).toBe("GIF");
    expect(pinMediaLabel(pinned("https://media.tenor.com/abc/tenor.gif"))).toBe("GIF");
  });

  it("names any other attachment: a video, or a file", () => {
    const video = mediaToTag({ url: "https://blossom.example/v.bin", mime: "video/mp4" });
    const file = mediaToTag({ url: "https://blossom.example/f.bin", mime: "application/octet-stream" });
    expect(pinMediaLabel(pinned("", [video]))).toBe("Video");
    expect(pinMediaLabel(pinned("", [file]))).toBe("Attachment");
  });
});
