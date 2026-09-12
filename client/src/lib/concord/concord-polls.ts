/**
 * Polls in Concord group chats, as Armada seals them (Armada CORD.md "Polls":
 * NIP-88 carried inside the Chat Plane, so the question, who voted and the
 * tally never leave the group). A poll is a room message that declares
 * options; a vote is a side event naming the poll, folded into its tally like
 * a reaction. Pure.
 */

import { effectiveTime, msTag, type RumorTemplate } from "./concord-events";

/** NIP-88 poll: a room message whose question is its content. */
export const KIND_POLL = 1068;
/** NIP-88 poll response: a side event `e`-tagging its poll, never its own row. */
export const KIND_POLL_VOTE = 1018;

export interface PollOption { id: string; label: string }

export type PollType = "singlechoice" | "multiplechoice";

/** A poll's options and settings, as its tags declare them. */
export interface ParsedPoll {
  options: PollOption[];
  pollType: PollType;
  /** Unix seconds after which votes don't count; undefined for a poll that never closes. */
  endsAt: number | undefined;
}

/** Read a poll's `option`, `polltype` and `endsAt` tags (Armada's parsePoll). */
export function readPoll(rumor: { tags: string[][] }): ParsedPoll {
  const options: PollOption[] = [];
  let pollType: PollType = "singlechoice";
  let endsAt: number | undefined;
  for (const t of rumor.tags) {
    if (t[0] === "option" && t[1] && t[2]) options.push({ id: t[1], label: t[2] });
    else if (t[0] === "polltype" && t[1] === "multiplechoice") pollType = "multiplechoice";
    else if (t[0] === "endsAt" && t[1]) {
      const n = Number.parseInt(t[1], 10);
      if (Number.isFinite(n)) endsAt = n;
    }
  }
  return { options, pollType, endsAt };
}

/**
 * Read a vote: the poll it names (its `e` tag), its choices (`response` tags)
 * and when it was cast, on the CORD-03 ordering clock (created_at plus the
 * `ms` tag), which decides whose latest vote wins. Null for a vote that names
 * no poll or chooses nothing, which Armada's fold ignores too.
 */
export function readVote(rumor: { pubkey: string; created_at: number; tags: string[][] }): { pollId: string; vote: PollVote } | null {
  const pollId = rumor.tags.find((t) => t[0] === "e")?.[1];
  const optionIds = rumor.tags.filter((t) => t[0] === "response" && t[1]).map((t) => t[1]);
  if (!pollId || optionIds.length === 0) return null;
  return { pollId, vote: { pubkey: rumor.pubkey, optionIds, ms: effectiveTime(rumor) } };
}

/** One voter's choice, as read from a vote. */
export interface PollVote {
  pubkey: string;
  /** The option ids it names (checked against the poll's own by the tally). */
  optionIds: string[];
  /** Its CORD-03 ordering time, in milliseconds: the latest vote per voter wins. */
  ms: number;
}

export interface PollTally {
  /** Option id → how many distinct voters chose it. */
  counts: Map<string, number>;
  /** Distinct voters. Shares are per voter, so a multiple-choice poll's can sum past 100%. */
  totalVoters: number;
  /** What I chose, or undefined when I haven't voted. */
  myVote: Set<string> | undefined;
}

/**
 * A poll, sealed as Armada writes one (CORD.md "Polls", Armada's
 * buildPollTags): kind 1068 whose content is the question, the room's binding
 * tags, one `option` per choice, the poll type, `endsAt` when it closes, and
 * an `alt` for clients that don't know polls. No NIP-88 `relay` tag: votes
 * ride the same sealed room, so there's nowhere else to send them.
 */
export function buildPollRumor(
  author: string, channelId: string, epoch: bigint, question: string, options: PollOption[],
  pollType: PollType, endsAt: number | undefined, ms: number, createdAt: number,
): RumorTemplate {
  const tags: string[][] = [["channel", channelId], ["epoch", epoch.toString()], msTag(ms)];
  for (const o of options) tags.push(["option", o.id, o.label.trim()]);
  tags.push(["polltype", pollType]);
  if (endsAt !== undefined) tags.push(["endsAt", String(endsAt)]);
  tags.push(["alt", `Poll: ${question}`]);
  return { kind: KIND_POLL, pubkey: author, created_at: createdAt, content: question, tags };
}

/**
 * A vote, sealed as Armada writes one (CORD.md "Polls"): kind 1018, empty
 * content, the room's binding tags, the poll it answers, and one `response`
 * per chosen option. No `p` or `k`: Armada sends neither.
 */
export function buildVoteRumor(
  author: string, channelId: string, epoch: bigint, pollId: string, optionIds: string[], ms: number, createdAt: number,
): RumorTemplate {
  return {
    kind: KIND_POLL_VOTE,
    pubkey: author,
    created_at: createdAt,
    content: "",
    tags: [["channel", channelId], ["epoch", epoch.toString()], msTag(ms), ["e", pollId], ...optionIds.map((id) => ["response", id])],
  };
}

/**
 * Count a poll's votes exactly as Armada does (its polls.ts tallyPollVotes,
 * CORD.md "Tally"): each voter's latest vote wins, a vote cast after `endsAt`
 * (unix seconds) is ignored, and a response naming an option the poll never
 * declared is dropped. Every member holding the same votes counts the same.
 */
export function tallyPollVotes(
  votes: PollVote[],
  options: PollOption[],
  endsAt: number | undefined,
  selfPubkey: string | undefined,
): PollTally {
  const latest = new Map<string, PollVote>();
  for (const vote of votes) {
    if (endsAt !== undefined && vote.ms / 1000 > endsAt) continue;
    const seen = latest.get(vote.pubkey);
    if (!seen || vote.ms > seen.ms) latest.set(vote.pubkey, vote);
  }
  const valid = new Set(options.map((o) => o.id));
  const counts = new Map<string, number>();
  for (const vote of latest.values()) {
    for (const id of new Set(vote.optionIds.filter((o) => valid.has(o)))) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const mine = selfPubkey ? latest.get(selfPubkey) : undefined;
  return { counts, totalVoters: latest.size, myVote: mine ? new Set(mine.optionIds) : undefined };
}
