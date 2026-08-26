import { describe, it, expect } from "vitest";
import {
  isProfileDirty,
  interpretNip05Response,
  lud16ToLnurlpUrl,
  isValidLnurlPayResponse,
  type ProfileEditSnapshot,
} from "./profile-editor";

const base: ProfileEditSnapshot = {
  name: "alice",
  displayName: "Alice",
  about: "hello",
  picture: "https://x/p.png",
  banner: "https://x/b.png",
  nip05: "alice@example.com",
  website: "https://alice.example",
  lud16: "alice@getalby.com",
  badgeOrder: ["wss://a", "wss://b"],
  hidden: ["wss://b"],
};

const clone = (o: ProfileEditSnapshot): ProfileEditSnapshot => ({
  ...o,
  badgeOrder: [...o.badgeOrder],
  hidden: [...o.hidden],
});

describe("isProfileDirty", () => {
  it("identical snapshots are not dirty", () => {
    expect(isProfileDirty(base, clone(base))).toBe(false);
  });

  it("detects each scalar field change", () => {
    const fields: (keyof ProfileEditSnapshot)[] = [
      "name",
      "displayName",
      "about",
      "picture",
      "banner",
      "nip05",
      "website",
      "lud16",
    ];
    for (const f of fields) {
      const cur = clone(base);
      (cur[f] as string) = String(base[f]) + "-changed";
      expect(isProfileDirty(base, cur)).toBe(true);
    }
  });

  it("badge order is order-sensitive", () => {
    const cur = clone(base);
    cur.badgeOrder = ["wss://b", "wss://a"];
    expect(isProfileDirty(base, cur)).toBe(true);
  });

  it("adding/removing a badge is dirty", () => {
    const cur = clone(base);
    cur.badgeOrder = ["wss://a", "wss://b", "wss://c"];
    expect(isProfileDirty(base, cur)).toBe(true);
  });

  it("hidden set is order-insensitive", () => {
    const orig = clone(base);
    orig.hidden = ["wss://a", "wss://b"];
    const cur = clone(base);
    cur.hidden = ["wss://b", "wss://a"];
    expect(isProfileDirty(orig, cur)).toBe(false);
  });

  it("changing the hidden set membership is dirty", () => {
    const cur = clone(base);
    cur.hidden = ["wss://a"];
    expect(isProfileDirty(base, cur)).toBe(true);
  });

  it("trimming to empty vs whitespace differs (exact compare)", () => {
    const cur = clone(base);
    cur.about = "hello ";
    expect(isProfileDirty(base, cur)).toBe(true);
  });
});

describe("interpretNip05Response", () => {
  it("verified:true → verified", () => {
    expect(interpretNip05Response({ verified: true })).toBe("verified");
  });

  it("verified:false → mismatch", () => {
    expect(interpretNip05Response({ verified: false })).toBe("mismatch");
  });

  it("missing field → mismatch", () => {
    expect(interpretNip05Response({})).toBe("mismatch");
  });

  it("null/undefined → mismatch", () => {
    expect(interpretNip05Response(null)).toBe("mismatch");
    expect(interpretNip05Response(undefined)).toBe("mismatch");
  });

  it("truthy-but-not-true value → mismatch (strict)", () => {
    expect(interpretNip05Response({ verified: 1 as unknown as boolean })).toBe("mismatch");
  });
});

describe("lud16ToLnurlpUrl", () => {
  it("derives the well-known lnurlp URL", () => {
    expect(lud16ToLnurlpUrl("alice@getalby.com")).toBe(
      "https://getalby.com/.well-known/lnurlp/alice",
    );
  });

  it("preserves subdomains and user casing", () => {
    expect(lud16ToLnurlpUrl("Bob@pay.walletofsatoshi.com")).toBe(
      "https://pay.walletofsatoshi.com/.well-known/lnurlp/Bob",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(lud16ToLnurlpUrl("  alice@getalby.com  ")).toBe(
      "https://getalby.com/.well-known/lnurlp/alice",
    );
  });

  it("rejects empty / nullish", () => {
    expect(lud16ToLnurlpUrl("")).toBeNull();
    expect(lud16ToLnurlpUrl(null)).toBeNull();
    expect(lud16ToLnurlpUrl(undefined)).toBeNull();
  });

  it("rejects missing @, leading @, or double @", () => {
    expect(lud16ToLnurlpUrl("aliceexample.com")).toBeNull();
    expect(lud16ToLnurlpUrl("@getalby.com")).toBeNull();
    expect(lud16ToLnurlpUrl("alice@bob@getalby.com")).toBeNull();
  });

  it("rejects missing user or domain", () => {
    expect(lud16ToLnurlpUrl("alice@")).toBeNull();
  });

  it("rejects a domain without a dot", () => {
    expect(lud16ToLnurlpUrl("alice@localhost")).toBeNull();
  });

  it("rejects internal whitespace", () => {
    expect(lud16ToLnurlpUrl("al ice@getalby.com")).toBeNull();
  });
});

describe("isValidLnurlPayResponse", () => {
  it("true when a non-empty callback string is present", () => {
    expect(isValidLnurlPayResponse({ callback: "https://getalby.com/cb", tag: "payRequest" })).toBe(true);
  });

  it("false for missing/empty/non-string callback", () => {
    expect(isValidLnurlPayResponse({})).toBe(false);
    expect(isValidLnurlPayResponse({ callback: "" })).toBe(false);
    expect(isValidLnurlPayResponse({ callback: 123 })).toBe(false);
    expect(isValidLnurlPayResponse(null)).toBe(false);
    expect(isValidLnurlPayResponse("nope")).toBe(false);
  });
});
