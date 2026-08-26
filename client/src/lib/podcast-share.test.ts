import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSharedPodcast } from "./podcast-share";

// A note shaped exactly like the ShareToNostrDialog podcast share (RSSFeed.tsx).
const podcastNote = {
  content: [
    "https://cdn.example/cover.jpg",
    "",
    "Ep.527 ~ Inner Being is Ready to Clear the Path",
    "🎙️ Abraham Hicks",
    "",
    "💬 Discuss on Relay Outpost: https://relayop.xyz/news?discuss=...",
    "",
    "https://abrahamhicksinsight.podbean.com/e/527",
    "",
    "https://media.example/ep527.mp3",
  ].join("\n"),
  tags: [
    ["i", "https://abrahamhicksinsight.podbean.com/e/527"],
    ["r", "https://abrahamhicksinsight.podbean.com/e/527"],
    ["r", "https://media.example/ep527.mp3"],
    ["imeta", "url https://media.example/ep527.mp3", "m audio/mpeg", "duration 874"],
    ["r", "https://cdn.example/cover.jpg"],
    ["imeta", "url https://cdn.example/cover.jpg", "m image/jpeg"],
  ],
};

describe("parseSharedPodcast", () => {
  it("recovers audio, image, title, and duration from a shared podcast note", () => {
    const p = parseSharedPodcast(podcastNote)!;
    expect(p.audioUrl).toBe("https://media.example/ep527.mp3");
    expect(p.image).toBe("https://cdn.example/cover.jpg");
    expect(p.title).toBe("Ep.527 ~ Inner Being is Ready to Clear the Path");
    expect(p.duration).toBe(874);
  });

  it("returns null for a plain article share (no audio)", () => {
    expect(
      parseSharedPodcast({
        content: "Some headline\n\nhttps://news.example/story",
        tags: [["i", "https://news.example/story"], ["r", "https://news.example/story"]],
      }),
    ).toBeNull();
  });

  it("falls back to an `r` audio reference when there's no imeta", () => {
    const p = parseSharedPodcast({
      content: "My Episode",
      tags: [["r", "https://media.example/x.m4a"], ["r", "https://cdn.example/a.png"]],
    })!;
    expect(p.audioUrl).toBe("https://media.example/x.m4a");
    expect(p.image).toBe("https://cdn.example/a.png");
    expect(p.title).toBe("My Episode");
  });

  it("skips URL and marker lines when recovering the title", () => {
    const p = parseSharedPodcast({
      content: "https://cdn/cover.jpg\n\n🎙️ Show\n\nReal Title\n\nhttps://x/y",
      tags: [["imeta", "url https://m/a.mp3", "m audio/mpeg"]],
    })!;
    expect(p.title).toBe("🎙️ Show".startsWith("🎙️") ? "Real Title" : p.title);
    expect(p.title).toBe("Real Title");
  });

  it("is null-safe on malformed input", () => {
    expect(parseSharedPodcast(null)).toBeNull();
    expect(parseSharedPodcast({} as any)).toBeNull();
    expect(parseSharedPodcast({ tags: [] })).toBeNull();
  });
});

/**
 * The other direction: what we PUT in a share, not what we read out of one.
 *
 * Every news/podcast share used to open with
 * `💬 Discuss on Relay Outpost: https://…/news?discuss=…` — an ad for us, in the
 * middle of someone else's article, on every single share.
 *
 * Removing it costs nothing, and that is the point worth recording: the
 * discussion is anchored by the NIP-73 `["i", anchor]` TAG, so the thread exists
 * and stays joinable whether or not the body advertises it. The parser above
 * still handles the old line, because notes already published carry it forever.
 * This guards the emit side only.
 */
describe("the share body we emit", () => {
  const RSS_FEED = readFileSync(
    join(process.cwd(), "client", "src", "pages", "RSSFeed.tsx"),
    "utf8",
  );
  /** Strip comments — the source explains the removal using the removed words. */
  const code = RSS_FEED
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

  it("does not advertise our own site in the note body", () => {
    expect(code).not.toMatch(/Discuss on Relay Outpost/);
    expect(
      code.includes("/news?discuss="),
      "a link back to our own origin does not belong in the body of someone else's article",
    ).toBe(false);
  });

  it("still anchors the discussion, which is what actually makes it joinable", () => {
    // The whole justification for dropping the line. Lose this tag and the
    // removal stops being cosmetic and starts being a feature deletion.
    expect(code).toMatch(/tags\.push\(\["i", discussAnchor\]\)/);
  });
});
