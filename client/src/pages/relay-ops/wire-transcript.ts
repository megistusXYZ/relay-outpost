/**
 * What a relay said, as a readable timeline (the console's Transcript).
 *
 * The console talks to each relay on its own socket and records every frame
 * it sends and receives, with the time. Most apps (and nostr-tools' pool)
 * collapse those into "results or nothing"; here a refusal, a sign-in request,
 * a notice and an unreachable relay each get their own line in plain words,
 * with the relay's own reason, and timings worth reading.
 *
 * Pure: frames in, lines out.
 */
import { plainKindName } from "@/lib/kind-catalog";

/** `at` is wall-clock milliseconds (Date.now()). */
export type WireFrame =
  | { relay: string; at: number; dir: "out" | "in"; msg: unknown[] }
  | { relay: string; at: number; dir: "conn"; state: "connecting" | "open" | "error" | "closed"; detail?: string };

export type LineKind =
  | "connected" | "unreachable" | "disconnected"
  | "asked" | "events" | "end" | "live" | "stopped"
  | "refused" | "closed" | "notice"
  | "auth-asked" | "auth-sent" | "signed-in" | "sign-in-refused"
  | "count" | "sent" | "accepted" | "rejected";

export interface TranscriptLine {
  relay: string;
  at: number;
  what: LineKind;
  text: string;
  tone: "plain" | "good" | "warn" | "bad";
  /** The subscription it belongs to, when it belongs to one. */
  sub?: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const ms = (n: number) => `${Math.max(0, Math.round(n))} ms`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "auth-required: you must auth" → "you must auth" */
export const relayWords = (reason: string) => reason.replace(/^[a-z-]+:\s*/i, "").trim();

function kindsPlural(kinds: number[]): string {
  const names = kinds.map((k) => {
    const n = plainKindName(k);
    return /^Kind \d/.test(n) || /s$/.test(n) ? n : `${n}s`;
  });
  if (names.length > 4) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more kinds`;
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function ago(sec: number, nowSec: number): string {
  const d = nowSec - sec;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  // Hours up to two days: "since 24 h ago" reads truer than "since 1 d ago".
  if (d < 2 * 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
}

/** A filter, in words: "Notes and Reactions · from 2 people · since 3 h ago · up to 50". */
export function describeFilter(f: Record<string, unknown>, nowSec: number): string {
  const arr = (k: string) => (Array.isArray(f[k]) ? (f[k] as unknown[]) : []);
  const parts: string[] = [];
  const ids = arr("ids");
  if (ids.length) parts.push(plural(ids.length, "event by id", "events by id"));
  else {
    const what = [arr("kinds").length ? kindsPlural(arr("kinds") as number[]) : "", arr("#t").map((t) => `#${t}`).join(" ")].filter(Boolean).join(" ");
    parts.push(what || "anything");
  }
  if (typeof f.search === "string" && f.search) parts.push(`matching “${f.search}”`);
  if (arr("authors").length) parts.push(`from ${plural(arr("authors").length, "person", "people")}`);
  if (arr("#p").length) parts.push(`mentioning ${plural(arr("#p").length, "person", "people")}`);
  if (arr("#e").length) parts.push(`about ${plural(arr("#e").length, "post", "posts")}`);
  for (const k of Object.keys(f)) if (/^#.$/.test(k) && !["#t", "#p", "#e"].includes(k)) parts.push(`with ${k} ${arr(k).join(", ")}`);
  if (typeof f.since === "number") parts.push(`since ${ago(f.since, nowSec)}`);
  if (typeof f.until === "number") parts.push(`until ${ago(f.until, nowSec)}`);
  if (typeof f.limit === "number") parts.push(`up to ${fmt(f.limit)}`);
  return parts.join(" · ");
}

function refusal(reason: string): { what: LineKind; text: string; tone: TranscriptLine["tone"] } {
  const words = relayWords(reason);
  if (!reason.trim()) return { what: "closed", text: "Closed the query", tone: "plain" };
  if (/^auth-required/i.test(reason)) return { what: "refused", text: `Wants you to sign in first — “${words}”`, tone: "warn" };
  if (/^(restricted|blocked)/i.test(reason)) return { what: "refused", text: `Refused — “${words}”`, tone: "bad" };
  return { what: "closed", text: `Closed the query — “${words}”`, tone: "bad" };
}

export function transcript(frames: WireFrame[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  // Per relay+sub: when it was asked, what it's done since.
  const subs = new Map<string, { askedAt?: number; ended: boolean; stored: number; group?: TranscriptLine; groupN: number }>();
  const connectingAt = new Map<string, number>();
  const authIds = new Set<string>();
  const sub = (relay: string, id: string) => {
    const k = `${relay}\u0000${id}`;
    let s = subs.get(k);
    if (!s) { s = { ended: false, stored: 0, groupN: 0 }; subs.set(k, s); }
    return s;
  };
  const push = (l: TranscriptLine) => { out.push(l); return l; };

  for (const f of frames) {
    const base = { relay: f.relay, at: f.at };
    if (f.dir === "conn") {
      if (f.state === "connecting") connectingAt.set(f.relay, f.at);
      else if (f.state === "open") {
        const t0 = connectingAt.get(f.relay);
        push({ ...base, what: "connected", text: t0 === undefined ? "Connected" : `Connected in ${ms(f.at - t0)}`, tone: "plain" });
      } else if (f.state === "error") push({ ...base, what: "unreachable", text: `Couldn't connect${f.detail ? ` — ${f.detail}` : ""}`, tone: "bad" });
      else push({ ...base, what: "disconnected", text: `Disconnected${f.detail ? ` — ${f.detail}` : ""}`, tone: "plain" });
      continue;
    }
    const [verb, ...rest] = f.msg as [string, ...unknown[]];
    if (f.dir === "out") {
      if (verb === "REQ" || verb === "COUNT") {
        const id = String(rest[0]);
        const s = sub(f.relay, id);
        s.askedAt = f.at; s.ended = false; s.stored = 0; s.group = undefined; s.groupN = 0;
        const filters = rest.slice(1) as Record<string, unknown>[];
        const words = filters.map((x) => describeFilter(x ?? {}, f.at / 1000)).join("; or ");
        push({ ...base, sub: id, what: "asked", text: verb === "REQ" ? `Asked for ${words}` : `Asked to count ${words}`, tone: "plain" });
      } else if (verb === "CLOSE") {
        push({ ...base, sub: String(rest[0]), what: "stopped", text: "Stopped", tone: "plain" });
      } else if (verb === "AUTH") {
        const id = (rest[0] as { id?: string } | undefined)?.id;
        if (id) authIds.add(id);
        push({ ...base, what: "auth-sent", text: "Sent your sign-in", tone: "plain" });
      } else if (verb === "EVENT") {
        const k = (rest[0] as { kind?: number } | undefined)?.kind;
        push({ ...base, what: "sent", text: `Sent ${typeof k === "number" ? `a ${plainKindName(k).toLowerCase()}` : "an event"}`, tone: "plain" });
      }
      continue;
    }
    // Incoming
    if (verb === "EVENT") {
      const id = String(rest[0]);
      const s = sub(f.relay, id);
      s.groupN++;
      if (!s.ended) s.stored++;
      const text = s.ended
        ? `${s.groupN} new as ${s.groupN === 1 ? "it" : "they"} arrived`
        : `${plural(s.groupN, "event", "events")}${s.askedAt !== undefined ? ` · first after ${ms((s.group?.at ?? f.at) - s.askedAt)}` : ""}`;
      if (s.group) s.group.text = text;
      else s.group = push({ ...base, sub: id, what: s.ended ? "live" : "events", text, tone: "plain" });
    } else if (verb === "EOSE") {
      const id = String(rest[0]);
      const s = sub(f.relay, id);
      s.ended = true; s.group = undefined; s.groupN = 0;
      push({ ...base, sub: id, what: "end", text: `End of stored events · ${fmt(s.stored)}${s.askedAt !== undefined ? ` in ${ms(f.at - s.askedAt)}` : ""}`, tone: "good" });
    } else if (verb === "CLOSED") {
      const id = String(rest[0]);
      sub(f.relay, id).group = undefined;
      push({ ...base, sub: id, ...refusal(String(rest[1] ?? "")) });
    } else if (verb === "NOTICE") {
      push({ ...base, what: "notice", text: `Notice — “${String(rest[0] ?? "")}”`, tone: "warn" });
    } else if (verb === "AUTH") {
      push({ ...base, what: "auth-asked", text: "Asks you to sign in", tone: "warn" });
    } else if (verb === "OK") {
      const [id, ok, message] = rest as [string, boolean, string?];
      const why = relayWords(String(message ?? ""));
      if (authIds.has(id)) push({ ...base, what: ok ? "signed-in" : "sign-in-refused", text: ok ? "Signed in" : `Sign-in turned down${why ? ` — “${why}”` : ""}`, tone: ok ? "good" : "bad" });
      else push({ ...base, what: ok ? "accepted" : "rejected", text: ok ? "Accepted" : `Rejected${why ? ` — “${why}”` : ""}`, tone: ok ? "good" : "bad" });
    } else if (verb === "COUNT") {
      const id = String(rest[0]);
      const body = (rest[1] ?? {}) as { count?: number; approximate?: boolean };
      const s = sub(f.relay, id);
      push({ ...base, sub: id, what: "count", text: `${body.approximate ? "About" : "Exactly"} ${fmt(body.count ?? 0)}${s.askedAt !== undefined ? ` · in ${ms(f.at - s.askedAt)}` : ""}`, tone: "good" });
    }
  }
  return out;
}

export interface RelayOutcome {
  status: "answered" | "refused" | "unreached" | "waiting";
  events: number;
  /** Time from asking to the end of stored events. */
  endMs?: number;
  /** The relay's own words, when it refused. */
  reason?: string;
}

/** How each relay did with the query: answered, refused, never reached, or still going. */
export function relayOutcomes(frames: WireFrame[]): Map<string, RelayOutcome> {
  const acc = new Map<string, { opened: boolean; failed: boolean; askedAt?: number; endAt?: number; refused?: string; events: number }>();
  const get = (r: string) => { let a = acc.get(r); if (!a) { a = { opened: false, failed: false, events: 0 }; acc.set(r, a); } return a; };
  for (const f of frames) {
    const a = get(f.relay);
    if (f.dir === "conn") {
      if (f.state === "open") a.opened = true;
      if (f.state === "error" && !a.opened) a.failed = true;
      continue;
    }
    const [verb, , third] = f.msg as [string, unknown, unknown];
    if (f.dir === "out" && verb === "REQ" && a.askedAt === undefined) a.askedAt = f.at;
    if (f.dir !== "in") continue;
    if (verb === "EVENT") a.events++;
    else if (verb === "EOSE" && a.endAt === undefined) a.endAt = f.at;
    else if (verb === "CLOSED" && a.endAt === undefined && /^(auth-required|restricted|blocked)/i.test(String(third ?? ""))) a.refused = String(third);
  }
  const out = new Map<string, RelayOutcome>();
  for (const [relay, a] of acc) {
    if (a.endAt !== undefined) out.set(relay, { status: "answered", events: a.events, endMs: a.askedAt !== undefined ? a.endAt - a.askedAt : undefined });
    else if (a.refused) out.set(relay, { status: "refused", events: a.events, reason: a.refused });
    else if (a.failed) out.set(relay, { status: "unreached", events: a.events });
    else out.set(relay, { status: "waiting", events: a.events });
  }
  return out;
}

export interface CompareRow { relay: string; total: number; onlyHere: number; missing: number }

/** The same query on several relays: what each has that no other does, and what it lacks. */
export function compareRelays(idsByRelay: Record<string, string[]>): CompareRow[] {
  const sets = Object.entries(idsByRelay).map(([relay, ids]) => [relay, new Set(ids)] as const);
  const union = new Set(sets.flatMap(([, s]) => [...s]));
  return sets.map(([relay, s]) => ({
    relay,
    total: s.size,
    onlyHere: [...s].filter((id) => sets.every(([r, o]) => r === relay || !o.has(id))).length,
    missing: union.size - s.size,
  }));
}
