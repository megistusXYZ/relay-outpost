/**
 * What was typed (or filled in) on the unlock screen: this account's key, some
 * other account's key, a key that doesn't decode, or the password for this
 * browser. Password managers keep the key under the npub, so filling the
 * unlock field with it is the quickest way back in.
 */
import { getPublicKey, nip19 } from "nostr-tools";

export type UnlockInput =
  | { kind: "key"; secret: Uint8Array }
  | { kind: "other-key" }
  | { kind: "bad-key" }
  | { kind: "password" };

export function readUnlockInput(value: string, pubkey: string): UnlockInput {
  const v = value.trim();
  if (!/^nsec1[02-9ac-hj-np-z]+$/i.test(v)) return { kind: "password" };
  try {
    const decoded = nip19.decode(v.toLowerCase());
    if (decoded.type !== "nsec") return { kind: "bad-key" };
    const secret = decoded.data as Uint8Array;
    return getPublicKey(secret) === pubkey.toLowerCase() ? { kind: "key", secret } : { kind: "other-key" };
  } catch {
    return { kind: "bad-key" };
  }
}
