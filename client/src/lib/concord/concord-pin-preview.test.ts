/**
 * What the pinned bar says when a pinned message has no words to show.
 * Found in the browser: a pinned GIF/photo post read "Handled:" and nothing
 * else, because the preview drops media links and had no fallback.
 */
import { describe, it, expect } from "vitest";
import { pinMediaLabel, pinnedCard, pinFetchWindow } from "./concord-pin-preview";
import { mediaToTag } from "./concord-media";

const pinned = (content: string, tags: string[][] = []) => ({ content, tags });

/**
 * Found in the browser: the Pinned list showed "Handled · about 2 months ago"
 * and nothing else. The pinned message was a GIF, and the list rendered only
 * words. A pin carries the author's rumor, tags and all, so it can show the
 * message itself, the way Discord and Slack do.
 */
describe("what a pinned message shows in the list", () => {
  it("a GIF-only pin shows the GIF from its own proof", () => {
    const gif = mediaToTag({ url: "https://media.tenor.com/x.gif", mime: "image/gif" });
    const card = pinnedCard(pinned("", [gif]));
    expect(card.text).toBe("");
    expect(card.media.map((m) => m.url)).toEqual(["https://media.tenor.com/x.gif"]);
    expect(card.inRoom).toBe(false);
  });

  it("when the room holds the message, its current words win, marked edited, and it can be jumped to", () => {
    const card = pinnedCard(pinned("first draft"), { content: "final words", edited: true });
    expect(card.text).toBe("final words");
    expect(card.edited).toBe(true);
    expect(card.inRoom).toBe(true);
  });
});

/**
 * Found reading the room's loader: it shows this device's cache plus what the
 * relays hand back for an unbounded filter, their newest batch. A pin from
 * months ago is in neither, so Jump had nothing to land on. A stream wrap
 * carries its message's own time, untweaked (CORD-01), so the relays can be
 * asked for just the stretch around it.
 */
describe("reaching an older pin", () => {
  it("asks the relays for an hour either side of when it was sent", () => {
    expect(pinFetchWindow(1_700_000_000)).toEqual({ since: 1_699_996_400, until: 1_700_003_600 });
  });
});

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
