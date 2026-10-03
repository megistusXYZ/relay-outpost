/**
 * The event inspector's facts, worked out without touching a relay: the codes
 * to share an event by, whether its signature holds, what it points to, what
 * points back to it, and where it's been seen. The UI (EventInspector.tsx)
 * fetches; this decides what the answers mean.
 */
import { getEventHash, nip19, verifyEvent, type Event } from "nostr-tools";

type Signable = Omit<Event, "sig"> & { sig?: string };

export interface Encodings {
  note: string;
  nevent: string;
  npub: string;
  /** Only for something addressable or replaceable — the code that follows its latest version. */
  naddr?: string;
}

const isAddressable = (k: number) => k >= 30000 && k < 40000;
const isReplaceable = (k: number) => k === 0 || k === 3 || (k >= 10000 && k < 20000);

export function encodings(e: Signable, relay?: string): Encodings {
  const relays = relay ? [relay] : undefined;
  const out: Encodings = {
    note: nip19.noteEncode(e.id),
    nevent: nip19.neventEncode({ id: e.id, relays, author: e.pubkey, kind: e.kind }),
    npub: nip19.npubEncode(e.pubkey),
  };
  if (isAddressable(e.kind) || isReplaceable(e.kind)) {
    const identifier = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
    out.naddr = nip19.naddrEncode({ kind: e.kind, pubkey: e.pubkey, identifier, relays });
  }
  return out;
}

export type SignatureVerdict =
  | { verdict: "valid" }
  | { verdict: "invalid"; reason: string }
  | { verdict: "unsigned" };

/** Is it really from who it says? Checked on a copy — nostr-tools caches its answer on the object. */
export function signatureVerdict(e: Signable): SignatureVerdict {
  if (!e.sig) return { verdict: "unsigned" };
  const copy = { id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig };
  let hash: string;
  try { hash = getEventHash(copy); } catch { return { verdict: "invalid", reason: "It isn't a well-formed event" }; }
  if (hash !== e.id) return { verdict: "invalid", reason: "The content was changed after it was signed" };
  try {
    if (verifyEvent(copy)) return { verdict: "valid" };
  } catch { /* malformed signature: fall through */ }
  return { verdict: "invalid", reason: "The signature isn't the author's" };
}

export type Pointer =
  | { type: "event"; value: string; marker?: string }
  | { type: "person"; value: string }
  | { type: "address"; value: string };

/** What it points to — from its tags first (they carry markers), then its text — once each. */
export function pointers(e: Pick<Event, "tags" | "content">): Pointer[] {
  const out: Pointer[] = [];
  const seen = new Set<string>();
  const add = (p: Pointer) => {
    const key = `${p.type}:${p.value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  for (const t of e.tags) {
    if (!t[1]) continue;
    if (t[0] === "e" || t[0] === "q") add(t[3] ? { type: "event", value: t[1], marker: t[3] } : { type: "event", value: t[1] });
    else if (t[0] === "p") add({ type: "person", value: t[1] });
    else if (t[0] === "a") add({ type: "address", value: t[1] });
  }
  for (const m of e.content.matchAll(/nostr:((?:note|nevent|npub|nprofile|naddr)1[02-9ac-hj-np-z]+)/gi)) {
    try {
      const d = nip19.decode(m[1].toLowerCase());
      if (d.type === "note") add({ type: "event", value: d.data });
      else if (d.type === "nevent") add({ type: "event", value: d.data.id });
      else if (d.type === "npub") add({ type: "person", value: d.data });
      else if (d.type === "nprofile") add({ type: "person", value: d.data.pubkey });
      else if (d.type === "naddr") add({ type: "address", value: `${d.data.kind}:${d.data.pubkey}:${d.data.identifier}` });
    } catch { /* a broken code in someone's text is just text */ }
  }
  return out;
}

export interface ReferenceCounts { replies: number; reactions: number; reposts: number; thanks: number; other: number }

/** What points back to it, by what people did. */
export function referenceCounts(refs: Array<{ kind: number }>): ReferenceCounts {
  const c: ReferenceCounts = { replies: 0, reactions: 0, reposts: 0, thanks: 0, other: 0 };
  for (const { kind } of refs) {
    if (kind === 1 || kind === 1111) c.replies++;
    else if (kind === 7) c.reactions++;
    else if (kind === 6 || kind === 16) c.reposts++;
    else if (kind === 9735) c.thanks++;
    else c.other++;
  }
  return c;
}

/** has = the relay returned it; missing = it answered without it; unreached = we never got to ask. */
export type SeenStatus = "has" | "missing" | "unreached";
export interface SeenOn { relay: string; status: SeenStatus }

export function seenOnLine(rows: SeenOn[]): string {
  const has = rows.filter((r) => r.status === "has").length;
  const answered = has + rows.filter((r) => r.status === "missing").length;
  const unreached = rows.length - answered;
  if (answered === 0) return "No relay could be reached to check";
  const line = `On ${has} of ${answered} relay${answered === 1 ? "" : "s"} that answered`;
  return unreached ? `${line} · ${unreached} couldn't be reached` : line;
}

/**
 * Someone pasted something into search: is it an event to inspect? Takes the
 * bare JSON or a relay's ["EVENT", …] line. Signed or not, genuine or not —
 * finding that out is the inspector's job, so only the shape is checked here.
 */
export function parsePastedEvent(text: string): Signable | null {
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  let v: unknown;
  try { v = JSON.parse(t); } catch { return null; }
  if (Array.isArray(v)) v = v[0] === "EVENT" ? v[v.length - 1] : null;
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  const hex64 = (x: unknown) => typeof x === "string" && /^[0-9a-f]{64}$/i.test(x);
  if (!hex64(e.id) || !hex64(e.pubkey) || typeof e.kind !== "number" || typeof e.created_at !== "number" || typeof e.content !== "string") return null;
  if (!Array.isArray(e.tags) || !e.tags.every((tag) => Array.isArray(tag) && tag.every((x) => typeof x === "string"))) return null;
  if (e.sig !== undefined && typeof e.sig !== "string") return null;
  return e as unknown as Signable;
}
