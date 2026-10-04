/**
 * Saved replies — one-tap answers an operator reuses in the Inbox ("Thanks —
 * we're looking into it."). One replaceable app-data event per person
 * (kind 30078, d = relay-outpost:saved-replies), its content encrypted to
 * yourself, so the list follows you to any device and no one else reads it.
 *
 * Saving is only allowed after the list has been read (useSavedReplies):
 * publishing before that would replace a list we never saw.
 */
import type { Event as NostrEvent } from "nostr-tools";

export interface SavedReply { id: string; text: string }

export const SAVED_REPLIES_D = "relay-outpost:saved-replies";
export const SAVED_REPLIES_KIND = 30078;

export const STARTER_REPLIES: SavedReply[] = [
  { id: "looking", text: "Thanks — we're looking into it." },
  { id: "fixed", text: "Fixed in the latest update. Let us know if you still see it." },
  { id: "device", text: "Could you tell us which device and browser you're using?" },
  { id: "idea", text: "Thanks for the idea — we've added it to our list." },
];

/** The decrypted content → the list; nothing saved (or unreadable) → the starters. */
export function parseSavedReplies(plain: string | null): SavedReply[] {
  if (plain === null) return STARTER_REPLIES;
  try {
    const v = JSON.parse(plain) as { v?: number; replies?: unknown };
    if (!Array.isArray(v.replies)) return STARTER_REPLIES;
    return v.replies.filter((r): r is SavedReply => !!r && typeof (r as SavedReply).id === "string" && typeof (r as SavedReply).text === "string");
  } catch {
    return STARTER_REPLIES;
  }
}

/** The list → the content to encrypt. Blank replies are dropped. */
export function savedRepliesText(list: SavedReply[]): string {
  return JSON.stringify({ v: 1, replies: list.map((r) => ({ id: r.id, text: r.text.trim() })).filter((r) => r.text) });
}

type Signer = {
  signEvent: (e: unknown) => Promise<NostrEvent>;
  nip44?: { encrypt: (pk: string, t: string) => Promise<string>; decrypt: (pk: string, c: string) => Promise<string> };
};

/** Read your saved replies; `found: false` means none saved yet (starters shown). */
export async function loadSavedReplies(signer: Signer, me: string, relays: string[]): Promise<{ replies: SavedReply[]; found: boolean }> {
  const { pool } = await import("./nostr");
  const events = await pool.querySync(relays, { kinds: [SAVED_REPLIES_KIND], authors: [me], "#d": [SAVED_REPLIES_D] }, { maxWait: 4000 } as never);
  const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
  if (!latest || !signer.nip44) return { replies: STARTER_REPLIES, found: !!latest };
  try {
    return { replies: parseSavedReplies(await signer.nip44.decrypt(me, latest.content)), found: true };
  } catch {
    return { replies: STARTER_REPLIES, found: true };
  }
}

export async function saveSavedReplies(signer: Signer, me: string, relays: string[], list: SavedReply[]): Promise<void> {
  if (!signer.nip44) throw new Error("Your signer can't encrypt, so saved replies can't be kept privately.");
  const content = await signer.nip44.encrypt(me, savedRepliesText(list));
  const signed = await signer.signEvent({ kind: SAVED_REPLIES_KIND, created_at: Math.floor(Date.now() / 1000), tags: [["d", SAVED_REPLIES_D]], content });
  const { publishEvent } = await import("./nostr");
  await publishEvent(signed, relays, undefined, true);
}
