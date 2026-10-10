/**
 * The key file (owner, 2026-10-10, from the first-use review): one file, one
 * name, one thing to keep. It holds the key as text, says in plain words what
 * it is and how to use it, and names the real button on the sign-in screen.
 * The old file came in two shapes under one filename (signup wrote the raw key
 * next to an encrypted copy; the account page wrote only the encrypted copy,
 * which a Touch ID-first account could never open). "Check it works" is the
 * only feedback that settles whether a backup is a backup: it reads the file
 * back and says whether it opens THIS account.
 */
import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { buildKeyFile, keyFileName, findKeyInText, checkBackup } from "./key-file";

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
const npub = nip19.npubEncode(pubkey);
const nsec = nip19.nsecEncode(sk);

describe("the key file", () => {
  const text = buildKeyFile({ name: "HyperCool", npub, nsec, relays: ["wss://relay.damus.io", "wss://nos.lol"], createdAt: Date.UTC(2026, 9, 10) });

  it("holds the key as text, the public address, and the relays", () => {
    expect(text).toContain(nsec);
    expect(text).toContain(npub);
    expect(text).toContain("wss://relay.damus.io");
    expect(text).toContain("HyperCool");
  });
  it("calls the key by one name and never by the old ones", () => {
    expect(text).toMatch(/YOUR KEY/);
    expect(text).not.toMatch(/passphrase|recovery code|ncryptsec|backup file/i);
  });
  it("names the real button and says who can bring it back (nobody)", () => {
    expect(text).toContain("Use existing account");
    expect(text).toMatch(/Nobody, including us, can bring it back/);
  });
  it("is named after the account, not the day", () => {
    expect(keyFileName(npub)).toBe(`relay-outpost-key-${npub.slice(0, 12)}.txt`);
  });
});

describe("finding the key in whatever they hand back", () => {
  it("finds the key inside the file, or bare, with spaces around it", () => {
    expect(findKeyInText(buildKeyFile({ name: "", npub, nsec, relays: [], createdAt: 0 }))).toBe(nsec);
    expect(findKeyInText(`  ${nsec}\n`)).toBe(nsec);
  });
  it("finds nothing in a file without a key", () => {
    expect(findKeyInText("RELAY OUTPOST\nnothing here")).toBeNull();
    expect(findKeyInText("")).toBeNull();
  });
});

describe("Check it works", () => {
  it("says the key opens this account", () => {
    expect(checkBackup(buildKeyFile({ name: "", npub, nsec, relays: [], createdAt: 0 }), pubkey)).toBe("opens");
  });
  it("says when it is a key for a different account", () => {
    const other = nip19.nsecEncode(generateSecretKey());
    expect(checkBackup(other, pubkey)).toBe("other-account");
  });
  it("says when there is no key to read", () => {
    expect(checkBackup("my notes", pubkey)).toBe("unreadable");
    expect(checkBackup("nsec1notarealkey", pubkey)).toBe("unreadable");
  });
});
