/**
 * Search a group chat on this device. It reads the rooms' messages this device
 * has already opened and decrypted, so nothing leaves the device and no relay
 * is asked. (Relay Outpost's own; not in the spec.)
 *
 * Every word must appear, in any order, ignoring case and accents. Newest first.
 */
export interface SearchableMessage {
  id: string;
  pubkey: string;
  content: string;
  t: number;
  deleted?: boolean;
  deletedBy?: string;
  /** When it disappears (unix seconds, CORD-08). */
  expiresAt?: number;
  /** Set on a threaded reply: the message whose thread it's in. */
  rootId?: string;
}

export interface SearchRoom {
  id: string;
  name: string;
  messages: SearchableMessage[];
}

export interface SearchHit {
  roomId: string;
  roomName: string;
  msg: SearchableMessage;
  /** The match as written, with the words around it. */
  snippet: { before: string; match: string; after: string };
}

const LIMIT = 50;
/** Characters of context either side of the match. */
const CONTEXT = 40;

/** Lower-cased and accent-free, with each folded character's index in the original. */
function fold(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = text[i].normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < f.length; k++) { folded += f[k]; at.push(i); }
  }
  return { folded, at };
}

function snippetAt(text: string, start: number, end: number): SearchHit["snippet"] {
  const flat = (s: string) => s.replace(/\s+/g, " ");
  const from = Math.max(0, start - CONTEXT);
  const to = Math.min(text.length, end + CONTEXT);
  return {
    before: (from > 0 ? "…" : "") + flat(text.slice(from, start)),
    match: text.slice(start, end),
    after: flat(text.slice(end, to)) + (to < text.length ? "…" : ""),
  };
}

export function searchGroup(rooms: SearchRoom[], query: string, opts: { now?: number; limit?: number } = {}): SearchHit[] {
  const words = fold(query).folded.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const now = opts.now ?? Date.now();
  const hits: SearchHit[] = [];
  for (const room of rooms) {
    for (const msg of room.messages) {
      if (!msg.content || msg.deleted || msg.deletedBy) continue;
      if (msg.expiresAt && msg.expiresAt * 1000 <= now) continue;
      const { folded, at } = fold(msg.content);
      const first = folded.indexOf(words[0]);
      if (first < 0 || !words.every((w) => folded.includes(w))) continue;
      hits.push({ roomId: room.id, roomName: room.name, msg, snippet: snippetAt(msg.content, at[first], at[first + words[0].length - 1] + 1) });
    }
  }
  return hits.sort((a, b) => b.msg.t - a.msg.t).slice(0, opts.limit ?? LIMIT);
}
