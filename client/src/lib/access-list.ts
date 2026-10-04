/**
 * Who's on a relay's allow or ban list, one entry per person.
 *
 * relay.tools (relaycreator) stores a new row every time someone is allowed —
 * it doesn't check whether they're on the list already — and lists every
 * row; removing a person deletes all their rows at once. So a list that was
 * built twice shows everyone twice. We read it per person, and count the
 * extra copies so the operator can tidy them up.
 *
 * Pure.
 */
import { nip19 } from "nostr-tools";

export interface AccessList {
  /** Each person once, in the order the relay first listed them (lowercase hex). */
  pubkeys: string[];
  /** People the relay holds more than one row for: pubkey → rows. */
  copies: Record<string, number>;
  /** Rows beyond one per person. */
  extraRows: number;
  /** The first reason the relay gives for each person, when it gives one. */
  reasons: Record<string, string>;
}

const HEX = /^[0-9a-f]{64}$/i;

export function readAccessList(raw: unknown[]): AccessList {
  const rows = new Map<string, number>();
  const reasons: Record<string, string> = {};
  for (const e of raw) {
    const pk = typeof e === "string" ? e : (e as { pubkey?: unknown } | null)?.pubkey;
    if (typeof pk !== "string" || !HEX.test(pk)) continue;
    const k = pk.toLowerCase();
    rows.set(k, (rows.get(k) ?? 0) + 1);
    const why = typeof e === "object" && e ? (e as { reason?: unknown }).reason : undefined;
    if (typeof why === "string" && why && !(k in reasons)) reasons[k] = why;
  }
  const copies: Record<string, number> = {};
  let extraRows = 0;
  for (const [k, n] of rows) if (n > 1) { copies[k] = n; extraRows += n - 1; }
  return { pubkeys: [...rows.keys()], copies, extraRows, reasons };
}

/**
 * Of these people, the ones not on the list yet — so building from the web
 * of trust (or importing) a second time doesn't make the relay store copies.
 */
export function notYetOn(candidates: readonly string[], alreadyOn: readonly string[]): string[] {
  const on = new Set(alreadyOn.map((p) => p.toLowerCase()));
  const out: string[] = [];
  for (const c of candidates) {
    const k = c.toLowerCase();
    if (!HEX.test(k) || on.has(k)) continue;
    on.add(k);
    out.push(k);
  }
  return out;
}

const KEY_TOKEN = /\b(npub1[02-9ac-hj-np-z]{58}|nprofile1[02-9ac-hj-np-z]+|[0-9a-f]{64})\b/i;

function keyFrom(token: string): string | null {
  if (HEX.test(token)) return token.toLowerCase();
  try {
    const d = nip19.decode(token);
    if (d.type === "npub") return (d.data as string).toLowerCase();
    if (d.type === "nprofile") return (d.data as { pubkey: string }).pubkey.toLowerCase();
  } catch { /* not a key */ }
  return null;
}

/**
 * What an imported file would add, before anything is sent: one person per
 * line (npub, nprofile or hex, anywhere on the line — so a CSV export works),
 * minus anyone already on the list or repeated in the file. Blank lines and a
 * header row aren't counted as unreadable; other lines without a key are.
 */
export function readImportFile(text: string, alreadyOn: readonly string[]): { add: string[]; already: number; unreadable: number } {
  const on = new Set(alreadyOn.map((p) => p.toLowerCase()));
  const seen = new Set<string>();
  const add: string[] = [];
  let already = 0;
  let unreadable = 0;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(KEY_TOKEN);
    const key = m ? keyFrom(m[1]) : null;
    if (!key) {
      if (i === 0 && /npub|pubkey|name/i.test(line)) return; // a CSV header
      unreadable++;
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    if (on.has(key)) already++;
    else add.push(key);
  });
  return { add, already, unreadable };
}
