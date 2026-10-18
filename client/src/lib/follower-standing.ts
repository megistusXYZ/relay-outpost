/**
 * A new follower, in your terms (owner, 2026-10-18): how your network sees
 * them, in words, and who you follow that follows them too. Followers with no
 * ties to you whom your network doesn't trust, and flagged accounts, are
 * grouped as "outside your network" and don't raise the Activity badge.
 * Before your network has loaded, nobody is grouped away ("unknown").
 */
import type { SignalTier } from "./graperank";

export type FollowerStanding = "trusted" | "known" | "new" | "outside" | "concerns" | "unknown";

export function followerStanding(o: { tier: SignalTier; flagged: boolean; sharedCount: number; ready: boolean }): FollowerStanding {
  if (o.flagged) return "concerns";
  if (o.tier === "strong") return "trusted";
  if (o.tier === "moderate") return "known";
  if (o.sharedCount > 0) return "new";
  return o.ready ? "outside" : "unknown";
}

export function followerTrustWords(s: FollowerStanding): string {
  switch (s) {
    case "trusted": return "Trusted by your network";
    case "known": return "Known to your network";
    case "new": return "New to your network";
    case "outside": return "Not known to your network";
    case "concerns": return "Your network has concerns";
    default: return "";
  }
}

/** "Followed by Alex, Sam and 3 others you follow". `names` are the first few, `total` all of them. */
export function sharedFollowersLine(names: string[], total: number): string {
  if (total <= 0 || names.length === 0) return "";
  if (total === 1) return `Followed by ${names[0]}, who you follow`;
  if (total === 2 && names.length >= 2) return `Followed by ${names[0]} and ${names[1]}, who you follow`;
  const shown = names.slice(0, 2);
  const rest = total - shown.length;
  return `Followed by ${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"} you follow`;
}

export function followerCountsInBadge(s: FollowerStanding): boolean {
  return s !== "outside" && s !== "concerns";
}

export function offersFollowBack(s: FollowerStanding, alreadyFollowing: boolean): boolean {
  return !alreadyFollowing && (s === "trusted" || s === "known");
}
