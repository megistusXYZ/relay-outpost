// Pure render-model for the NIP-29 Communities chat timeline. Kept free of React
// and app singletons so it is unit-testable in a plain node vitest environment.
import { isToday, isYesterday, format } from "date-fns";
import type { GroupMessage } from "@/lib/nip29";

export function chatDayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM d, yyyy");
}

export const CLUSTER_GAP_SECONDS = 5 * 60;

// A membership change (NIP-29 9000 put-user / 9001 remove-user). Individually
// these are noisy, so the render pipeline collapses consecutive runs of them
// into a single de-emphasized summary line (see summarizeSystemRun).
export interface ChatSystemEvent {
  id: string;
  pubkey: string;
  kind: "join" | "leave";
  createdAt: number;
}

// The collapsed result of a run of adjacent membership events: the people who
// (net) joined and the people who (net) left, with same-pubkey join+leave churn
// dropped entirely.
export interface SystemGroup {
  joins: string[];
  leaves: string[];
  createdAt: number;
}

// PURE. Collapse one contiguous run of membership events into a single summary.
// A pubkey that both joined and left within the run is a no-op and dropped, so
// the timeline never shows "Ytuu joined · Ytuu left". First-seen order is
// preserved. Returns null when the run nets to nothing (all churn).
export function summarizeSystemRun(run: ChatSystemEvent[]): SystemGroup | null {
  const state = new Map<string, { join: boolean; leave: boolean }>();
  let createdAt = 0;
  for (const ev of run) {
    if (ev.createdAt > createdAt) createdAt = ev.createdAt;
    const cur = state.get(ev.pubkey) ?? { join: false, leave: false };
    if (ev.kind === "join") cur.join = true;
    else cur.leave = true;
    state.set(ev.pubkey, cur);
  }
  const joins: string[] = [];
  const leaves: string[] = [];
  for (const [pk, s] of state) {
    if (s.join && s.leave) continue; // joined then left (or vice-versa) → no-op
    if (s.join) joins.push(pk);
    else if (s.leave) leaves.push(pk);
  }
  if (joins.length === 0 && leaves.length === 0) return null;
  return { joins, leaves, createdAt };
}

export type ChatRenderItem =
  | { type: "date"; key: string; label: string }
  | { type: "unread"; key: string }
  | { type: "system-group"; key: string; joins: string[]; leaves: string[]; createdAt: number }
  | { type: "msg"; key: string; msg: GroupMessage; isMine: boolean; isClusterStart: boolean; isClusterEnd: boolean };

// Turn the time-sorted message + membership streams into Signal-style render
// items: date separators between calendar days, collapsed "joined/left" system
// summaries, an unread divider where the reader left off, and per-sender clusters
// (consecutive messages from one author within a short gap) flagged start/end so
// the UI shows the avatar+name once and a timestamp on the last bubble.
export function buildChatRenderItems(
  messages: GroupMessage[],
  systemEvents: ChatSystemEvent[],
  myPubkey: string | null,
  lastReadTs: number,
): ChatRenderItem[] {
  type Entry = { k: "msg"; t: number; msg: GroupMessage } | { k: "sys"; t: number; sys: ChatSystemEvent };
  const entries: Entry[] = [
    ...messages.map((msg) => ({ k: "msg" as const, t: msg.createdAt, msg })),
    ...systemEvents.map((sys) => ({ k: "sys" as const, t: sys.createdAt, sys })),
  ].sort((a, b) => a.t - b.t || (a.k === "sys" ? -1 : 1));

  const items: ChatRenderItem[] = [];
  let lastDay = "";
  let unreadShown = false;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const day = format(new Date(e.t * 1000), "yyyy-MM-dd");
    if (day !== lastDay) {
      items.push({ type: "date", key: `date-${day}-${e.t}`, label: chatDayLabel(e.t) });
      lastDay = day;
    }
    // Unread divider before the first item newer than the last time the reader
    // viewed this channel (only when there's genuinely unseen history).
    if (!unreadShown && lastReadTs > 0 && e.t > lastReadTs) {
      items.push({ type: "unread", key: "unread-divider" });
      unreadShown = true;
    }
    if (e.k === "sys") {
      // Gather the whole contiguous run of membership events and collapse it into
      // ONE subtle summary line. A message between two membership events ends the
      // run, so churn around real conversation stays legible and ordered.
      const run: ChatSystemEvent[] = [];
      let j = i;
      while (j < entries.length && entries[j].k === "sys") {
        run.push((entries[j] as Extract<Entry, { k: "sys" }>).sys);
        j++;
      }
      const summary = summarizeSystemRun(run);
      if (summary) {
        const first = run[0];
        items.push({
          type: "system-group",
          key: `sysgrp-${first.id}-${first.pubkey}-${summary.createdAt}`,
          joins: summary.joins,
          leaves: summary.leaves,
          createdAt: summary.createdAt,
        });
      }
      i = j - 1;
      continue;
    }
    const msg = e.msg;
    const prevMsg = entries[i - 1]?.k === "msg" ? (entries[i - 1] as { msg: GroupMessage }).msg : null;
    const nextMsg = entries[i + 1]?.k === "msg" ? (entries[i + 1] as { msg: GroupMessage }).msg : null;
    const newDay = !prevMsg || format(new Date(prevMsg.createdAt * 1000), "yyyy-MM-dd") !== day;
    const isClusterStart = !prevMsg || prevMsg.pubkey !== msg.pubkey || newDay || msg.createdAt - prevMsg.createdAt > CLUSTER_GAP_SECONDS;
    const nextNewDay = !nextMsg || format(new Date(nextMsg.createdAt * 1000), "yyyy-MM-dd") !== day;
    const isClusterEnd = !nextMsg || nextMsg.pubkey !== msg.pubkey || nextNewDay || nextMsg.createdAt - msg.createdAt > CLUSTER_GAP_SECONDS;
    items.push({
      type: "msg",
      key: msg.id,
      msg,
      isMine: !!myPubkey && msg.pubkey === myPubkey,
      isClusterStart,
      isClusterEnd,
    });
  }
  return items;
}
