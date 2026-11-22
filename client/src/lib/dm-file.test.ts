import { describe, it, expect } from "vitest";
import { resolveObjectURL } from "node:buffer";
import {
  buildFileMessageTags,
  parseFileMessage,
  isEncryptedFile,
  resolveDmFileUrl,
  FILE_ENCRYPTION_ALGO,
  type DmFileRef,
} from "./dm-file";

const encRef: DmFileRef = {
  url: "https://blossom.example/abc.enc",
  mime: "image/jpeg",
  key: "a".repeat(64),
  nonce: "b".repeat(32),
  algo: "aes-gcm",
  sha256: "c".repeat(64),
  size: 12345,
  dim: "800x600",
};

describe("buildFileMessageTags", () => {
  it("emits the NIP-17 kind-15 decryption tags for an encrypted ref", () => {
    const tags = buildFileMessageTags(encRef);
    const get = (n: string) => tags.find((t) => t[0] === n)?.[1];
    expect(get("file-type")).toBe("image/jpeg");
    expect(get("encryption-algorithm")).toBe("aes-gcm");
    expect(get("decryption-key")).toBe("a".repeat(64));
    expect(get("decryption-nonce")).toBe("b".repeat(32));
    expect(get("x")).toBe("c".repeat(64));
    expect(get("size")).toBe("12345");
    expect(get("dim")).toBe("800x600");
  });

  it("defaults the algorithm to aes-gcm when omitted", () => {
    const tags = buildFileMessageTags({ ...encRef, algo: undefined });
    expect(tags.find((t) => t[0] === "encryption-algorithm")?.[1]).toBe(FILE_ENCRYPTION_ALGO);
  });

  it("omits decryption tags when there is no key (public/legacy media)", () => {
    const tags = buildFileMessageTags({ url: "https://x/y.jpg", mime: "image/png" });
    expect(tags.some((t) => t[0] === "decryption-key")).toBe(false);
    expect(tags.some((t) => t[0] === "encryption-algorithm")).toBe(false);
    expect(tags.find((t) => t[0] === "file-type")?.[1]).toBe("image/png");
  });

  it("drops a zero/negative size instead of emitting a junk tag", () => {
    const tags = buildFileMessageTags({ ...encRef, size: 0 });
    expect(tags.some((t) => t[0] === "size")).toBe(false);
  });
});

describe("parseFileMessage", () => {
  it("round-trips an encrypted ref through build → parse", () => {
    const parsed = parseFileMessage(buildFileMessageTags(encRef), encRef.url);
    expect(parsed).toEqual({
      url: encRef.url,
      mime: "image/jpeg",
      algo: "aes-gcm",
      key: "a".repeat(64),
      nonce: "b".repeat(32),
      sha256: "c".repeat(64),
      size: 12345,
      dim: "800x600",
    });
    expect(isEncryptedFile(parsed!)).toBe(true);
  });

  it("reads the legacy plaintext shape (m tag, no key) as unencrypted", () => {
    const parsed = parseFileMessage([["m", "image/png"], ["size", "42"]], "https://host/pic.png");
    expect(parsed?.url).toBe("https://host/pic.png");
    expect(parsed?.mime).toBe("image/png");
    expect(parsed?.key).toBeUndefined();
    expect(isEncryptedFile(parsed!)).toBe(false);
  });

  it("prefers file-type over a legacy m tag when both are present", () => {
    const parsed = parseFileMessage([["file-type", "video/mp4"], ["m", "image/png"]], "https://h/v.enc");
    expect(parsed?.mime).toBe("video/mp4");
  });

  it("returns null when there is no url", () => {
    expect(parseFileMessage([["file-type", "image/png"]], "")).toBeNull();
    expect(parseFileMessage([["file-type", "image/png"]], "   ")).toBeNull();
  });

  it("ignores a non-numeric size tag", () => {
    const parsed = parseFileMessage([["size", "not-a-number"]], "https://h/x");
    expect(parsed?.size).toBeUndefined();
  });
});

/**
 * A received file is decrypted into a blob on this site's own origin. The
 * sender chose its type, so a stranger could send "text/html" and the
 * attachment link opened their page as relayop.xyz: a look-alike key prompt
 * on the real address. Only picture, video and sound types are kept; anything
 * else is plain bytes, which a browser downloads instead of showing.
 */
describe("resolveDmFileUrl, a received file's type", () => {
  const encrypt = async (body: string) => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const nonce = crypto.getRandomValues(new Uint8Array(16));
    const ck = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, ck, new TextEncoder().encode(body)));
    const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
    return { ct, key: hex(key), nonce: hex(nonce) };
  };
  const typeOf = async (mime: string, n: number) => {
    const { ct, key, nonce } = await encrypt("<!doctype html><title>Your session expired</title>");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(ct)) as typeof fetch;
    try {
      const url = await resolveDmFileUrl({ url: `https://blossom.example/f${n}-${mime}.enc`, mime, key, nonce, algo: "aes-gcm" });
      const blob = resolveObjectURL(url);
      return blob?.type;
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  it("a page, a script or an SVG becomes plain bytes", async () => {
    let n = 0;
    for (const mime of ["text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/pdf", "text/html; charset=utf-8", ""]) {
      expect(await typeOf(mime, n++), mime).toBe("application/octet-stream");
    }
  });

  it("pictures, video and sound keep their type, so they still show and play", async () => {
    let n = 100;
    for (const mime of ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm", "audio/mpeg", "audio/ogg", "audio/mp4"]) {
      expect(await typeOf(mime, n++), mime).toBe(mime);
    }
  });
});
