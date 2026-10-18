/**
 * The import field's username half: the npub of the key being pasted, so a
 * password manager files the key under its account. Unknown until a whole key
 * is there; an encrypted key (ncryptsec) can't be read without its passphrase.
 */
import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { npubForKeyInput } from "./key-input-npub";

const sk = generateSecretKey();
const npub = nip19.npubEncode(getPublicKey(sk));

describe("npubForKeyInput", () => {
  it("reads an nsec and a 64-character hex key", () => {
    expect(npubForKeyInput(` ${nip19.nsecEncode(sk)} `)).toBe(npub);
    expect(npubForKeyInput(bytesToHex(sk))).toBe(npub);
  });
  it("is empty for anything partial, encrypted or not a key", () => {
    expect(npubForKeyInput(nip19.nsecEncode(sk).slice(0, 20))).toBe("");
    expect(npubForKeyInput("ncryptsec1qgg")).toBe("");
    expect(npubForKeyInput("")).toBe("");
  });
});
