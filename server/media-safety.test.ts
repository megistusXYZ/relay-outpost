import { describe, it, expect } from "vitest";
import { safeStreamContentType, safeImageContentType } from "./media-safety";

describe("safeStreamContentType — never let a proxied stream render as a document", () => {
  it("passes real media types through unchanged", () => {
    for (const ct of ["video/mp2t", "video/mp4", "audio/mpeg", "audio/aac", "application/vnd.apple.mpegurl", "application/octet-stream"]) {
      expect(safeStreamContentType(ct)).toEqual({ contentType: ct, attachment: false });
    }
  });

  it("preserves media type parameters (charset/boundary) on pass-through", () => {
    expect(safeStreamContentType("video/mp4; codecs=avc1")).toEqual({ contentType: "video/mp4; codecs=avc1", attachment: false });
  });

  it("coerces executable/document types to an opaque attachment", () => {
    for (const ct of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/html; charset=utf-8", "text/xml", "application/xml"]) {
      expect(safeStreamContentType(ct)).toEqual({ contentType: "application/octet-stream", attachment: true });
    }
  });

  it("is case-insensitive and coerces a missing/empty type", () => {
    expect(safeStreamContentType("TEXT/HTML")).toEqual({ contentType: "application/octet-stream", attachment: true });
    expect(safeStreamContentType(null)).toEqual({ contentType: "application/octet-stream", attachment: true });
    expect(safeStreamContentType("")).toEqual({ contentType: "application/octet-stream", attachment: true });
  });
});

describe("safeImageContentType — raster allowlist, SVG and html rejected", () => {
  it("allows raster image types (base type only)", () => {
    expect(safeImageContentType("image/jpeg")).toBe("image/jpeg");
    expect(safeImageContentType("image/png")).toBe("image/png");
    expect(safeImageContentType("image/webp; charset=binary")).toBe("image/webp");
  });

  it("rejects SVG — the executable image type", () => {
    expect(safeImageContentType("image/svg+xml")).toBeNull();
  });

  it("rejects html and anything merely containing 'svg', and empty", () => {
    expect(safeImageContentType("text/html;x=svg")).toBeNull();
    expect(safeImageContentType("text/html")).toBeNull();
    expect(safeImageContentType(null)).toBeNull();
    expect(safeImageContentType("")).toBeNull();
  });
});
