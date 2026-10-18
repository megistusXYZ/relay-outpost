/**
 * Pictures fetched from other people's servers are decoded on ours. Only the
 * raster formats we expect are let through, judged by their first bytes, not
 * by what the server claims: an SVG (decoded by a separate, scriptable
 * library) or anything else is refused before it reaches the decoder.
 */
import { describe, it, expect } from "vitest";
import { rasterImageKind } from "./image-sniff";

const bytes = (...b: number[]) => Buffer.from(b);
const ascii = (s: string) => Buffer.from(s, "latin1");

describe("rasterImageKind", () => {
  it("recognises JPEG, PNG, GIF, WebP and AVIF by their first bytes", () => {
    expect(rasterImageKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("jpeg");
    expect(rasterImageKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("png");
    expect(rasterImageKind(ascii("GIF89a\x01\x00"))).toBe("gif");
    expect(rasterImageKind(ascii("RIFF\x10\x00\x00\x00WEBPVP8 "))).toBe("webp");
    expect(rasterImageKind(ascii("\x00\x00\x00\x1cftypavif\x00\x00\x00\x00"))).toBe("avif");
  });

  it("refuses SVG, however it starts", () => {
    expect(rasterImageKind(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(rasterImageKind(ascii('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(rasterImageKind(ascii("﻿  <svg/>"))).toBeNull();
  });

  it("refuses HTML, a RIFF that is not WebP, an ftyp that is not AVIF, and empty input", () => {
    expect(rasterImageKind(ascii("<!doctype html>"))).toBeNull();
    expect(rasterImageKind(ascii("RIFF\x10\x00\x00\x00WAVEfmt "))).toBeNull();
    expect(rasterImageKind(ascii("\x00\x00\x00\x18ftypmp42\x00\x00"))).toBeNull();
    expect(rasterImageKind(Buffer.alloc(0))).toBeNull();
  });
});
