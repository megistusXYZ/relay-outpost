/**
 * Searching private messages.
 *
 * Relays hold only ciphertext, so there is nothing to search remotely: the
 * search runs over the messages THIS DEVICE has opened and stored, and says
 * how many that was — a message that was never loaded here cannot be found,
 * and the count is how the reader knows the search's reach.
 *
 * Pure: lib/dm-cache.ts supplies the messages, the Chats list draws the hits.
 */

export const MIN_QUERY = 2;

export interface SearchableMessage {
  id: string;
  /** The chat it is filed in (lib/dm-room.ts). */
  peerPubkey: string;
  content: string;
  from: string;
  timestamp: number;
  fileMetadata?: unknown;
  reactsTo?: string;
}

export interface MessageHit {
  id: string;
  room: string;
  from: string;
  timestamp: number;
  /** The message on one line, in three parts: the match is drawn set apart. */
  before: string;
  match: string;
  after: string;
}

export interface MessageSearch {
  hits: MessageHit[];
  /** How many messages were looked through. */
  searched: number;
  /** Matches beyond the limit. */
  more: number;
}

const BEFORE = 30;
const AFTER = 80;

export function searchMessages(
  messages: readonly SearchableMessage[],
  query: string,
  opts: { rooms?: ReadonlySet<string>; limit?: number } = {},
): MessageSearch {
  const q = query.trim().toLowerCase();
  // A file's "text" is its address and a reaction's is an emoji: neither is
  // something anyone wrote to be found.
  const pool = messages.filter((m) => !m.fileMetadata && !m.reactsTo && (!opts.rooms || opts.rooms.has(m.peerPubkey)));
  if (q.length < MIN_QUERY) return { hits: [], searched: pool.length, more: 0 };
  const limit = opts.limit ?? 20;
  const found: MessageHit[] = [];
  for (const m of pool) {
    const line = m.content.replace(/\s+/g, " ").trim();
    const at = line.toLowerCase().indexOf(q);
    if (at < 0) continue;
    const start = Math.max(0, at - BEFORE);
    const end = Math.min(line.length, at + q.length + AFTER);
    found.push({
      id: m.id, room: m.peerPubkey, from: m.from, timestamp: m.timestamp,
      before: (start > 0 ? "…" : "") + line.slice(start, at),
      match: line.slice(at, at + q.length),
      after: line.slice(at + q.length, end) + (end < line.length ? "…" : ""),
    });
  }
  found.sort((a, b) => b.timestamp - a.timestamp);
  return { hits: found.slice(0, limit), searched: pool.length, more: Math.max(0, found.length - limit) };
}
