/**
 * Group-chat mentions and replies as Activity rows. Group chats are encrypted,
 * so these never reach the relay-driven notification feed; the mention ledger
 * (concord-mentions) already knows which messages mention you, and the message
 * cache on this device knows who wrote what.
 *
 * Pure: the ledger, read marks, mutes, held groups and the cache lookup are
 * passed in (useGroupMentions wires them).
 */
import type { MentionLedger } from "./concord-mentions";
import type { CachedMessage } from "./concord-keys";

export interface MentionRef { communityId: string; channelId: string; id: string; t: number }

export interface GroupMentionRow {
  key: string;
  communityId: string;
  channelId: string;
  groupName: string;
  /** Absent for a one-room group, where naming the room is noise. */
  roomName?: string;
  /** Absent when the message isn't on this device. */
  author?: string;
  verb: "mentioned you" | "replied to you";
  snippet?: string;
  /** Message time, ms. */
  t: number;
  /** Opens that room. */
  href: string;
}

const SNIPPET_MAX = 140;

/** The mentions still waiting: not read past, not muted, newest first. */
export function ledgerRows(
  ledger: MentionLedger,
  lastRead: (communityId: string, channelId: string) => number,
  muted: (communityId: string, channelId: string) => boolean,
): MentionRef[] {
  const out: MentionRef[] = [];
  for (const [key, list] of Object.entries(ledger)) {
    const at = key.indexOf("|");
    if (at < 0 || !Array.isArray(list)) continue;
    const communityId = key.slice(0, at), channelId = key.slice(at + 1);
    if (muted(communityId, channelId)) continue;
    const floor = lastRead(communityId, channelId);
    for (const e of list) if (e.t > floor) out.push({ communityId, channelId, id: e.id, t: e.t });
  }
  return out.sort((a, b) => b.t - a.t);
}

function oneLine(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > SNIPPET_MAX ? `${s.slice(0, SNIPPET_MAX - 1).trimEnd()}…` : s;
}

/** What each row says. Mentions in groups you no longer hold are dropped. */
export function groupMentionRows(
  refs: MentionRef[],
  groups: Map<string, { name: string; channels: { id: string; name: string }[] }>,
  lookup: (communityId: string, channelId: string, id: string) => CachedMessage | undefined,
  me: string,
): GroupMentionRow[] {
  const rows: GroupMentionRow[] = [];
  for (const ref of refs) {
    const group = groups.get(ref.communityId);
    if (!group) continue;
    const msg = lookup(ref.communityId, ref.channelId, ref.id);
    rows.push({
      key: `${ref.communityId}|${ref.channelId}|${ref.id}`,
      communityId: ref.communityId,
      channelId: ref.channelId,
      groupName: group.name || "Group chat",
      roomName: group.channels.length > 1 ? group.channels.find((c) => c.id === ref.channelId)?.name : undefined,
      author: msg?.pubkey,
      verb: msg?.replyTo?.pubkey === me ? "replied to you" : "mentioned you",
      snippet: msg ? oneLine(msg.content) || undefined : undefined,
      t: ref.t,
      href: `/outposts/c/${ref.communityId}?channel=${ref.channelId}`,
    });
  }
  return rows;
}
