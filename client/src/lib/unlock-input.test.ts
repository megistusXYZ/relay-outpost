/**
 * The unlock screen takes either the password for this browser or the
 * account's key itself, which a password manager fills in (the key is what we
 * ask it to keep, under the npub). One field, read here.
 */
import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { readUnlockInput } from "./unlock-input";

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const nsec = nip19.nsecEncode(sk);

describe("readUnlockInput", () => {
  it("this account's key signs straight in, with its secret", () => {
    const r = readUnlockInput(`  ${nsec}\n`, pk);
    expect(r.kind).toBe("key");
    if (r.kind === "key") expect(getPublicKey(r.secret)).toBe(pk);
  });

  it("another account's key is named as such, never tried as a password", () => {
    expect(readUnlockInput(nip19.nsecEncode(generateSecretKey()), pk).kind).toBe("other-key");
  });

  it("a mangled key is a bad key, not a password", () => {
    expect(readUnlockInput(nsec.slice(0, -3), pk).kind).toBe("bad-key");
  });

  it("anything else is the password for this browser", () => {
    expect(readUnlockInput("correct horse battery", pk).kind).toBe("password");
    expect(readUnlockInput("nsecure-phrase", pk).kind).toBe("password");
  });
});
