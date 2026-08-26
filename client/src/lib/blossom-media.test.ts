// Blossom media-resilience: keep the fingerprint, mirror blobs (BUD-04), and
// assemble NIP-92 imeta tags. These helpers are the write-side foundation the
// read-side self-healing (and a later bulk re-sync) builds on.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  blossomAlternates,
  buildImetaTag,
  extractSha256FromUrl,
  isMediaUrlDead,
  markMediaUrlDead,
  mirrorBlob,
  pickMirrorTarget,
  resetDeadMediaUrls,
} from "./blossom-media";

const SHA = "a".repeat(64);
const SHA_B = "0123456789abcdef".repeat(4);

const fakeSigner = {
  signEvent: vi.fn(async (event: any) => ({
    ...event,
    id: "eventid",
    pubkey: "pubkey",
    sig: "sig",
  })),
};

describe("extractSha256FromUrl", () => {
  it("finds the hash in a bare Blossom path", () => {
    expect(extractSha256FromUrl(`https://blossom.primal.net/${SHA}`)).toEqual({
      sha256: SHA,
      ext: "",
    });
  });

  it("finds the hash and preserves the extension", () => {
    expect(extractSha256FromUrl(`https://cdn.example.com/${SHA}.jpg`)).toEqual({
      sha256: SHA,
      ext: ".jpg",
    });
  });

  it("normalizes uppercase hex to lowercase", () => {
    expect(extractSha256FromUrl(`https://cdn.example.com/${SHA.toUpperCase()}.png`)).toEqual({
      sha256: SHA,
      ext: ".png",
    });
  });

  it("ignores query strings", () => {
    expect(extractSha256FromUrl(`https://cdn.example.com/${SHA}.webp?width=640`)).toEqual({
      sha256: SHA,
      ext: ".webp",
    });
  });

  it("finds the hash in a nested path (nostr.build style)", () => {
    expect(extractSha256FromUrl(`https://image.nostr.build/media/${SHA}.gif`)).toEqual({
      sha256: SHA,
      ext: ".gif",
    });
  });

  it("returns null for non-hash URLs", () => {
    expect(extractSha256FromUrl("https://example.com/photos/cat.jpg")).toBeNull();
    expect(extractSha256FromUrl("https://example.com/" + "a".repeat(63))).toBeNull();
    expect(extractSha256FromUrl("not a url")).toBeNull();
  });
});

describe("buildImetaTag", () => {
  it("assembles url / m / x / fallback in NIP-92 space-separated form", () => {
    expect(
      buildImetaTag({
        url: `https://nostr.build/${SHA}.jpg`,
        mime: "image/jpeg",
        sha256: SHA,
        fallbacks: [`https://blossom.primal.net/${SHA}.jpg`],
      }),
    ).toEqual([
      "imeta",
      `url https://nostr.build/${SHA}.jpg`,
      "m image/jpeg",
      `x ${SHA}`,
      `fallback https://blossom.primal.net/${SHA}.jpg`,
    ]);
  });

  it("emits url + x when there is no mime or mirror", () => {
    expect(buildImetaTag({ url: "https://x.example/f.png", sha256: SHA })).toEqual([
      "imeta",
      "url https://x.example/f.png",
      `x ${SHA}`,
    ]);
  });

  it("includes dim when valid WxH and drops malformed dims", () => {
    expect(buildImetaTag({ url: "https://x.example/f.png", sha256: SHA, dim: "1200x800" })).toEqual([
      "imeta",
      "url https://x.example/f.png",
      "dim 1200x800",
      `x ${SHA}`,
    ]);
    for (const bad of ["axb", "0x100", "1200x", "x800", "1200X800", "12.5x80"]) {
      const tag = buildImetaTag({ url: "https://x.example/f.png", sha256: SHA, dim: bad });
      expect(tag!.some((part) => part.startsWith("dim "))).toBe(false);
    }
  });

  it("lowercases the fingerprint", () => {
    const tag = buildImetaTag({ url: "https://x.example/f.png", sha256: SHA.toUpperCase() });
    expect(tag).toContain(`x ${SHA}`);
  });

  it("returns null without a valid sha256 (no fingerprint, no tag)", () => {
    expect(buildImetaTag({ url: "https://x.example/f.png" })).toBeNull();
    expect(buildImetaTag({ url: "https://x.example/f.png", sha256: "beef" })).toBeNull();
    expect(buildImetaTag({ url: "", sha256: SHA })).toBeNull();
  });

  it("skips empty fallbacks and fallbacks equal to the primary url", () => {
    expect(
      buildImetaTag({
        url: "https://x.example/f.png",
        sha256: SHA,
        fallbacks: ["", "https://x.example/f.png"],
      }),
    ).toEqual(["imeta", "url https://x.example/f.png", `x ${SHA}`]);
  });
});

describe("pickMirrorTarget", () => {
  const servers = ["https://blossom.primal.net", "https://nostr.build", "https://cdn.satellite.earth"];

  it("picks the first server that is not the upload origin", () => {
    expect(pickMirrorTarget(`https://cdn.satellite.earth/${SHA}`, servers)).toBe(
      "https://blossom.primal.net",
    );
  });

  it("skips the origin the blob is already on", () => {
    expect(pickMirrorTarget(`https://blossom.primal.net/${SHA}`, servers)).toBe(
      "https://cdn.satellite.earth",
    );
  });

  it("never targets nostr.build (NIP-96, not Blossom)", () => {
    expect(pickMirrorTarget(`https://blossom.primal.net/${SHA}`, ["https://nostr.build"])).toBeNull();
    expect(
      pickMirrorTarget(`https://blossom.primal.net/${SHA}`, ["https://image.nostr.build"]),
    ).toBeNull();
  });

  it("returns null when there is no eligible second server", () => {
    expect(pickMirrorTarget(`https://blossom.primal.net/${SHA}`, ["https://blossom.primal.net"])).toBeNull();
    expect(pickMirrorTarget(`https://blossom.primal.net/${SHA}`, [])).toBeNull();
  });

  it("normalizes trailing slashes on the target", () => {
    expect(pickMirrorTarget(`https://nostr.build/${SHA}.jpg`, ["https://blossom.primal.net/"])).toBe(
      "https://blossom.primal.net",
    );
  });
});

describe("blossomAlternates", () => {
  const servers = ["https://blossom.primal.net", "https://cdn.satellite.earth"];

  it("derives the hash from a Blossom URL path and rehomes it on other servers", () => {
    expect(
      blossomAlternates(`https://media.example.com/${SHA}.jpg`, { servers }),
    ).toEqual([
      `https://blossom.primal.net/${SHA}.jpg`,
      `https://cdn.satellite.earth/${SHA}.jpg`,
    ]);
  });

  it("uses the imeta x hash for a non-Blossom URL (ext taken from the filename)", () => {
    expect(
      blossomAlternates("https://cdn.example.com/photos/cat.jpg", { sha256: SHA, servers }),
    ).toEqual([
      `https://blossom.primal.net/${SHA}.jpg`,
      `https://cdn.satellite.earth/${SHA}.jpg`,
    ]);
  });

  it("prefers the imeta x hash over the URL-path hash", () => {
    const urlHash = "b".repeat(64);
    const result = blossomAlternates(`https://media.example.com/${urlHash}.png`, {
      sha256: SHA,
      servers: ["https://blossom.primal.net"],
    });
    expect(result).toEqual([`https://blossom.primal.net/${SHA}.png`]);
  });

  it("accepts an uppercase x hash and emits lowercase candidates", () => {
    expect(
      blossomAlternates("https://cdn.example.com/f.webp", {
        sha256: SHA.toUpperCase(),
        servers: ["https://blossom.primal.net"],
      }),
    ).toEqual([`https://blossom.primal.net/${SHA}.webp`]);
  });

  it("preserves a bare (extension-less) blob URL shape", () => {
    expect(
      blossomAlternates(`https://media.example.com/${SHA}`, { servers: ["https://blossom.primal.net"] }),
    ).toEqual([`https://blossom.primal.net/${SHA}`]);
  });

  it("puts explicit imeta fallbacks first, then server candidates, deduped", () => {
    const fallback = `https://cdn.satellite.earth/${SHA}.jpg`;
    expect(
      blossomAlternates(`https://media.example.com/${SHA}.jpg`, { fallbacks: [fallback], servers }),
    ).toEqual([
      fallback, // fallback wins the first slot; the satellite server candidate dedupes into it
      `https://blossom.primal.net/${SHA}.jpg`,
    ]);
  });

  it("excludes every candidate on the failed URL's origin", () => {
    expect(
      blossomAlternates(`https://blossom.primal.net/${SHA}.jpg`, {
        fallbacks: [`https://blossom.primal.net/${SHA}.jpg?retry=1`],
        servers,
      }),
    ).toEqual([`https://cdn.satellite.earth/${SHA}.jpg`]);
  });

  it("never constructs a nostr.build candidate (NIP-96, not Blossom)", () => {
    expect(
      blossomAlternates(`https://media.example.com/${SHA}.jpg`, {
        servers: ["https://nostr.build", "https://image.nostr.build", "https://blossom.primal.net"],
      }),
    ).toEqual([`https://blossom.primal.net/${SHA}.jpg`]);
  });

  it("normalizes trailing slashes on server entries", () => {
    expect(
      blossomAlternates(`https://media.example.com/${SHA}`, { servers: ["https://blossom.primal.net//"] }),
    ).toEqual([`https://blossom.primal.net/${SHA}`]);
  });

  it("returns [] when no hash is derivable and there are no fallbacks", () => {
    expect(blossomAlternates("https://example.com/pic.png", { servers })).toEqual([]);
    expect(blossomAlternates("https://example.com/pic.png", { sha256: "nothex", servers })).toEqual([]);
  });

  it("still returns explicit fallbacks when no hash is derivable", () => {
    expect(
      blossomAlternates("https://example.com/pic.png", {
        fallbacks: ["https://mirror.example.net/pic.png"],
        servers,
      }),
    ).toEqual(["https://mirror.example.net/pic.png"]);
  });

  it("ignores IPFS-style URLs (CIDs are not 64-hex, so nothing to derive)", () => {
    expect(
      blossomAlternates("https://ipfs.io/ipfs/bafkreibo6qgvhtsyfwrxbdxzcnpjmbwifhbxvedbpkq5ehm4hjkm3vqrqm", {
        servers,
      }),
    ).toEqual([]);
  });
});

describe("dead-URL session cache", () => {
  beforeEach(() => resetDeadMediaUrls());
  afterEach(() => resetDeadMediaUrls());

  it("remembers failed URLs for the session", () => {
    expect(isMediaUrlDead("https://x.example/a.jpg")).toBe(false);
    markMediaUrlDead("https://x.example/a.jpg");
    expect(isMediaUrlDead("https://x.example/a.jpg")).toBe(true);
    expect(isMediaUrlDead("https://x.example/b.jpg")).toBe(false);
  });

  it("ignores empty URLs", () => {
    markMediaUrlDead("");
    expect(isMediaUrlDead("")).toBe(false);
  });
});

describe("mirrorBlob", () => {
  const realFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fakeSigner.signEvent.mockClear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("PUTs {target}/mirror with a JSON source-url body and BUD-04 upload auth", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: `https://cdn.satellite.earth/${SHA}.jpg`, sha256: SHA }),
    });

    const result = await mirrorBlob(
      `https://nostr.build/${SHA}.jpg`,
      SHA,
      "https://cdn.satellite.earth/",
      fakeSigner,
    );

    expect(result).toMatchObject({ ok: true, url: `https://cdn.satellite.earth/${SHA}.jpg` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cdn.satellite.earth/mirror");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ url: `https://nostr.build/${SHA}.jpg` });
    expect(init.headers["Content-Type"]).toBe("application/json");

    // Auth header: "Nostr " + base64(kind-24242 event with t=upload, x=sha256).
    const auth = init.headers["Authorization"];
    expect(auth.startsWith("Nostr ")).toBe(true);
    const authEvent = JSON.parse(atob(auth.slice("Nostr ".length)));
    expect(authEvent.kind).toBe(24242);
    expect(authEvent.tags).toContainEqual(["t", "upload"]);
    expect(authEvent.tags).toContainEqual(["x", SHA]);
    const expiration = authEvent.tags.find((t: string[]) => t[0] === "expiration");
    expect(Number(expiration[1])).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("derives the blob URL (with source extension) when the server omits it", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    const result = await mirrorBlob(
      `https://nostr.build/${SHA_B}.webp`,
      SHA_B,
      "https://cdn.satellite.earth",
      fakeSigner,
    );
    expect(result.ok).toBe(true);
    expect(result.url).toBe(`https://cdn.satellite.earth/${SHA_B}.webp`);
  });

  it("soft-fails on a non-2xx response (never throws)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const result = await mirrorBlob(`https://nostr.build/${SHA}.jpg`, SHA, "https://cdn.satellite.earth", fakeSigner);
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("soft-fails on a network error (never throws)", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    const result = await mirrorBlob(`https://nostr.build/${SHA}.jpg`, SHA, "https://cdn.satellite.earth", fakeSigner);
    expect(result.ok).toBe(false);
  });

  it("soft-fails on an invalid sha256 without hitting the network", async () => {
    const result = await mirrorBlob("https://nostr.build/x.jpg", "nothex", "https://cdn.satellite.earth", fakeSigner);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
