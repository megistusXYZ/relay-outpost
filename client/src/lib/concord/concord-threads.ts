/**
 * Flat, NIP-22 thread grouping for Concord chat (read side).
 *
 * A Concord reply is a kind-1111 rumor carrying an UPPERCASE root pointer
 * (`["E", rootId]` — the thread-starter message) alongside the lowercase parent
 * (`["e", parentId]` — the immediate message replied to). We already emit and
 * parse both (buildReplyRumor / the message fold). Threads here are FLAT: every
 * reply is grouped under its ROOT, matching how Ditto/Armada render "N replies"
 * — so threads line up across clients with no wire change.
 *
 * This module is pure so the grouping is unit-tested without the chat UI. It:
 *  - pulls thread replies OUT of the channel timeline (they live in the panel),
 *  - leaves a reply whose root isn't in THIS channel INLINE (fallback — never
 *    hide a message we can't confidently attribute),
 *  - and computes each thread's reply count + distinct recent repliers (facepile).
 */

export interface ThreadableMsg {
  id: string;
  pubkey: string;
  /** Sort key (effective time). */
  t: number;
  /** The thread-root message id (uppercase `E`), or undefined for a top-level message. */
  rootId?: string | null;
}

export interface ThreadMeta {
  /** Number of replies in the thread. */
  count: number;
  /** Distinct replier pubkeys, first-seen order — the facepile source. */
  repliers: string[];
}

export interface GroupedThreads<T extends ThreadableMsg> {
  /** Messages to render in the channel: top-level messages + fallback replies. */
  timeline: T[];
  /** rootId → its replies, sorted chronologically. */
  threads: Map<string, T[]>;
  /** rootId → { count, repliers } for the channel indicator. */
  meta: Map<string, ThreadMeta>;
}

export function groupThreads<T extends ThreadableMsg>(messages: T[]): GroupedThreads<T> {
  const byId = new Map(messages.map((x) => [x.id, x]));
  const threads = new Map<string, T[]>();
  const timeline: T[] = [];

  /**
   * The TOP-LEVEL starter this message belongs under, or null if it is one.
   *
   * Walks up rootId until it reaches a message that isn't itself a reply. A
   * client that answers a reply may point its root at that reply (ours does);
   * taken literally that would open a sub-thread whose own starter is buried
   * inside another thread — replies no one could ever see. Flattening one level
   * at a time keeps every reply reachable from the channel. The `seen` guard
   * makes a malformed cycle terminate instead of hanging the render.
   */
  const topRoot = (msg: T): string | null => {
    const seen = new Set<string>([msg.id]);
    let cur = msg;
    for (;;) {
      // No root pointer, or one we can't see in this channel → cur is as far up
      // as we go. (An unseen root is why a reply can be its own inline fallback.)
      if (!cur.rootId || !byId.has(cur.rootId)) return cur === msg ? null : cur.id;
      // Pointers that loop back on themselves are malformed; rather than bury
      // both messages under each other, leave this one in the channel.
      if (seen.has(cur.rootId)) return null;
      seen.add(cur.rootId);
      cur = byId.get(cur.rootId)!;
    }
  };

  for (const msg of messages) {
    // Null root → a top-level message, or a reply whose starter isn't in this
    // channel (fallback: it stays inline rather than disappearing).
    const root = topRoot(msg);
    if (root) {
      const arr = threads.get(root);
      if (arr) arr.push(msg);
      else threads.set(root, [msg]);
    } else {
      timeline.push(msg);
    }
  }

  const meta = new Map<string, ThreadMeta>();
  for (const [root, replies] of threads) {
    replies.sort((a, b) => a.t - b.t);
    const repliers: string[] = [];
    const seen = new Set<string>();
    for (const r of replies) {
      if (!seen.has(r.pubkey)) { seen.add(r.pubkey); repliers.push(r.pubkey); }
    }
    meta.set(root, { count: replies.length, repliers });
  }

  return { timeline, threads, meta };
}
