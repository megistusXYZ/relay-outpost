// IPFS media handling: ipfs:// URIs must render as first-class media (gateway
// URL conversion, filename-param classification, prose stripping, gateway
// fallback) — and never leak into a post as raw text.
import { describe, it, expect } from "vitest";
import {
  IPFS_GATEWAYS,
  ipfsToHttp,
  ipfsGatewayFallback,
  classifyUrl,
  extractMediaFromContent,
} from "./media-utils";

const CID = "bafkreibo6qgvhtsyfwrxbdxzcnpjmbwifhbxvedbpkq5ehm4hjkm3vqrqm";

describe("ipfsToHttp", () => {
  it("converts a bare cid to the primary gateway", () => {
    expect(ipfsToHttp(`ipfs://${CID}`)).toBe(`https://ipfs.io/ipfs/${CID}`);
  });

  it("preserves path and query", () => {
    expect(ipfsToHttp(`ipfs://${CID}/dir/meme.jpg?filename=meme.jpg&x=1`)).toBe(
      `https://ipfs.io/ipfs/${CID}/dir/meme.jpg?filename=meme.jpg&x=1`,
    );
  });

  it("preserves query with no path (the reported post shape)", () => {
    expect(ipfsToHttp(`ipfs://${CID}?filename=meme.jpg`)).toBe(
      `https://ipfs.io/ipfs/${CID}?filename=meme.jpg`,
    );
  });

  it("tolerates the redundant ipfs://ipfs/<cid> form", () => {
    expect(ipfsToHttp(`ipfs://ipfs/${CID}/a.png`)).toBe(`https://ipfs.io/ipfs/${CID}/a.png`);
  });

  it("preserves CIDv0 case (Qm… is case-sensitive base58)", () => {
    const v0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
    expect(ipfsToHttp(`ipfs://${v0}`)).toBe(`https://ipfs.io/ipfs/${v0}`);
  });

  it("accepts an explicit gateway", () => {
    expect(ipfsToHttp(`ipfs://${CID}`, IPFS_GATEWAYS[1])).toBe(
      `https://cloudflare-ipfs.com/ipfs/${CID}`,
    );
  });

  it("returns null for non-IPFS input", () => {
    expect(ipfsToHttp("https://example.com/a.jpg")).toBeNull();
    expect(ipfsToHttp("ipns://example.com")).toBeNull();
    expect(ipfsToHttp("not a url")).toBeNull();
  });
});

describe("ipfsGatewayFallback", () => {
  it("swaps the primary gateway for the fallback, keeping cid/path/query", () => {
    expect(ipfsGatewayFallback(`https://ipfs.io/ipfs/${CID}/a.jpg?filename=a.jpg`)).toBe(
      `https://cloudflare-ipfs.com/ipfs/${CID}/a.jpg?filename=a.jpg`,
    );
  });

  it("returns null once the last gateway failed", () => {
    expect(ipfsGatewayFallback(`https://cloudflare-ipfs.com/ipfs/${CID}`)).toBeNull();
  });

  it("returns null for non-gateway URLs", () => {
    expect(ipfsGatewayFallback("https://example.com/a.jpg")).toBeNull();
  });
});

describe("classifyUrl filename-param classification", () => {
  it("classifies an extension-less gateway URL by ?filename=", () => {
    expect(classifyUrl(`https://ipfs.io/ipfs/${CID}?filename=meme.jpg`)).toBe("image");
    expect(classifyUrl(`https://ipfs.io/ipfs/${CID}?filename=clip.mp4`)).toBe("video");
    expect(classifyUrl(`https://ipfs.io/ipfs/${CID}?filename=song.mp3`)).toBe("audio");
  });

  it("still classifies by path extension first", () => {
    expect(classifyUrl(`https://ipfs.io/ipfs/${CID}/pic.png`)).toBe("image");
  });

  it("unknown extension stays a link (never raw text)", () => {
    expect(classifyUrl(`https://ipfs.io/ipfs/${CID}?filename=doc.zip`)).toBe("link");
    expect(classifyUrl(`https://ipfs.io/ipfs/${CID}`)).toBe("link");
  });
});

describe("extractMediaFromContent with ipfs:// tokens", () => {
  it("extracts an ipfs image and strips the raw token from the prose", () => {
    const raw = `ipfs://${CID}?filename=meme.jpg`;
    const { text, media } = extractMediaFromContent(`check this out ${raw} lol`);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("image");
    expect(media[0].url).toBe(`https://ipfs.io/ipfs/${CID}?filename=meme.jpg`);
    expect(media[0].originalText).toBe(raw);
    expect(text).toBe("check this out  lol");
    expect(text).not.toContain("ipfs://");
  });

  it("unknown-extension ipfs token becomes a link item, not raw text", () => {
    const raw = `ipfs://${CID}`;
    const { text, media } = extractMediaFromContent(`file: ${raw}`);
    expect(media).toHaveLength(1);
    expect(media[0].type).toBe("link");
    expect(media[0].url).toBe(`https://ipfs.io/ipfs/${CID}`);
    expect(text).not.toContain("ipfs://");
  });

  it("mixed http + ipfs content extracts both; http passthrough unchanged", () => {
    const { text, media } = extractMediaFromContent(
      `a https://example.com/pic.jpg and ipfs://${CID}/b.png end`,
    );
    expect(media).toHaveLength(2);
    expect(media[0]).toMatchObject({ type: "image", url: "https://example.com/pic.jpg" });
    expect(media[1]).toMatchObject({ type: "image", url: `https://ipfs.io/ipfs/${CID}/b.png` });
    expect(text).toBe("a  and  end");
  });

  it("non-ipfs content behaves exactly as before", () => {
    const { text, media } = extractMediaFromContent("plain note https://example.com/v.mp4");
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ type: "video", url: "https://example.com/v.mp4", originalText: "https://example.com/v.mp4" });
    expect(text).toBe("plain note");
  });
});

// NIP-92 imeta parsing: the `x` fingerprint and `fallback` mirrors feed the
// Blossom self-healing chain (see blossom-media.ts / use-blossom-heal).
import { parseImetaTags } from "./media-utils";

describe("parseImetaTags x + fallback", () => {
  const sha = "c".repeat(64);

  it("parses the x fingerprint (lowercased) alongside url/m/fallback", () => {
    const [data] = parseImetaTags([
      [
        "imeta",
        `url https://nostr.build/${sha}.jpg`,
        "m image/jpeg",
        `x ${sha.toUpperCase()}`,
        `fallback https://blossom.primal.net/${sha}.jpg`,
      ],
    ]);
    expect(data).toMatchObject({
      url: `https://nostr.build/${sha}.jpg`,
      mimeType: "image/jpeg",
      sha256: sha,
      fallbacks: [`https://blossom.primal.net/${sha}.jpg`],
    });
  });

  it("leaves sha256 undefined when the tag has no x entry", () => {
    const [data] = parseImetaTags([["imeta", "url https://x.example/a.png", "m image/png"]]);
    expect(data.sha256).toBeUndefined();
  });

  it("collects multiple fallback entries in order", () => {
    const [data] = parseImetaTags([
      ["imeta", "url https://x.example/a.png", "fallback https://m1.example/a.png", "fallback https://m2.example/a.png"],
    ]);
    expect(data.fallbacks).toEqual(["https://m1.example/a.png", "https://m2.example/a.png"]);
  });
});
