/**
 * What the feedback inbox has already opened.
 *
 * Private feedback travels in the same gift wraps as private messages, and
 * the inbox opened EVERY wrap addressed to the reader on every load — up to
 * 300 of them, two signer decrypts each — to find the few that were feedback.
 * For someone with a remote signer that was hundreds of prompts a load, and
 * it defeated the private messages' own decrypt-once record.
 *
 * This is the inbox's own record: which wraps it has examined (never again),
 * and the feedback it found in them (shown again without opening anything).
 * Pure; reading and writing it is at the bottom.
 */
import type { UnwrappedRumor } from "./dm";

export interface FeedbackLedger {
  /** Wrap ids examined, oldest first. */
  seen: string[];
  /** The feedback rumors found, oldest first. */
  rumors: UnwrappedRumor[];
}

export const SEEN_CAP = 2000;
export const RUMOR_CAP = 200;

export function emptyLedger(): FeedbackLedger {
  return { seen: [], rumors: [] };
}

export function isSeenWrap(ledger: FeedbackLedger, wrapId: string): boolean {
  return ledger.seen.includes(wrapId);
}

/** The ledger after a wrap was opened: seen, and its feedback kept if it held any. */
export function recordWrap(ledger: FeedbackLedger, wrapId: string, rumor: UnwrappedRumor | null): FeedbackLedger {
  if (isSeenWrap(ledger, wrapId)) return ledger;
  const seen = [...ledger.seen, wrapId].slice(-SEEN_CAP);
  const rumors = rumor && !ledger.rumors.some((r) => r.id === rumor.id)
    ? [...ledger.rumors, rumor].sort((a, b) => a.created_at - b.created_at).slice(-RUMOR_CAP)
    : ledger.rumors;
  return { seen, rumors };
}

function validRumor(r: unknown): r is UnwrappedRumor {
  const x = r as Partial<UnwrappedRumor> | null;
  return !!x && typeof x.id === "string" && typeof x.pubkey === "string" && typeof x.kind === "number"
    && Array.isArray(x.tags) && typeof x.content === "string" && typeof x.created_at === "number";
}

export function parseLedger(raw: string | null | undefined): FeedbackLedger {
  if (!raw) return emptyLedger();
  try {
    const p = JSON.parse(raw) as Partial<FeedbackLedger>;
    if (!Array.isArray(p.seen) || !Array.isArray(p.rumors)) return emptyLedger();
    if (!p.seen.every((s) => typeof s === "string") || !p.rumors.every(validRumor)) return emptyLedger();
    return { seen: p.seen, rumors: p.rumors };
  } catch {
    return emptyLedger();
  }
}

/**
 * One reader per screen that shows feedback (four screens do), all sharing
 * one opening per wrap: a wrap being opened by one is awaited by the others,
 * and a wrap already in the ledger is opened by none.
 */
export interface FeedbackReader {
  /** What was found before, delivered at once. */
  prime(): void;
  /** A wrap from a relay. */
  onWrap(wrap: { id: string }): Promise<void>;
}

// Openings in flight, shared by every reader on the page (one per wrap id).
const opening = new Map<string, Promise<UnwrappedRumor | null>>();

export function feedbackReader(deps: {
  read: () => FeedbackLedger;
  write: (ledger: FeedbackLedger) => void;
  unwrap: (wrap: never) => Promise<UnwrappedRumor | null>;
  isFeedback: (rumor: UnwrappedRumor) => boolean;
  onUpdate: (rumors: UnwrappedRumor[]) => void;
}): FeedbackReader {
  const found = new Map<string, UnwrappedRumor>();
  const deliver = () => deps.onUpdate(Array.from(found.values()));
  return {
    prime() {
      for (const r of deps.read().rumors) found.set(r.id, r);
      if (found.size > 0) deliver();
    },
    async onWrap(wrap) {
      if (isSeenWrap(deps.read(), wrap.id)) return;
      let task = opening.get(wrap.id);
      if (!task) {
        task = deps.unwrap(wrap as never);
        opening.set(wrap.id, task);
      }
      let rumor: UnwrappedRumor | null;
      try {
        rumor = await task;
      } catch {
        // Not opened (a signer that timed out): not recorded, tried again next time.
        opening.delete(wrap.id);
        return;
      }
      opening.delete(wrap.id);
      const keep = rumor && deps.isFeedback(rumor) ? rumor : null;
      // Re-read: another reader may have written since this one started.
      deps.write(recordWrap(deps.read(), wrap.id, keep));
      if (keep && !found.has(keep.id)) {
        found.set(keep.id, keep);
        deliver();
      }
    },
  };
}

/* ---- kept on this device, per account ---- */

const KEY = (pubkey: string) => `ro_feedback_wraps_v1_${pubkey}`;

export function readFeedbackLedger(pubkey: string): FeedbackLedger {
  try { return parseLedger(localStorage.getItem(KEY(pubkey))); } catch { return emptyLedger(); }
}

export function writeFeedbackLedger(pubkey: string, ledger: FeedbackLedger): void {
  try { localStorage.setItem(KEY(pubkey), JSON.stringify(ledger)); } catch { /* storage full or blocked: this visit only */ }
}
