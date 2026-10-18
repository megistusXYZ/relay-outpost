/**
 * Notes and comments that answer a long-form article (kind 30023).
 *
 * A kind-1 note points at the article with an `a` tag ("30023:<pubkey>:<d>");
 * a NIP-22 comment (kind 1111) names it as its root scope with `A`. The feed
 * shows the article on top of such a reply, and a TOP-LEVEL comment on an
 * article counts as a post (commentary people want seen). A reply to another
 * comment under the article stays a reply.
 */
export const KIND_ARTICLE = 30023;
const KIND_COMMENT = 1111;

export interface ArticleCoord { pubkey: string; identifier: string; relay?: string }
type Tagged = { kind: number; tags: string[][] };

function parseCoord(value: string | undefined, relay?: string): ArticleCoord | null {
  if (!value) return null;
  const [kind, pubkey, ...rest] = value.split(":");
  if (kind !== String(KIND_ARTICLE) || !/^[0-9a-f]{64}$/i.test(pubkey ?? "") || rest.length === 0) return null;
  return { pubkey: pubkey.toLowerCase(), identifier: rest.join(":"), ...(relay ? { relay } : {}) };
}

/** The article this note or comment answers, or null. */
export function articleReplyTarget(ev: Tagged): ArticleCoord | null {
  const pick = (name: string) => ev.tags.find((t) => t[0] === name && t[3] !== "mention" && parseCoord(t[1]));
  const tag = ev.kind === KIND_COMMENT ? pick("A") ?? pick("a") : ev.kind === 1 ? pick("a") : undefined;
  return tag ? parseCoord(tag[1], tag[2] || undefined) : null;
}

/** Answers the article itself, not a comment under it. */
export function isTopLevelArticleComment(ev: Tagged): boolean {
  if (!articleReplyTarget(ev)) return false;
  if (ev.kind === KIND_COMMENT) {
    const parentKind = ev.tags.find((t) => t[0] === "k")?.[1];
    if (parentKind) return parentKind === String(KIND_ARTICLE);
    return ev.tags.some((t) => t[0] === "a" && parseCoord(t[1])) && !ev.tags.some((t) => t[0] === "e");
  }
  const eTags = ev.tags.filter((t) => t[0] === "e" && t[1] && t[3] !== "mention");
  if (eTags.some((t) => t[3] === "reply")) return false;
  return eTags.length <= 1;
}

/**
 * Comments (kind 1111) reach the feed only as top-level comments on articles,
 * from people you follow or you. Every other kind is left to the feed.
 */
export function feedKeepsComment(ev: Tagged & { pubkey: string }, follows: ReadonlySet<string>, me?: string | null): boolean {
  if (ev.kind !== KIND_COMMENT) return true;
  if (!isTopLevelArticleComment(ev)) return false;
  return follows.has(ev.pubkey) || (!!me && ev.pubkey === me);
}
