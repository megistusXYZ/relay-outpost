import { describe, expect, it } from "vitest";
import {
  buildPictureEvent,
  canPostAsPicture,
  isPictureAttachment,
  PICTURE_POST_MIMES,
  type PicturePostAttachment,
} from "./picture-post";
import { KIND_PICTURE, MEDIA_DOMINANT_PROSE_LIMIT } from "./media-frame";

const SHA_A = "a".repeat(64);
const SHA_B = "0123456789abcdef".repeat(4);

function img(overrides: Partial<PicturePostAttachment> = {}): PicturePostAttachment {
  return {
    url: `https://nostr.build/${SHA_A}.jpg`,
    type: "image",
    mime: "image/jpeg",
    sha256: SHA_A,
    dim: "1200x800",
    ...overrides,
  };
}

describe("isPictureAttachment", () => {
  it("accepts every NIP-68 mime type", () => {
    for (const mime of PICTURE_POST_MIMES) {
      expect(isPictureAttachment(img({ mime }))).toBe(true);
    }
  });

  it("is case-insensitive on the mime", () => {
    expect(isPictureAttachment(img({ mime: "IMAGE/JPEG" }))).toBe(true);
  });

  it("rejects video attachments, unknown mimes and missing fingerprints", () => {
    expect(isPictureAttachment(img({ type: "video", mime: "video/mp4" }))).toBe(false);
    expect(isPictureAttachment(img({ mime: "image/heic" }))).toBe(false);
    expect(isPictureAttachment(img({ mime: undefined }))).toBe(false);
    expect(isPictureAttachment(img({ sha256: undefined }))).toBe(false);
    expect(isPictureAttachment(img({ url: "" }))).toBe(false);
  });
});

describe("canPostAsPicture", () => {
  const base = { attachments: [img()], hasAudio: false, hasGif: false, isPoll: false, caption: "sunset" };

  it("accepts an all-image, caption-length post", () => {
    expect(canPostAsPicture(base)).toBe(true);
    expect(canPostAsPicture({ ...base, attachments: [img(), img({ sha256: SHA_B, mime: "image/png" })] })).toBe(true);
  });

  it("accepts an empty caption (a picture needs no words)", () => {
    expect(canPostAsPicture({ ...base, caption: "" })).toBe(true);
  });

  it("rejects polls, audio, picker GIFs and empty attachment lists", () => {
    expect(canPostAsPicture({ ...base, isPoll: true })).toBe(false);
    expect(canPostAsPicture({ ...base, hasAudio: true })).toBe(false);
    expect(canPostAsPicture({ ...base, hasGif: true })).toBe(false);
    expect(canPostAsPicture({ ...base, attachments: [] })).toBe(false);
  });

  it("rejects when any attachment is not a qualifying picture", () => {
    expect(canPostAsPicture({ ...base, attachments: [img(), img({ type: "video", mime: "video/mp4" })] })).toBe(false);
    expect(canPostAsPicture({ ...base, attachments: [img({ sha256: undefined })] })).toBe(false);
  });

  it("uses the media-dominance prose limit on the caption", () => {
    expect(canPostAsPicture({ ...base, caption: "y".repeat(MEDIA_DOMINANT_PROSE_LIMIT) })).toBe(true);
    expect(canPostAsPicture({ ...base, caption: "y".repeat(MEDIA_DOMINANT_PROSE_LIMIT + 1) })).toBe(false);
  });

  it("measures prose the way readers see it — mentions and hashtags don't count", () => {
    const noise = `nostr:npub1${"q".repeat(58)} #photography #sunset`;
    expect(canPostAsPicture({ ...base, caption: `great light ${noise}` })).toBe(true);
  });
});

describe("buildPictureEvent", () => {
  it("assembles a spec-shaped kind 20: title, imeta per picture, m/x filter tags, extras last", () => {
    const event = buildPictureEvent({
      caption: "two frames from the pier",
      title: "Pier",
      attachments: [
        img({ fallbackUrl: `https://blossom.primal.net/${SHA_A}.jpg` }),
        img({ url: `https://nostr.build/${SHA_B}.png`, mime: "image/png", sha256: SHA_B, dim: "800x1200" }),
      ],
      extraTags: [["t", "photography"], ["client", "relay-outpost"]],
      createdAt: 1700000000,
    });
    expect(event).toEqual({
      kind: KIND_PICTURE,
      created_at: 1700000000,
      content: "two frames from the pier",
      tags: [
        ["title", "Pier"],
        [
          "imeta",
          `url https://nostr.build/${SHA_A}.jpg`,
          "m image/jpeg",
          "dim 1200x800",
          `x ${SHA_A}`,
          `fallback https://blossom.primal.net/${SHA_A}.jpg`,
        ],
        [
          "imeta",
          `url https://nostr.build/${SHA_B}.png`,
          "m image/png",
          "dim 800x1200",
          `x ${SHA_B}`,
        ],
        ["m", "image/jpeg"],
        ["m", "image/png"],
        ["x", SHA_A],
        ["x", SHA_B],
        ["t", "photography"],
        ["client", "relay-outpost"],
      ],
    });
  });

  it("omits the title tag when no title was given (title is optional)", () => {
    const event = buildPictureEvent({ caption: "", attachments: [img()], createdAt: 1 });
    expect(event!.tags.some((t) => t[0] === "title")).toBe(false);
    expect(event!.tags.filter((t) => t[0] === "imeta")).toHaveLength(1);
  });

  it("dedupes the top-level m filter tag across same-type pictures", () => {
    const event = buildPictureEvent({
      caption: "",
      attachments: [img(), img({ sha256: SHA_B })],
      createdAt: 1,
    });
    expect(event!.tags.filter((t) => t[0] === "m")).toEqual([["m", "image/jpeg"]]);
    expect(event!.tags.filter((t) => t[0] === "x")).toEqual([["x", SHA_A], ["x", SHA_B]]);
  });

  it("never emits a half-formed event: any non-qualifying attachment nulls the whole build", () => {
    expect(buildPictureEvent({ caption: "", attachments: [], createdAt: 1 })).toBeNull();
    expect(
      buildPictureEvent({ caption: "", attachments: [img(), img({ type: "video", mime: "video/mp4" })], createdAt: 1 }),
    ).toBeNull();
    expect(buildPictureEvent({ caption: "", attachments: [img({ sha256: "beef" })], createdAt: 1 })).toBeNull();
  });

  it("keeps media URLs out of content — imeta is the picture's home", () => {
    const event = buildPictureEvent({ caption: "  a caption  ", attachments: [img()], createdAt: 1 });
    expect(event!.content).toBe("a caption");
    expect(event!.content).not.toContain("https://");
  });
});
