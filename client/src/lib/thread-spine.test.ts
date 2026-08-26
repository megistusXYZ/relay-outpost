import { describe, it, expect } from "vitest";
import {
  formatEngagementSummary,
  shouldShowRootMarker,
  formatRootMarkerLabel,
} from "./thread-spine";

describe("formatEngagementSummary", () => {
  it("joins all non-zero tallies with a middot separator", () => {
    expect(
      formatEngagementSummary({ replies: 39, reposts: 26, likes: 29 }),
    ).toBe("39 replies · 26 reposts · 29 likes");
  });

  it("hides zero tallies", () => {
    expect(
      formatEngagementSummary({ replies: 12, reposts: 0, likes: 5 }),
    ).toBe("12 replies · 5 likes");
  });

  it("returns empty string when nothing has engagement", () => {
    expect(
      formatEngagementSummary({ replies: 0, reposts: 0, likes: 0 }),
    ).toBe("");
  });

  it("pluralizes 'reply' to 'replies' and singularizes at 1", () => {
    expect(formatEngagementSummary({ replies: 1, reposts: 1, likes: 1 })).toBe(
      "1 reply · 1 repost · 1 like",
    );
    expect(formatEngagementSummary({ replies: 2, reposts: 2, likes: 2 })).toBe(
      "2 replies · 2 reposts · 2 likes",
    );
  });

  it("includes zaps only when provided and > 0", () => {
    expect(
      formatEngagementSummary({ replies: 0, reposts: 0, likes: 0, zaps: 3 }),
    ).toBe("3 zaps");
    expect(
      formatEngagementSummary({ replies: 1, reposts: 0, likes: 0, zaps: 0 }),
    ).toBe("1 reply");
  });

  it("abbreviates large counts like the feed (formatCount)", () => {
    expect(
      formatEngagementSummary({ replies: 1200, reposts: 0, likes: 0 }),
    ).toBe("1.2k replies");
  });
});

describe("shouldShowRootMarker", () => {
  it("shows the marker only when there is at least one ancestor", () => {
    expect(shouldShowRootMarker(0)).toBe(false);
    expect(shouldShowRootMarker(1)).toBe(true);
    expect(shouldShowRootMarker(5)).toBe(true);
  });
});

describe("formatRootMarkerLabel", () => {
  it("appends the reply count when known", () => {
    expect(formatRootMarkerLabel(39)).toBe("Start of conversation · 39 replies");
    expect(formatRootMarkerLabel(1)).toBe("Start of conversation · 1 reply");
  });

  it("shows only the lead-in when the count is not yet known", () => {
    expect(formatRootMarkerLabel(0)).toBe("Start of conversation");
  });
});
