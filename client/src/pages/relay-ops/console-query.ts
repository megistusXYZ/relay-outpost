/**
 * The console's query, from what was typed to what goes on the wire.
 *
 * People type times the way they think of them ("now-3h", "2d", a date) and
 * paste the codes they have (npub, note, nevent) where a relay wants hex. The
 * typed text is what's kept — in history and share links — so "the last
 * 3 hours" stays relative; it's resolved only when the query runs.
 *
 * Pure.
 */
import { nip19 } from "nostr-tools";

const UNIT: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
  w: 604800, wk: 604800, week: 604800, weeks: 604800,
};

/** A time as typed → unix seconds, or null when it isn't one. */
export function resolveWhen(value: unknown, nowSec: number): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.floor(value) : null;
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  if (!t) return null;
  if (t === "now") return nowSec;
  if (/^\d{9,11}$/.test(t)) return Number(t);
  const rel = /^(?:now\s*-\s*|-\s*)?(\d+(?:\.\d+)?)\s*([a-z]+)(?:\s+ago)?$/.exec(t);
  if (rel && UNIT[rel[2]]) return Math.floor(nowSec - Number(rel[1]) * UNIT[rel[2]]);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const ms = Date.parse(value.trim());
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

const HEX64 = /^[0-9a-f]{64}$/i;

/** A key or code → hex: npub/nprofile for people, note/nevent for events. */
function toHex(v: unknown, want: "person" | "event"): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^nostr:/i, "");
  if (HEX64.test(s)) return s.toLowerCase();
  try {
    const d = nip19.decode(s);
    if (want === "person" && d.type === "npub") return d.data;
    if (want === "person" && d.type === "nprofile") return d.data.pubkey;
    if (want === "event" && d.type === "note") return d.data;
    if (want === "event" && d.type === "nevent") return d.data.id;
  } catch { /* not a code */ }
  return null;
}

export type Resolved = { ok: true; filters: Record<string, unknown>[] } | { ok: false; error: string };

const FIELDS = new Set(["ids", "authors", "kinds", "since", "until", "limit", "search"]);

function resolveOne(raw: Record<string, unknown>, nowSec: number): Resolved {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "kinds") {
      if (!Array.isArray(v) || !v.every((x) => Number.isInteger(x) && x >= 0)) return { ok: false, error: "kinds must be numbers" };
      out.kinds = v;
    } else if (k === "authors" || k === "ids" || k === "#p" || k === "#e") {
      if (!Array.isArray(v)) return { ok: false, error: `${k} must be a list` };
      const want = k === "authors" || k === "#p" ? "person" : "event";
      const hex: string[] = [];
      for (const x of v) {
        const h = toHex(x, want);
        if (!h) return { ok: false, error: `“${String(x)}” in ${k} isn't a ${want === "person" ? "key or npub" : "event id or note code"}` };
        hex.push(h);
      }
      out[k] = hex;
    } else if (k === "since" || k === "until") {
      const t = resolveWhen(v, nowSec);
      if (t === null) return { ok: false, error: `“${String(v)}” isn't a time — try now-3h, 2d or a date` };
      out[k] = t;
    } else if (k === "limit") {
      if (!Number.isInteger(v) || (v as number) < 0) return { ok: false, error: "limit must be a whole number" };
      out.limit = v;
    } else if (k === "search") {
      if (typeof v !== "string") return { ok: false, error: "search must be words" };
      out.search = v;
    } else if (/^#[a-zA-Z]$/.test(k)) {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return { ok: false, error: `${k} must be a list of words` };
      out[k] = v;
    } else if (!FIELDS.has(k)) {
      return { ok: false, error: `“${k}” isn't a filter field` };
    }
  }
  return { ok: true, filters: [out] };
}

/** The JSON as typed (one filter, or a list) → the filters to send. */
export function resolveFilters(text: string, nowSec: number): Resolved {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ok: false, error: "That isn't valid JSON" }; }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.length) return { ok: false, error: "Add at least one filter" };
  const filters: Record<string, unknown>[] = [];
  for (const f of list) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return { ok: false, error: "A filter is an object, like {\"kinds\":[1]}" };
    const r = resolveOne(f as Record<string, unknown>, nowSec);
    if (!r.ok) return r;
    filters.push(...r.filters);
  }
  return { ok: true, filters };
}

/** A link that reopens this query: every relay, and the filter exactly as typed. */
export function consoleLink(relays: string[], filterText: string): string {
  const p = new URLSearchParams();
  for (const r of relays) p.append("relay", r);
  p.set("filter", filterText);
  return `/my-relays/console?${p.toString()}`;
}
