/**
 * A community's suggestions board: members' public ideas, voted up.
 *
 * A suggestion is a public ticket — an Idea, or anything opened from a public
 * request type (Settings › Member inbox). A vote is a "+" reaction to it
 * (kind 7, NIP-25); one per person, the latest counting; taking a vote back
 * deletes that reaction (kind 5, NIP-09), honoured only from its author.
 * Most votes first; resolved and closed ones listed apart.
 *
 * Pure.
 */
import type { Event as NostrEvent } from "nostr-tools";
import type { FeedbackIssue } from "./nip34-feedback";
import type { TicketTemplate } from "./inbox-settings";

export interface RankedSuggestion {
  issue: FeedbackIssue;
  votes: number;
  /** Your counted vote (the reaction's id), so it can be taken back. */
  myVote: string | null;
}

export function isSuggestion(t: FeedbackIssue, templates: TicketTemplate[] | undefined): boolean {
  if (t.private) return false;
  const from = t.event.tags.find((x) => x[0] === "template")?.[1];
  const tpl = from ? templates?.find((x) => x.id === from) : undefined;
  if (tpl) return tpl.visibility === "public";
  return t.type.includes("idea");
}

export function rankSuggestions(
  issues: FeedbackIssue[],
  reactions: NostrEvent[],
  deletions: NostrEvent[],
  me: string | null,
): { open: RankedSuggestion[]; done: RankedSuggestion[] } {
  const deleted = new Set<string>();
  const authorOf = new Map(reactions.map((r) => [r.id, r.pubkey]));
  for (const d of deletions) for (const t of d.tags) if (t[0] === "e" && authorOf.get(t[1]) === d.pubkey) deleted.add(t[1]);

  // Per suggestion, each person's latest live reaction.
  const latest = new Map<string, Map<string, NostrEvent>>();
  for (const r of reactions) {
    if (r.kind !== 7 || deleted.has(r.id)) continue;
    const on = [...r.tags].reverse().find((t) => t[0] === "e")?.[1];
    if (!on) continue;
    const people = latest.get(on) ?? new Map<string, NostrEvent>();
    const prev = people.get(r.pubkey);
    if (!prev || r.created_at >= prev.created_at) people.set(r.pubkey, r);
    latest.set(on, people);
  }
  const ranked = issues.map((issue): RankedSuggestion => {
    const ups = [...(latest.get(issue.event.id)?.values() ?? [])].filter((r) => r.content.trim() !== "-");
    return { issue, votes: ups.length, myVote: ups.find((r) => r.pubkey === me)?.id ?? null };
  });
  const order = (a: RankedSuggestion, b: RankedSuggestion) => b.votes - a.votes || b.issue.createdAt - a.issue.createdAt;
  const isDone = (s: RankedSuggestion) => s.issue.status === "resolved" || s.issue.status === "closed";
  return { open: ranked.filter((s) => !isDone(s)).sort(order), done: ranked.filter(isDone).sort(order) };
}

/** Vote for a suggestion: a "+" reaction to it. */
export function voteTemplate(suggestion: { id: string; pubkey: string; kind: number }) {
  return { kind: 7, created_at: Math.floor(Date.now() / 1000), content: "+", tags: [["e", suggestion.id], ["p", suggestion.pubkey], ["k", String(suggestion.kind)]] };
}

/** Take a vote back: delete that reaction. */
export function unvoteTemplate(reactionId: string) {
  return { kind: 5, created_at: Math.floor(Date.now() / 1000), content: "", tags: [["e", reactionId], ["k", "7"]] };
}
