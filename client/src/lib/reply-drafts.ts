/**
 * Half-typed replies, kept when the box closes (owner, 2026-10-04).
 *
 * One draft per post or comment you were answering, on this device, for your
 * account only, for a week. The text keeps the people you tagged and the
 * custom emoji you used, so a restored "@Carol" still tags Carol when it's
 * sent. Sending clears it; emptying the box clears it.
 *
 * Storage is a convenience here, never a dependency: blocked or garbled
 * storage means "no draft", and the box works as before.
 */

export interface DraftMention {
  id: number;
  pubkey: string;
  displayName: string;
  token: string;
}

export interface ReplyDraft {
  text: string;
  mentions: DraftMention[];
  /** [shortcode, url] for custom emoji used in the text. */
  emojis: [string, string][];
  gifUrl: string | null;
  savedAt: number;
}

export const REPLY_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_REPLY_DRAFTS = 30;

interface Opts { storage?: Storage; now?: number }

const keyFor = (pubkey: string) => `ro_reply_drafts:${pubkey}`;

function defaultStorage(): Storage | undefined {
  try { return typeof localStorage === "undefined" ? undefined : localStorage; } catch { return undefined; }
}

function isDraft(d: unknown): d is ReplyDraft {
  if (!d || typeof d !== "object") return false;
  const x = d as Record<string, unknown>;
  return typeof x.text === "string" && Array.isArray(x.mentions) && Array.isArray(x.emojis)
    && (x.gifUrl === null || typeof x.gifUrl === "string") && typeof x.savedAt === "number";
}

function readAll(pubkey: string, storage: Storage | undefined): Record<string, ReplyDraft> {
  try {
    const raw = storage?.getItem(keyFor(pubkey));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, ReplyDraft> = {};
    for (const [id, d] of Object.entries(parsed as Record<string, unknown>)) if (isDraft(d)) out[id] = d;
    return out;
  } catch {
    return {};
  }
}

function writeAll(pubkey: string, all: Record<string, ReplyDraft>, storage: Storage | undefined): void {
  try {
    if (!storage) return;
    if (Object.keys(all).length === 0) storage.removeItem(keyFor(pubkey));
    else storage.setItem(keyFor(pubkey), JSON.stringify(all));
  } catch {}
}

export function readReplyDraft(pubkey: string, targetId: string, opts: Opts = {}): ReplyDraft | null {
  const now = opts.now ?? Date.now();
  const d = readAll(pubkey, opts.storage ?? defaultStorage())[targetId];
  if (!d || now - d.savedAt > REPLY_DRAFT_TTL_MS) return null;
  return d;
}

export function saveReplyDraft(pubkey: string, targetId: string, draft: Omit<ReplyDraft, "savedAt">, opts: Opts = {}): void {
  const storage = opts.storage ?? defaultStorage();
  const now = opts.now ?? Date.now();
  if (!draft.text.trim() && !draft.gifUrl) { clearReplyDraft(pubkey, targetId, opts); return; }
  const all = readAll(pubkey, storage);
  all[targetId] = { ...draft, savedAt: now };
  // Forget old drafts, then keep only the most recent.
  const kept = Object.entries(all)
    .filter(([, d]) => now - d.savedAt <= REPLY_DRAFT_TTL_MS)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, MAX_REPLY_DRAFTS);
  writeAll(pubkey, Object.fromEntries(kept), storage);
}

export function clearReplyDraft(pubkey: string, targetId: string, opts: Opts = {}): void {
  const storage = opts.storage ?? defaultStorage();
  const all = readAll(pubkey, storage);
  if (!(targetId in all)) return;
  delete all[targetId];
  writeAll(pubkey, all, storage);
}
