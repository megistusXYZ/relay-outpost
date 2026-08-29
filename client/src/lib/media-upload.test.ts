import { describe, it, expect } from "vitest";
import { scrubMp4MetadataBoxes } from "./media-upload";

// ISO-BMFF box: [4-byte big-endian size][4-byte ascii type][payload].
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
function box(type: string, payload: Uint8Array): Uint8Array {
  const b = new Uint8Array(8 + payload.length);
  new DataView(b.buffer).setUint32(0, b.length);
  b.set(ascii(type), 4);
  b.set(payload, 8);
  return b;
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const typeAt = (b: Uint8Array, p: number) => String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);

describe("scrubMp4MetadataBoxes — strip GPS/device metadata, corruption-free", () => {
  it("neutralizes moov/udta (GPS) to a `free` box and zeroes its payload, size-preserving", () => {
    const gps = box("©xyz", ascii("+37.7749-122.4194/")); // Apple location atom
    const udta = box("udta", gps);
    const ftyp = box("ftyp", ascii("isom\0\0\0\0"));
    const mdat = box("mdat", new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD, 0, 0, 0, 0]));
    // moov AFTER mdat (typical phone capture) — and it doesn't matter, since we
    // never change any byte offsets.
    const file = concat(ftyp, mdat, box("moov", udta));
    const originalLength = file.length;

    const stripped = scrubMp4MetadataBoxes(file);
    expect(stripped).toBe(true);
    // The single most important property: same length → mdat never shifts →
    // stco/co64 offsets stay valid → the video cannot be corrupted.
    expect(file.length).toBe(originalLength);

    const udtaStart = ftyp.length + mdat.length + 8; // inside moov
    expect(typeAt(file, udtaStart)).toBe("free");
    // The GPS payload region is wiped to zero.
    const payload = file.subarray(udtaStart + 8, udtaStart + 8 + gps.length);
    expect([...payload].every((x) => x === 0)).toBe(true);
    // ftyp + mdat are byte-for-byte untouched.
    expect(typeAt(file, 0)).toBe("ftyp");
    expect(file[ftyp.length + 8]).toBe(0xAA);
  });

  it("finds udta nested inside a trak too", () => {
    const udta = box("udta", box("©xyz", ascii("loc")));
    const trak = box("trak", udta);
    const file = concat(box("ftyp", ascii("isom\0\0\0\0")), box("moov", trak));
    expect(scrubMp4MetadataBoxes(file)).toBe(true);
    const udtaStart = /* ftyp */ 16 + /* moov hdr */ 8 + /* trak hdr */ 8;
    expect(typeAt(file, udtaStart)).toBe("free");
  });

  it("refuses to touch a file that isn't a real MP4 (no ftyp) — never scribbles", () => {
    const notMp4 = concat(box("junk", ascii("xxxx")), box("udta", ascii("GPS!")));
    const copy = notMp4.slice();
    expect(scrubMp4MetadataBoxes(notMp4)).toBe(false);
    expect(notMp4).toEqual(copy);
  });

  it("returns false and changes nothing for a clean MP4 with no metadata box", () => {
    const file = concat(box("ftyp", ascii("isom\0\0\0\0")), box("mdat", ascii("mediabytes")));
    const copy = file.slice();
    expect(scrubMp4MetadataBoxes(file)).toBe(false);
    expect(file).toEqual(copy);
  });
});
