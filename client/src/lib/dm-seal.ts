/**
 * Sealing what the private-message store keeps on this device.
 *
 * Opened messages used to sit in IndexedDB as readable text — including the
 * key of every encrypted file. Each row is now sealed with a key that belongs
 * to this device and this account (AES-GCM, generated here, never leaves the
 * browser and cannot be exported from it).
 *
 * What that buys, stated plainly: message text, senders, chat names and file
 * keys are no longer readable in the device's storage, in a copy of it, or in
 * a backup of it. What it does not buy: the key lives in the same browser
 * profile, so someone who can run this app as you can still read your chats.
 *
 * Left in the clear is only what the store looks rows up by — whose store it
 * is, which chat, the message id and its time. Those are bound into the seal,
 * so a sealed row cannot be moved to another chat or passed off as another
 * message.
 *
 * Pure: this file knows nothing about IndexedDB (lib/dm-cache.ts does).
 */

export interface SealedPart {
  v: 1;
  iv: Uint8Array;
  ct: ArrayBuffer;
}

export type SealedRow = Record<string, unknown> & { sealed: SealedPart };

/** The parts of a message that are sealed. Everything else is a lookup field. */
export const MESSAGE_SECRETS = ["content", "from", "encryption", "fileMetadata", "quotedNoteId", "replyTo", "reactsTo"] as const;
/** The lookup fields a sealed message is bound to. */
export const MESSAGE_BOUND = ["ownerPubkey", "peerPubkey", "id"] as const;

export const CONVERSATION_SECRETS = ["lastMessage", "subject", "subjectAt"] as const;
export const CONVERSATION_BOUND = ["ownerPubkey", "peerPubkey"] as const;

/** True where the browser can seal at all (it cannot on an insecure origin). */
export function canSeal(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

export function newDeviceKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function isSealedRow(row: unknown): row is SealedRow {
  const s = (row as { sealed?: SealedPart } | null)?.sealed;
  return !!s && s.v === 1 && !!s.iv && !!s.ct;
}

function bound(row: Record<string, unknown>, fields: readonly string[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(fields.map((f) => String(row[f] ?? ""))));
}

/** The row as it is stored: the secret fields replaced by one sealed part. */
export async function sealRow<T extends object>(
  key: CryptoKey,
  row: T,
  secrets: readonly string[],
  boundTo: readonly string[],
): Promise<SealedRow> {
  const all = row as Record<string, unknown>;
  const clear: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) {
    if (v === undefined || k === "sealed") continue;
    if (secrets.includes(k)) secret[k] = v; else clear[k] = v;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: bound(all, boundTo) },
    key,
    new TextEncoder().encode(JSON.stringify(secret)),
  );
  return { ...clear, sealed: { v: 1, iv, ct } };
}

/**
 * The row as it was before sealing. A row stored before sealing existed is
 * returned as it is. Null when the seal does not open: another key, an altered
 * row, or a row moved from where it was sealed.
 */
export async function openRow<T extends object>(
  key: CryptoKey,
  stored: unknown,
  boundTo: readonly string[],
): Promise<T | null> {
  if (!stored || typeof stored !== "object") return null;
  if (!isSealedRow(stored)) return stored as T;
  const { sealed, ...clear } = stored;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv, additionalData: bound(clear, boundTo) },
      key,
      sealed.ct,
    );
    return { ...clear, ...JSON.parse(new TextDecoder().decode(plain)) } as T;
  } catch {
    return null;
  }
}
