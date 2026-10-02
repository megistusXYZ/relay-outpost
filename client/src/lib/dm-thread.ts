/**
 * Replies and reactions inside a private chat (NIP-17), as rules.
 *
 *  - A reply is an ordinary chat message that names the message it answers in
 *    an `e` tag.
 *  - A reaction is a kind-7 message (NIP-25) sealed and wrapped like any other,
 *    sent to everyone in the chat. Its content is the emoji; its `e` tag is
 *    the message reacted to.
 *
 * One person has one reaction per message here: their newest replaces their
 * earlier one. There is no "remove": NIP-17 defines no way to take a private
 * message back, and a removal only this app understood would leave the
 * reaction showing in every other app.
 *
 * Pure. lib/gift-wrap.ts reads these off an opened message; the Messages page
 * draws them.
 */

export const KIND_REACTION = 7;

/** The row of reactions offered under a message. */
export const QUICK_REACTIONS: readonly string[] = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);

/** The tag a reply carries. */
export function replyTag(messageId: string): string[] {
  return ["e", messageId, "", "reply"];
}

/** The message a chat message answers, if any. */
export function replyToOf(kind: number, tags: readonly string[][] | undefined): string | undefined {
  if (kind === KIND_REACTION) return undefined;
  const es = (tags ?? []).filter((t) => t[0] === "e" && isId(t[1]));
  if (es.length === 0) return undefined;
  // Marked as the reply where an app marks them; otherwise the last one.
  return (es.find((t) => t[3] === "reply") ?? es[es.length - 1])[1];
}

/** The tags a reaction carries besides the chat's people. */
export function reactionTags(messageId: string): string[][] {
  return [["e", messageId], ["k", "14"]];
}

/** The message a reaction is about: its last `e` tag (NIP-25). */
export function reactionTargetOf(tags: readonly string[][] | undefined): string | undefined {
  const es = (tags ?? []).filter((t) => t[0] === "e" && isId(t[1]));
  return es.length ? es[es.length - 1][1] : undefined;
}

/** What a reaction shows as. Null when its content is not a reaction at all. */
export function reactionEmoji(content: string | undefined): string | null {
  const c = (content ?? "").trim();
  if (c === "" || c === "+") return "👍";
  if (c === "-") return "👎";
  if (/^:[A-Za-z0-9_+-]{1,40}:$/.test(c)) return c;
  // An emoji is a handful of code points, however it is composed.
  return Array.from(c).length <= 8 && !/[A-Za-z0-9]/.test(c) ? c : null;
}

export interface ReactionRow {
  id: string;
  from: string;
  content: string;
  timestamp: number;
  reactsTo: string;
}

export interface ReactionTally {
  emoji: string;
  count: number;
  /** The reader is one of the people. */
  mine: boolean;
  people: string[];
}

/** What to show under each message: message id → its reactions. */
export function tallyReactions(rows: readonly ReactionRow[], me: string): Map<string, ReactionTally[]> {
  // Each person's newest reaction to each message.
  const newest = new Map<string, ReactionRow & { emoji: string }>();
  for (const row of rows) {
    const emoji = reactionEmoji(row.content);
    if (!emoji || !row.reactsTo) continue;
    const key = `${row.reactsTo}:${row.from}`;
    const had = newest.get(key);
    if (!had || row.timestamp > had.timestamp) newest.set(key, { ...row, emoji });
  }
  const out = new Map<string, ReactionTally[]>();
  for (const row of Array.from(newest.values()).sort((a, b) => a.timestamp - b.timestamp)) {
    const list = out.get(row.reactsTo) ?? [];
    let tally = list.find((t) => t.emoji === row.emoji);
    if (!tally) { tally = { emoji: row.emoji, count: 0, mine: false, people: [] }; list.push(tally); }
    tally.count++;
    tally.people.push(row.from);
    if (row.from === me) tally.mine = true;
    out.set(row.reactsTo, list);
  }
  return out;
}

/** One line standing in for a message that is being answered. */
export function replySnippet(msg: { content: string; fileMetadata?: { mimeType?: string } }): string {
  if (msg.fileMetadata) {
    const mime = msg.fileMetadata.mimeType ?? "";
    if (mime.startsWith("image/")) return "Photo";
    if (mime.startsWith("video/")) return "Video";
    if (mime.startsWith("audio/")) return "Voice message";
    return "File";
  }
  const line = msg.content.replace(/\s+/g, " ").trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
