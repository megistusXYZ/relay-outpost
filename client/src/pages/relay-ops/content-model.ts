/**
 * Relays › Content: what an operator sees and does with what's on their relay.
 *
 * Pure — the list, the detail pane and the action bar read this; nothing here
 * talks to a relay. The rules it holds (owner, 2026-10-03):
 *   - a row says what something IS in one line, never a private message's
 *     contents (those are counted, never read);
 *   - a reason is optional for one removal, required for many or for a rule;
 *   - a rule, or more than 25 at once, needs the count typed back;
 *   - the list says honestly how much of the relay it searched.
 */
import { nip19 } from "nostr-tools";
import type { EventQuery, TimeWindow } from "./event-query";
import { sinceFor } from "./event-query";

export interface ContentEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
  sig?: string;
}

export type TypeViewId =
  | "all" | "notes" | "articles" | "media" | "reactions" | "thanks" | "reposts" | "private" | "lists" | "profiles" | "other";

const LIST_KINDS = [3, 10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10009, 10015, 10030, 10050, 30000, 30001, 30002, 30003, 30004, 30005];

export const TYPE_VIEWS: ReadonlyArray<{ id: TypeViewId; label: string; word: string; kinds?: number[] }> = [
  { id: "all", label: "All", word: "Post" },
  { id: "notes", label: "Notes", word: "Note", kinds: [1, 1111] },
  { id: "articles", label: "Articles", word: "Article", kinds: [30023] },
  { id: "media", label: "Media", word: "Media", kinds: [20, 21, 22, 1063, 34235, 34236] },
  { id: "reactions", label: "Reactions", word: "Reaction", kinds: [7] },
  { id: "thanks", label: "Thanks", word: "Thanks", kinds: [9735] },
  { id: "reposts", label: "Reposts", word: "Repost", kinds: [6, 16] },
  { id: "private", label: "Private messages", word: "Private message", kinds: [4, 13, 14, 1059, 1060] },
  { id: "lists", label: "Lists", word: "List", kinds: LIST_KINDS },
  { id: "profiles", label: "Profiles", word: "Profile", kinds: [0] },
  { id: "other", label: "Other", word: "Other" },
];

const KIND_TO_VIEW = new Map<number, TypeViewId>();
for (const v of TYPE_VIEWS) for (const k of v.kinds ?? []) KIND_TO_VIEW.set(k, v.id);

export function typeOf(kind: number): TypeViewId {
  return KIND_TO_VIEW.get(kind) ?? "other";
}

export function isPrivateKind(kind: number): boolean {
  return typeOf(kind) === "private";
}

/** The kinds to ask the relay for, or undefined for every kind. */
export function viewKinds(id: TypeViewId): number[] | undefined {
  return TYPE_VIEWS.find((v) => v.id === id)?.kinds;
}

export function typeWord(kind: number): string {
  return TYPE_VIEWS.find((v) => v.id === typeOf(kind))?.word ?? "Other";
}

export function countByType(events: readonly ContentEvent[]): Record<TypeViewId, number> {
  const c = Object.fromEntries(TYPE_VIEWS.map((v) => [v.id, 0])) as Record<TypeViewId, number>;
  for (const e of events) { c.all++; c[typeOf(e.kind)]++; }
  return c;
}

/**
 * Content that is ciphertext, not words: NIP-04 ("…?iv=…") or a NIP-44
 * payload (one long unbroken base64 run). Shown as "Encrypted content" —
 * gibberish in a row reads like a broken app.
 */
export function looksEncrypted(content: string): boolean {
  const c = content.trim();
  if (/^[A-Za-z0-9+/=]+\?iv=[A-Za-z0-9+/=]+$/.test(c)) return true;
  return c.length >= 60 && !/\s/.test(c) && /^[A-Za-z0-9+/]+={0,2}$/.test(c);
}

const tag = (e: ContentEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1];
const firstLine = (s: string) => s.trim().split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";

export interface PreviewContext {
  /** A person's display name, when we know it. */
  nameOf?: (pubkey: string) => string | undefined;
  /** The post a reaction or repost is about, when it's loaded. */
  targetOf?: (id: string) => ContentEvent | undefined;
}

const MEDIA: Array<[RegExp, string]> = [
  [/\.gif(\?|#|$)/i, "GIF"],
  [/\.(jpe?g|png|webp|avif|heic|bmp|svg)(\?|#|$)/i, "Photo"],
  [/\.(mp4|mov|webm|m4v|m3u8)(\?|#|$)/i, "Video"],
];

/**
 * Words a person reads: mentions become @names, quoted posts and media are
 * named instead of shown as codes and addresses.
 */
function readable(text: string, ctx: PreviewContext): string {
  let quoted = false;
  const media: string[] = [];
  let out = text.replace(/nostr:((?:npub|nprofile)1[02-9ac-hj-np-z]+)/gi, (_m, code: string) => {
    try {
      const d = nip19.decode(code);
      const pk = d.type === "npub" ? (d.data as string) : (d.data as { pubkey: string }).pubkey;
      const name = ctx.nameOf?.(pk);
      if (name) return `@${name}`;
    } catch {}
    return `@${code.slice(0, 11)}…`;
  });
  out = out.replace(/nostr:(?:note|nevent|naddr)1[02-9ac-hj-np-z]+/gi, () => { quoted = true; return " "; });
  out = out.replace(/https?:\/\/[^\s]+/gi, (url) => {
    const kind = MEDIA.find(([re]) => re.test(url))?.[1];
    if (kind) { media.push(kind); return " "; }
    try { return `\u0000${new URL(url).hostname.replace(/^www\./, "")}\u0000`; } catch { return url; }
  });
  let line = firstLine(out.replace(/[ \t]+/g, " "));
  // A post that is only a link: say where it goes.
  const onlyLink = /^\u0000([^\u0000]+)\u0000$/.exec(line.trim());
  if (onlyLink) line = `Link · ${onlyLink[1]}`;
  line = line.replace(/\u0000/g, "").trim();
  const extra = [...(quoted ? ["quoted a post"] : []), ...media.slice(0, 1)];
  if (!line) {
    if (extra.length === 0) return "";
    const first = extra[0];
    return first === "quoted a post" ? "Quoted a post" : first;
  }
  return [line, ...extra].join(" · ");
}

function targetLine(e: ContentEvent, ctx: PreviewContext): string | undefined {
  const id = [...e.tags].reverse().find((t) => t[0] === "e" && /^[0-9a-f]{64}$/i.test(t[1] ?? ""))?.[1];
  let target = id ? ctx.targetOf?.(id) : undefined;
  if (!target && (e.kind === 6 || e.kind === 16) && e.content.trim().startsWith("{")) {
    try { target = JSON.parse(e.content) as ContentEvent; } catch {}
  }
  if (!target || typeof target.content !== "string") return undefined;
  const line = readable(target.content, ctx);
  return line ? line.slice(0, 120) : undefined;
}

/** The one line a row shows. */
export function rowPreview(e: ContentEvent, ctx: PreviewContext = {}): string {
  const view = typeOf(e.kind);
  if (view === "private") return "Private message — its contents stay sealed";
  if (e.kind === 0) return "Profile update";
  if (view === "reactions") {
    const c = e.content.trim();
    const about = targetLine(e, ctx);
    const verb = c === "" || c === "+" ? "Liked" : c === "-" ? "Disliked" : `Reacted ${c.startsWith(":") ? c : c.slice(0, 8)}`;
    if (about) return `${verb}: ${about}`;
    if (c === "" || c === "+") return "Liked a post";
    if (c === "-") return "Disliked a post";
    return `Reacted ${c.startsWith(":") ? c : c.slice(0, 8)} to a post`;
  }
  if (view === "reposts") {
    const about = targetLine(e, ctx);
    return about ? `Reposted: ${about}` : "Reposted a post";
  }
  if (view === "thanks") return "Sent thanks";
  if (view === "articles") return tag(e, "title") || firstLine(e.content).slice(0, 140) || "Article";
  if (view === "media") return tag(e, "title") || tag(e, "alt") || firstLine(e.content).slice(0, 140) || (e.kind === 20 ? "Picture" : "Video");
  if (view === "lists") {
    const n = e.tags.filter((t) => ["p", "e", "a", "t", "r", "relay", "group"].includes(t[0])).length;
    const name = tag(e, "title") || tag(e, "name") || tag(e, "d");
    return `${name ? `List “${name}”` : "List"} · ${n} ${n === 1 ? "entry" : "entries"}`;
  }
  if (looksEncrypted(e.content)) return "Encrypted content";
  return readable(e.content, ctx).slice(0, 140) || `Kind ${e.kind}`;
}

export type SortKey = "time" | "who" | "type";
export type SortDir = "asc" | "desc";

export function sortEvents<T extends ContentEvent>(events: readonly T[], key: SortKey, dir: SortDir, nameOf: (pubkey: string) => string | undefined): T[] {
  const sign = dir === "asc" ? 1 : -1;
  const byTime = (a: T, b: T) => b.created_at - a.created_at;
  return [...events].sort((a, b) => {
    if (key === "time") return sign * (a.created_at - b.created_at) || 0;
    if (key === "who") {
      const na = (nameOf(a.pubkey) ?? a.pubkey).toLowerCase(), nb = (nameOf(b.pubkey) ?? b.pubkey).toLowerCase();
      return sign * na.localeCompare(nb) || byTime(a, b);
    }
    return sign * typeWord(a.kind).localeCompare(typeWord(b.kind)) || byTime(a, b);
  });
}

export interface ContentFilter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
  "#t"?: string[];
}

/**
 * The filter sent to the relay. Words go to it only when it can search
 * (NIP-50); otherwise they're matched here, on what came back.
 */
export function contentFilter(
  q: EventQuery,
  window: TimeWindow,
  view: TypeViewId,
  nowSec: number,
  opts: { search: boolean; limit: number; until?: number },
): ContentFilter {
  if (q.id) return { ids: [q.id] };
  const f: ContentFilter = { limit: opts.limit };
  if (q.author) f.authors = [q.author];
  const kinds = q.kind !== undefined ? [q.kind] : viewKinds(view);
  if (kinds) f.kinds = kinds;
  if (window.range === "custom") {
    if (window.since) f.since = window.since;
    if (window.until) f.until = window.until;
  } else {
    const since = sinceFor(window.range, nowSec);
    if (since) f.since = since;
  }
  if (opts.until !== undefined) f.until = f.until !== undefined ? Math.min(f.until, opts.until) : opts.until;
  if (opts.search && q.text) f.search = q.text;
  return f;
}

/** Add a page of older results: new ones only, newest first. */
export function mergePage<T extends ContentEvent>(existing: readonly T[], page: readonly T[]): { events: T[]; added: number } {
  const seen = new Set(existing.map((e) => e.id));
  const fresh = page.filter((e) => !seen.has(e.id));
  return { events: [...existing, ...fresh].sort((a, b) => b.created_at - a.created_at), added: fresh.length };
}

export const REMOVAL_REASONS = ["Spam", "Harassment", "Off-topic", "Illegal content", "Other"] as const;

export function removalReason(pick: string | undefined, note: string): string | undefined {
  const n = note.trim();
  if (pick && n) return `${pick}: ${n}`;
  return pick || n || undefined;
}

export function reasonRequired(count: number, rule: boolean): boolean {
  return rule || count > 1;
}

export function typedConfirmRequired(count: number, rule: boolean): boolean {
  return rule || count > 25;
}

export function confirmPhrase(count: number): string {
  return `remove ${count}`;
}

/** What goes into an export: everything, except a private message's contents. */
export function exportable<T extends ContentEvent>(events: readonly T[]): T[] {
  return events.map((e) => (isPrivateKind(e.kind) ? { ...e, content: "" } : e));
}

export function toCsv(events: readonly ContentEvent[], nameOf: (pubkey: string) => string | undefined): string {
  const q = (v: string | number) => `"${String(v).replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`;
  const head = ["time", "author", "author key", "type", "kind", "id", "content"].map(q).join(",");
  const rows = exportable(events).map((e) => [
    new Date(e.created_at * 1000).toISOString(), nameOf(e.pubkey) ?? "", e.pubkey, typeWord(e.kind), e.kind, e.id, e.content,
  ].map(q).join(","));
  return [head, ...rows].join("\n");
}

/** One honest sentence on how much of the relay the list covers. */
export function scopeLine(s: { reached: boolean; loaded: number; relaySearched?: boolean; exhausted?: boolean; oldest?: number }): string {
  if (!s.reached) return "Couldn't reach this relay, so this isn't the full picture";
  if (s.relaySearched) return "Searched the whole relay";
  if (s.exhausted) return "That's everything on this relay for this search";
  if (!s.oldest) return `Searched the latest ${s.loaded}`;
  const when = new Date(s.oldest * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `Searched the latest ${s.loaded}, back to ${when}`;
}
