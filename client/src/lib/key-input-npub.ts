/**
 * The npub of a key pasted into the import field, or "" when there isn't a
 * whole readable key yet (partial, encrypted ncryptsec, or not a key).
 */
import { getPublicKey, nip19 } from "nostr-tools";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function npubForKeyInput(text: string): string {
  const v = text.trim();
  try {
    if (/^nsec1/i.test(v)) {
      const d = nip19.decode(v.toLowerCase());
      return d.type === "nsec" ? nip19.npubEncode(getPublicKey(d.data as Uint8Array)) : "";
    }
    if (/^[0-9a-f]{64}$/i.test(v)) return nip19.npubEncode(getPublicKey(hexToBytes(v.toLowerCase())));
  } catch {
    // partial or malformed: not a key yet
  }
  return "";
}
