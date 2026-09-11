/**
 * How one Concord message references another (CORD-03; examples §2.1–2.2).
 *
 * - An inline quote is a kind 9 carrying `["q", id, "", author]`. It stays in
 *   the room, with a card of the message it answers.
 * - A threaded reply is a kind 1111: uppercase `K`/`E`/`P` pin the thread root,
 *   lowercase `k`/`e`/`p` the immediate parent. It lives in the thread, and a
 *   reply to a reply inherits the root, so the thread holds together at any depth.
 *
 * Pure, so the chat and the background mention scanner read a message the same
 * way (they used to mirror each other by hand).
 */
import { KIND_MESSAGE, KIND_REPLY } from "./concord-events";

export type MessageRef = { id: string; pubkey: string };
/** A message as a thread's root: the root's kind rides in `K`. */
export type RootRef = MessageRef & { kind: number };

export type MessageShape = {
  kind: number;
  /** The message this one answers: the quoted one, or a reply's parent. */
  replyTo?: MessageRef;
  /** A threaded reply's root: the message whose thread it belongs to. */
  root?: RootRef;
};

type Taggable = { kind: number; tags: string[][] };

const tag = (tags: string[][], name: string) => tags.find((t) => t[0] === name && typeof t[1] === "string" && t[1]);
const kindOf = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

/** What a decoded chat rumor says about the messages it references. */
export function readMessageShape(rumor: Taggable): MessageShape {
  if (rumor.kind === KIND_MESSAGE) {
    const q = tag(rumor.tags, "q");
    const author = q?.[3] || tag(rumor.tags, "p")?.[1];
    return { kind: rumor.kind, ...(q && author ? { replyTo: { id: q[1], pubkey: author } } : {}) };
  }
  if (rumor.kind === KIND_REPLY) {
    const e = tag(rumor.tags, "e");
    const parentAuthor = e?.[3] || tag(rumor.tags, "p")?.[1];
    const replyTo = e && parentAuthor ? { id: e[1], pubkey: parentAuthor } : undefined;
    const E = tag(rumor.tags, "E");
    const rootAuthor = E?.[3] || tag(rumor.tags, "P")?.[1];
    // A reply without a root pointer (older clients) belongs under its parent,
    // which is the same thing whenever the parent started the thread.
    const root = E && rootAuthor
      ? { id: E[1], pubkey: rootAuthor, kind: kindOf(tag(rumor.tags, "K")?.[1], KIND_MESSAGE) }
      : replyTo ? { ...replyTo, kind: kindOf(tag(rumor.tags, "k")?.[1], KIND_MESSAGE) } : undefined;
    return { kind: rumor.kind, ...(replyTo ? { replyTo } : {}), ...(root ? { root } : {}) };
  }
  return { kind: rumor.kind };
}

/**
 * The references for a reply in a thread (buildReplyRumor). The parent is the
 * message being answered; the root is inherited from it when it is itself a
 * threaded reply ("verbatim, so the root stays stable at any depth"), and is
 * the parent otherwise.
 */
export function threadReplyRef(parent: MessageRef & { kind: number; root?: RootRef }): {
  rootKind: number; rootId: string; rootPubkey: string; parentKind: number; parentId: string; parentPubkey: string;
} {
  const root = parent.kind === KIND_REPLY && parent.root ? parent.root : { id: parent.id, pubkey: parent.pubkey, kind: parent.kind };
  return {
    rootKind: root.kind, rootId: root.id, rootPubkey: root.pubkey,
    parentKind: parent.kind, parentId: parent.id, parentPubkey: parent.pubkey,
  };
}
