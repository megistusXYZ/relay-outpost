/**
 * Group photos as the spec carries them (CORD-02 §6): an encrypted blob behind
 * `{url, key, nonce, hash}`. The spec names no cipher; Vector, the reference
 * client, uses AES-256-GCM with a 16-byte nonce, ciphertext || 16-byte tag,
 * and `hash` = SHA-256 of the plaintext (vector-core crypto::encrypt_data,
 * community::CommunityImage). Checked here against an independent AES-GCM
 * implementation both ways, since a mismatch would silently blank every photo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveObjectURL } from "node:buffer";
import { gcm } from "@noble/ciphers/aes.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { parseCommunityImage, openCommunityImage, sealCommunityImage, resolveCommunityImage, __clearCommunityImageCache } from "./concord-image";

const plain = utf8ToBytes("\x89PNG pretend this is a group photo");
const key = new Uint8Array(32).fill(7);
const nonce16 = new Uint8Array(16).fill(9);
const pointer = (over: Record<string, unknown> = {}) => ({
  url: "https://blossom.example/abc", key: bytesToHex(key), nonce: bytesToHex(nonce16), hash: bytesToHex(sha256(plain)), ext: "png", ...over,
});

describe("reading a group photo pointer", () => {
  it("accepts the spec's shape", () => {
    expect(parseCommunityImage(pointer())).toEqual(pointer());
  });

  it("refuses anything that can't be a working, safe pointer", () => {
    expect(parseCommunityImage("https://plain.example/photo.png")).toBeNull(); // a plain URL is our legacy `picture`, not this
    expect(parseCommunityImage(pointer({ url: "http://blossom.example/abc" }))).toBeNull();
    expect(parseCommunityImage(pointer({ key: "abc" }))).toBeNull();
    expect(parseCommunityImage(pointer({ nonce: "00".repeat(10) }))).toBeNull();
    expect(parseCommunityImage(pointer({ hash: undefined }))).toBeNull();
    expect(parseCommunityImage(null)).toBeNull();
  });

  it("accepts a 12-byte nonce too", () => {
    expect(parseCommunityImage(pointer({ nonce: "00".repeat(12) }))).not.toBeNull();
  });
});

describe("opening a group photo", () => {
  it("opens a blob sealed Vector's way (AES-256-GCM, 16-byte nonce, tag appended)", async () => {
    const blob = gcm(key, nonce16).encrypt(plain);
    expect(await openCommunityImage(blob, parseCommunityImage(pointer())!)).toEqual(plain);
  });

  it("fails closed on a swapped or damaged blob", async () => {
    const blob = gcm(key, nonce16).encrypt(plain);
    blob[3] ^= 1;
    expect(await openCommunityImage(blob, parseCommunityImage(pointer())!)).toBeNull();
  });

  it("fails closed when the image doesn't match its hash", async () => {
    const other = utf8ToBytes("a different picture");
    const blob = gcm(key, nonce16).encrypt(other);
    expect(await openCommunityImage(blob, parseCommunityImage(pointer())!)).toBeNull();
  });

  it("fails closed under the wrong key", async () => {
    const blob = gcm(new Uint8Array(32).fill(8), nonce16).encrypt(plain);
    expect(await openCommunityImage(blob, parseCommunityImage(pointer())!)).toBeNull();
  });
});

describe("showing a group photo", () => {
  const img = () => parseCommunityImage(pointer())!;
  const serve = (body: Uint8Array, ok = true) =>
    vi.fn(async (_url: string) => (ok ? new Response(body) : new Response("gone", { status: 404 })));
  beforeEach(() => __clearCommunityImageCache());

  it("fetches and opens it, and hands back a local URL for the image", async () => {
    const url = await resolveCommunityImage(img(), serve(gcm(key, nonce16).encrypt(plain)));
    expect(url).toMatch(/^blob:/);
    const blob = resolveObjectURL(url!)!;
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(plain);
    expect(blob.type).toBe("image/png");
  });

  it("fetches each photo once, however many avatars ask for it", async () => {
    const fetchFn = serve(gcm(key, nonce16).encrypt(plain));
    const [a, b] = await Promise.all([resolveCommunityImage(img(), fetchFn), resolveCommunityImage(img(), fetchFn)]);
    expect(b).toBe(a);
    expect(await resolveCommunityImage(img(), fetchFn)).toBe(a);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("shows nothing for a missing, swapped or unreachable blob, and tries again later", async () => {
    expect(await resolveCommunityImage(img(), serve(new Uint8Array(), false))).toBeNull();
    expect(await resolveCommunityImage(img(), serve(gcm(key, nonce16).encrypt(utf8ToBytes("another photo"))))).toBeNull();
    expect(await resolveCommunityImage(img(), vi.fn(async () => { throw new TypeError("offline"); }))).toBeNull();
    expect(await resolveCommunityImage(img(), serve(gcm(key, nonce16).encrypt(plain)))).toMatch(/^blob:/);
  });
});

describe("sealing our own group photo", () => {
  it("uses a fresh key and a 16-byte nonce, and opens with another implementation", async () => {
    const sealed = await sealCommunityImage(plain);
    expect(sealed.key).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(sealed.hash).toBe(bytesToHex(sha256(plain)));
    expect(gcm(hexToBytes(sealed.key), hexToBytes(sealed.nonce)).decrypt(sealed.ciphertext)).toEqual(plain);
    const again = await sealCommunityImage(plain);
    expect(again.key).not.toBe(sealed.key);
  });
});
