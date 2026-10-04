/**
 * The publisher's rules: reading what was written, what publishing it would
 * do, and what each relay said back — "Accepted by 3 of 5", with each
 * relay's own reason.
 *
 * Pure.
 */
import { plainKindName } from "@/lib/kind-catalog";
import { relayWords, type WireFrame } from "./wire-transcript";

export interface Draft {
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
  id?: string;
  pubkey?: string;
  sig?: string;
}

export type ReadDraft = { ok: true; draft: Draft; signed: boolean } | { ok: false; error: string };

/** A template to sign (kind, content, tags) or a signed event to send as it is. */
export function readDraft(text: string): ReadDraft {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return { ok: false, error: "That isn't valid JSON" }; }
  if (Array.isArray(v) && v[0] === "EVENT") v = v[v.length - 1];
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "An event is an object, like {\"kind\":1,\"content\":\"hi\"}" };
  const e = v as Record<string, unknown>;
  if (!Number.isInteger(e.kind) || (e.kind as number) < 0) return { ok: false, error: "Give it a kind — a number, like 1 for a note" };
  if (e.content !== undefined && typeof e.content !== "string") return { ok: false, error: "content must be text" };
  const tags = e.tags ?? [];
  if (!Array.isArray(tags) || !tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === "string"))) {
    return { ok: false, error: "tags must be a list of lists of text, like [[\"t\",\"nostr\"]]" };
  }
  if (e.created_at !== undefined && !Number.isInteger(e.created_at)) return { ok: false, error: "created_at must be a time in seconds" };
  const signed = typeof e.id === "string" && typeof e.pubkey === "string" && typeof e.sig === "string" && typeof e.created_at === "number";
  if (signed) return { ok: true, draft: e as unknown as Draft, signed: true };
  const draft: Draft = { kind: e.kind as number, content: (e.content as string | undefined) ?? "", tags: tags as string[][] };
  if (typeof e.created_at === "number") draft.created_at = e.created_at;
  return { ok: true, draft, signed: false };
}

export interface Risk { level: "serious" | "note"; text: string }

/** What publishing this kind does beyond adding a post. Serious ones ask before sending. */
export function riskOf(kind: number): Risk | null {
  if (kind === 0) return { level: "serious", text: "This replaces your profile everywhere it lands." };
  if (kind === 3) return { level: "serious", text: "This replaces your follow list everywhere it lands. A short or empty list unfollows everyone left out." };
  if (kind === 5) return { level: "serious", text: "This asks relays to delete the events it names." };
  if (kind === 4 || kind === 13 || kind === 14) return { level: "serious", text: "Private messages must be encrypted first — this sends the content exactly as written." };
  if (kind >= 10000 && kind < 20000) return { level: "serious", text: `This replaces your ${plainKindName(kind).toLowerCase()} everywhere it lands.` };
  if (kind >= 30000 && kind < 40000) return { level: "note", text: "This replaces any earlier version with the same name (its d tag)." };
  return null;
}

export type PublishStatus = "accepted" | "refused" | "needs-sign-in" | "unreached" | "waiting";
export interface PublishRow { relay: string; status: PublishStatus; reason?: string; ms?: number }

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Each relay's answer to one event (its latest answer wins — a sign-in can turn "no" into "yes"). */
export function publishResults(relays: string[], eventId: string, frames: WireFrame[]): { line: string; accepted: number; rows: PublishRow[] } {
  const rows = relays.map((relay): PublishRow => {
    let sentAt: number | undefined;
    let row: PublishRow = { relay, status: "waiting" };
    let answered = false;
    for (const f of frames) {
      if (f.relay !== relay) continue;
      if (f.dir === "conn") {
        if (f.state === "error" && !answered) row = { relay, status: "unreached", ...(f.detail ? { reason: f.detail } : {}) };
        continue;
      }
      const [verb, id, ok, message] = f.msg as [string, unknown, unknown, unknown];
      if (f.dir === "out" && verb === "EVENT" && (id as { id?: string } | undefined)?.id === eventId) sentAt = f.at;
      if (f.dir !== "in" || verb !== "OK" || id !== eventId) continue;
      answered = true;
      const raw = String(message ?? "");
      const ms = sentAt !== undefined ? f.at - sentAt : undefined;
      const withMs = (r: PublishRow): PublishRow => (ms !== undefined ? { ...r, ms } : r);
      if (ok === true) row = withMs(/^duplicate/i.test(raw) ? { relay, status: "accepted", reason: "already had it" } : { relay, status: "accepted" });
      else if (/^auth-required/i.test(raw)) row = withMs({ relay, status: "needs-sign-in", reason: relayWords(raw) });
      else row = withMs({ relay, status: "refused", ...(relayWords(raw) ? { reason: relayWords(raw) } : {}) });
    }
    return row;
  });
  if (!frames.length) return { line: `Sending to ${count(relays.length, "relay", "relays")}…`, accepted: 0, rows };
  const n = (s: PublishStatus) => rows.filter((r) => r.status === s).length;
  const accepted = n("accepted");
  const parts = [`Accepted by ${accepted} of ${relays.length}`];
  if (n("refused")) parts.push(`${n("refused")} refused`);
  if (n("needs-sign-in")) parts.push(`${count(n("needs-sign-in"), "wants", "want")} you to sign in`);
  if (n("unreached")) parts.push(`${n("unreached")} couldn't be reached`);
  if (n("waiting")) parts.push(`${n("waiting")} ${n("waiting") === 1 ? "hasn't" : "haven't"} answered`);
  return { line: parts.join(" · "), accepted, rows };
}
