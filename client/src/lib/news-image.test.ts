/**
 * Whether a story's image is worth showing, and at what size. The calm News
 * column (2026-09) shows a picture only when it's good: no grey placeholder
 * boxes, no blown-up low-res art, and no outlet logo, avatar or tracking pixel
 * posing as the story's photo. A story without a usable image is a text row.
 */
import { describe, expect, it } from "vitest";
import { imageFit } from "./news-image";

describe("imageFit", () => {
  it("never shows a tracking pixel, an emoji, an avatar or the outlet's own logo as the story's picture", () => {
    const logo = "https://example.com/logo.png";
    expect(imageFit("", {})).toBeNull();
    expect(imageFit("data:image/gif;base64,R0lGODlhAQABAAAAACw=", {})).toBeNull();
    expect(imageFit("https://feeds.feedburner.com/~r/example/~4/abc123", {})).toBeNull();
    expect(imageFit("https://example.com/images/pixel.gif", {})).toBeNull();
    expect(imageFit("https://s.w.org/images/core/emoji/15.0.3/72x72/1f4f7.png", {})).toBeNull();
    expect(imageFit("https://secure.gravatar.com/avatar/abc123?s=96", {})).toBeNull();
    expect(imageFit(logo, { feedImage: logo })).toBeNull();
  });

  it("shows a picture as the lead only when it's big enough, as a thumbnail when it's small, and not at all when it's tiny", () => {
    expect(imageFit("https://example.com/photo.jpg", { width: 976 })).toEqual({ fit: "lead", verified: true });
    expect(imageFit("https://example.com/photo.jpg", { width: 240 })).toEqual({ fit: "thumb", verified: true });
    expect(imageFit("https://example.com/photo.jpg", { width: 90 })).toBeNull();
  });

  it("reads the size from the image address when the feed doesn't state it", () => {
    expect(imageFit("https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/abc.jpg", {})).toEqual({ fit: "thumb", verified: true });
    expect(imageFit("https://example.com/wp-content/uploads/2026/09/story-150x150.jpg", {})).toEqual({ fit: "thumb", verified: true });
    expect(imageFit("https://i.guim.co.uk/img/story.jpg?width=460&quality=85", {})).toEqual({ fit: "thumb", verified: true });
    expect(imageFit("https://cdn.example.com/photo.jpg?w=1200", {})).toEqual({ fit: "lead", verified: true });
  });
});
