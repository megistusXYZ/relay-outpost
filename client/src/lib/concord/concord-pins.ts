/**
 * Pins (CORD-04 §7).
 *
 * A pin doesn't quote a message, it proves one: the message's original signed
 * seal plus the one-shot NIP-44 keys that open it (76 bytes, disclosing that
 * message and nothing else). Any member able to read the list, including one
 * who joined after a rekey and holds no history, verifies author, words, room
 * and time from the pin alone.
 *
 * One Pin List per room, on the admin plane, replaced entire on every edit.
 * Pure: building, verifying, reading and writing lists. Publishing lives in
 * concord-governance.
 */
import { hkdf, expand } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { chacha20 } from "@noble/ciphers/chacha.js";
import { verifyEvent, getEventHash, type Event } from "nostr-tools";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils.js";

/** CORD-02 A.6: secret = community_id, id = channel_id, no epoch. */
export const LABEL_PINS = "concord/pins";

/**
 * A room's Pin List coordinate, its edition `eid`. Derived from the group's id
 * and the room's, never from a key or an epoch, so it survives every rekey and
 * a member holding only the newest root derives the same one (CORD-04 §1).
 */
export function pinsLocator(communityId: string, channelId: string): string {
  const info = concatBytes(utf8ToBytes(LABEL_PINS), new Uint8Array([0x00]), hexToBytes(channelId));
  return bytesToHex(hkdf(sha256, hexToBytes(communityId), undefined, info, 32));
}

// ── The proof bundle ─────────────────────────────────────────────────────────
/** A seal event as a pin carries it: every field, the content string unaltered. */
export type PinSeal = { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };

/**
 * One pin. `keys` is the message's own NIP-44 expansion,
 * chacha_key[32] ‖ chacha_nonce[12] ‖ hmac_key[32], in hex: it opens that
 * message and nothing else, not the room's key or anyone's other messages.
 * Fields another app adds (`wrap`, `edit`, …) ride along.
 */
export type PinEntry = { seal: PinSeal; keys: string; [field: string]: unknown };

/** A pinned message as its proof shows it: who, what, where and when. */
export type PinnedRumor = { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string };

export type PinVerdict = { ok: true; rumor: PinnedRumor; id: string } | { ok: false };

const KIND_ENCRYPTED_SEAL = 20013;

function fromBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/** A NIP-44 v2 payload: version 2 ‖ nonce[32] ‖ ciphertext ‖ mac[32]. */
function decodePayload(payload: unknown): { nonce: Uint8Array; ciphertext: Uint8Array; mac: Uint8Array } | null {
  if (typeof payload !== "string" || payload.length < 132 || payload[0] === "#") return null;
  const data = fromBase64(payload);
  if (!data || data.length < 99 || data[0] !== 2) return null;
  return { nonce: data.subarray(1, 33), ciphertext: data.subarray(33, -32), mac: data.subarray(-32) };
}

function unpad(padded: Uint8Array): string | null {
  if (padded.length < 2) return null;
  const len = (padded[0] << 8) | padded[1];
  if (len < 1 || padded.length !== 2 + nip44v2.utils.calcPaddedLen(len)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(padded.subarray(2, 2 + len)); } catch { return null; }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const sealFields = (s: PinSeal): PinSeal =>
  ({ id: s.id, pubkey: s.pubkey, created_at: s.created_at, kind: s.kind, tags: s.tags, content: s.content, sig: s.sig });

/**
 * A pin for a message, from its original seal and the room's conversation key
 * (which the pinner holds, as any member of the room at that epoch does).
 */
export function makePinEntry(seal: PinSeal, roomConvKey: Uint8Array): PinEntry {
  const p = decodePayload(seal.content);
  if (!p) throw new Error("makePinEntry: not a NIP-44 v2 seal");
  return { seal: sealFields(seal), keys: bytesToHex(expand(sha256, roomConvKey, p.nonce, 76)) };
}

/**
 * Verify a pin with nothing but the pin and the room it is listed in
 * (CORD-04 §7, five steps). Any failure drops this entry alone.
 */
export function verifyPinEntry(entry: PinEntry, channelId: string, kinds: readonly number[] = [9, 1111]): PinVerdict {
  try {
    const seal = entry?.seal;
    // 1. An encrypted seal whose signature holds: its pubkey is the proven author.
    //    A fresh copy, so a cached "already verified" mark can never stand in.
    if (!seal || seal.kind !== KIND_ENCRYPTED_SEAL || !verifyEvent(sealFields(seal) as Event)) return { ok: false };
    if (typeof entry.keys !== "string" || !/^[0-9a-f]{152}$/.test(entry.keys)) return { ok: false };
    const keys = hexToBytes(entry.keys);
    const chachaKey = keys.subarray(0, 32), chachaNonce = keys.subarray(32, 44), hmacKey = keys.subarray(44, 76);
    // 2. The MAC, with the disclosed HMAC key.
    const p = decodePayload(seal.content);
    if (!p || !sameBytes(hmac(sha256, hmacKey, concatBytes(p.nonce, p.ciphertext)), p.mac)) return { ok: false };
    // 3. Decrypt, unpad, parse.
    const json = unpad(chacha20(chachaKey, chachaNonce, p.ciphertext));
    if (json === null) return { ok: false };
    const r = JSON.parse(json) as Partial<PinnedRumor>;
    if (typeof r.pubkey !== "string" || typeof r.created_at !== "number" || typeof r.kind !== "number"
      || typeof r.content !== "string" || !Array.isArray(r.tags)) return { ok: false };
    // 4. The author is the seal's signer; a message or a thread reply; this room.
    if (r.pubkey !== seal.pubkey || !kinds.includes(r.kind)) return { ok: false };
    if (r.tags.find((t) => Array.isArray(t) && t[0] === "channel")?.[1] !== channelId) return { ok: false };
    // 5. Its identity, recomputed from what it says: an embedded id is never trusted.
    const rumor: PinnedRumor = { pubkey: r.pubkey, created_at: r.created_at, kind: r.kind, tags: r.tags, content: r.content };
    return { ok: true, rumor, id: getEventHash(rumor as never) };
  } catch {
    return { ok: false };
  }
}

// ── Reading a room's list ────────────────────────────────────────────────────
/** CORD-04 §7 caps: entries, and the bytes of the edition's content as carried. */
export const PIN_ENTRY_CAP = 25;
export const PIN_CONTENT_CAP = 32_768;

export type VerifiedPin = { entry: PinEntry; rumor: PinnedRumor; id: string };

/**
 * A room's pins as this device sees them. "unavailable" is not an empty list:
 * it is a list sealed under a key this device never held, or no list yet from a
 * fold that hasn't arrived. It shows as unavailable and is never written over.
 */
export type PinListView = { status: "ok"; pins: VerifiedPin[] } | { status: "unavailable" };

const EMPTY_LIST: PinListView = { status: "ok", pins: [] };

export function readPinList(
  content: string | undefined,
  channelId: string,
  opts: {
    /** The group's admin plane has arrived, so a missing list really is none. */
    foldLoaded: boolean;
    /** The room's conversation key at an epoch this device holds. */
    convKeyAt?: (epoch: number) => Uint8Array | undefined;
  },
): PinListView {
  if (content === undefined) return opts.foldLoaded ? EMPTY_LIST : { status: "unavailable" };
  // A list over a cap still folds and chains, but reads as empty: refusing the
  // edition would fork the chain between apps.
  if (new TextEncoder().encode(content).length > PIN_CONTENT_CAP) return EMPTY_LIST;
  let list: { entries?: unknown; epoch?: unknown; sealed?: unknown };
  try { list = JSON.parse(content); } catch { return EMPTY_LIST; }
  if (!list || typeof list !== "object") return EMPTY_LIST;
  if (typeof list.sealed === "string") {
    const epoch = Number(list.epoch);
    const key = Number.isInteger(epoch) && epoch >= 0 ? opts.convKeyAt?.(epoch) : undefined;
    if (!key) return { status: "unavailable" };
    try { list = JSON.parse(nip44v2.decrypt(list.sealed, key)); } catch { return { status: "unavailable" }; }
  }
  const entries = Array.isArray(list?.entries) ? list.entries : [];
  if (entries.length > PIN_ENTRY_CAP) return EMPTY_LIST;
  const pins: VerifiedPin[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const v = verifyPinEntry(entry as PinEntry, channelId);
    if (v.ok && !seen.has(v.id)) { seen.add(v.id); pins.push({ entry: entry as PinEntry, rumor: v.rumor, id: v.id }); }
  }
  return { status: "ok", pins };
}

// ── Writing a room's list ────────────────────────────────────────────────────
export type PinChange = { pin: PinEntry } | { unpin: string };
/** The form a room's list takes: plaintext for a public room, sealed for a private one. */
export type PinListForm = { private: false } | { private: true; epoch: number; convKey: Uint8Array };
export type PinWrite = { ok: true; content: string } | { ok: false; reason: "unavailable" | "full" | "too-big" };

/**
 * The next edition's content for a room's list, starting from the list as
 * read. A list this device can't read is never written over: it would drop
 * every pin it couldn't see. The caps refuse a pin up front, rather than
 * publish a list every reader then treats as empty. Entries are carried as
 * they are, including what another app added to them.
 */
export function nextPinList(view: PinListView, change: PinChange, form: PinListForm): PinWrite {
  if (view.status !== "ok") return { ok: false, reason: "unavailable" };
  let entries = view.pins.map((p) => p.entry);
  if ("pin" in change) {
    const already = view.pins.some((p) => p.entry.seal.id === change.pin.seal.id);
    if (!already) {
      if (entries.length >= PIN_ENTRY_CAP) return { ok: false, reason: "full" };
      entries = [...entries, change.pin];
    }
  } else {
    entries = view.pins.filter((p) => p.id !== change.unpin).map((p) => p.entry);
  }
  const body = JSON.stringify({ entries });
  const content = form.private
    ? JSON.stringify({ epoch: String(form.epoch), sealed: nip44v2.encrypt(body, form.convKey) })
    : body;
  if (new TextEncoder().encode(content).length > PIN_CONTENT_CAP) return { ok: false, reason: "too-big" };
  return { ok: true, content };
}

/**
 * Self-erasure outranks curation (CORD-04 §7): a pin whose message its own
 * author deleted is hidden at once, matched by the pin's recomputed id. A
 * delete from anyone else changes nothing.
 */
export function visiblePins(pins: VerifiedPin[], deletes: { pubkey: string; targetId: string }[]): VerifiedPin[] {
  return pins.filter((p) => !deletes.some((d) => d.targetId === p.id && d.pubkey === p.rumor.pubkey));
}
