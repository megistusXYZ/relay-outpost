/**
 * Network card for the identity layout's LEFT RAIL — the counts, and the way
 * into the full lists.
 *
 * It used to carry a facepile, and the facepile was drawn from the profile's
 * FOLLOWING list. That made a claim the data doesn't support: a row of faces
 * under someone's name reads as "these people are connected to them", when
 * following is something the subject did TO those people, unilaterally and
 * without their consent. On an account that follows Jack Dorsey, Jack's face
 * appeared as one of their connections. He isn't one.
 *
 * The rule that settled it is the same one Circle was built on: faces on a
 * person's profile may only ever be people who chose THEM. Following is a claim
 * they make about others; followers are a claim others make about them.
 *
 * So the faces live in exactly one place now — Circle, which shows mutuals, the
 * only tie that required both sides to agree. This row keeps the numbers, with
 * followers first because that is the earned one. An account nobody follows
 * back shows no faces anywhere, which is the un-gameable signal working rather
 * than something missing.
 */
import { Users } from "lucide-react";

/** Compact count so "198,507" doesn't overflow the 320px rail → "198.5K". */
function abbrev(n?: number): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`;
  return v.toLocaleString();
}

export function IdentityNetworkCard({
  following,
  followers,
  onSeeAll,
}: {
  following?: number;
  followers?: number;
  onSeeAll: () => void;
}) {
  // FOLLOWING first, then followers — the order the profile owner reads it in,
  // and the one that leads with a list you can actually act on (people they
  // chose) rather than a popularity number.
  const parts: string[] = [];
  if (following !== undefined) parts.push(`${abbrev(following)} following`);
  if (followers !== undefined) parts.push(`${abbrev(followers)} followers`);
  return (
    // Two lines, not one. Labelled counts ("199K followers · 1.1K following")
    // cannot fit beside a label on one 36px row in a 320px rail — they were
    // clipping mid-word. Stacking them costs a few pixels of height, which the
    // rail has, and fits every count at every width without truncation. A
    // pill-shaped row is dropped for a rounded card for the same reason.
    <button
      onClick={onSeeAll}
      className="w-full flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 hover:bg-muted/70 px-3 py-2 text-left transition-colors"
      data-testid="identity-network-card"
      title="See connections"
    >
      <Users className="w-4 h-4 text-muted-foreground/60 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground/90 leading-tight">Connections</span>
      {/* Labelled, because "24K · 407" leaves the reader to guess which is which.

          An UNKNOWN count is omitted, never printed as zero. The follower count
          comes from a stats source that simply has nothing for some profiles,
          and the old code collapsed that into 0 — so a profile with hundreds of
          thousands of followers announced "0". Silence is accurate; a zero is a
          claim, and here it was a false one. */}
        {parts.length > 0 && (
          <span className="block text-xs text-muted-foreground/70 tabular-nums leading-tight mt-0.5 truncate">
            {parts.join(" · ")}
          </span>
        )}
      </span>
    </button>
  );
}
