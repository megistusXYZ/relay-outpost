/**
 * "Presence" — a calm, human read of who someone is, deliberately NOT a
 * quantified-self / GitHub-contribution dashboard.
 *
 * We dropped the old "Rhythm" card's posts-per-week pace number and 30-day
 * activity sparkline: cadence-as-a-metric quietly judges (it implies a "right"
 * posting volume and makes a thoughtful, low-volume person look "inactive"), and
 * the sparkline read as a literal contribution graph. Neither answers the
 * question a visitor actually has — "is this a real person, and what are they
 * about?"
 *
 * Instead: a warm activity status (bucketed, never a minute-precise "last seen"),
 * the topics they actually post about (top recurring hashtags, and only when
 * they genuinely tag — it fades away otherwise), and one quiet line of lifetime
 * totals (standard social-profile info, not a cadence flex).
 *
 * Where each piece lives (owner call, 2026-09-11): the follower counts and the
 * activity status sit under the name (`IdentityCounts`), as on every social
 * app. They used to lead the main column as a three-number grid, which made
 * them the loudest thing on the page and, on a phone, put them below the
 * fold. What stays here is one quiet line: totals, then topics.
 */
import { Sparkles } from "lucide-react";

const DAY = 86_400;

/** Bucketed, gentle recency — no exact timestamp. Returns null when the last
 *  activity is old enough that any label would read as a negative judgment; the
 *  caller then simply shows nothing. */
export function activityStatus(lastActive: number | undefined, now: number): string | null {
  if (!lastActive) return null;
  const days = (now - lastActive) / DAY;
  if (days < 1) return "Active today";
  if (days < 7) return "Active this week";
  if (days < 31) return "Active this month";
  return null; // older → don't label them "quiet".
}

/** 10,000 and up read as "68.6K"; smaller counts stay exact ("1,980"). */
function countValue(n: number): string {
  if (n < 10_000) return n.toLocaleString();
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/**
 * The counts line under the name: followers, then following. A count we never
 * got is left out, never shown as 0: Primal's cache flaps, and a confident
 * "0 followers" on a real profile is worse than no number. A measured zero
 * still shows.
 */
export function countsLine({ followers, following }: { followers?: number; following?: number }): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  if (followers !== undefined) out.push({ value: countValue(followers), label: followers === 1 ? "follower" : "followers" });
  if (following !== undefined) out.push({ value: countValue(following), label: "following" });
  return out;
}

/** Lifetime totals as short phrases, singular for one. Zero and unknown are
 *  left out: "0 articles" says nothing a visitor needs. */
export function totalsLine({ totalPosts, totalReplies, totalArticles }: { totalPosts?: number; totalReplies?: number; totalArticles?: number }): string[] {
  const phrase = (n: number | undefined, one: string, many: string) =>
    n ? `${n.toLocaleString()} ${n === 1 ? one : many}` : null;
  return [
    phrase(totalPosts, "post", "posts"),
    phrase(totalReplies, "reply", "replies"),
    phrase(totalArticles, "article", "articles"),
  ].filter((p): p is string => p !== null);
}

/**
 * Follower counts and activity status, under the name in the identity card.
 * Both counts open the following/followers list when `onSeeNetwork` is given.
 * The tap area is padded to 44px while the text stays one compact line.
 */
export function IdentityCounts({
  followers,
  following,
  lastActiveAt,
  onSeeNetwork,
}: {
  followers?: number;
  following?: number;
  lastActiveAt?: number;
  onSeeNetwork?: () => void;
}) {
  const counts = countsLine({ followers, following });
  const status = activityStatus(lastActiveAt, Math.floor(Date.now() / 1000));
  if (counts.length === 0 && !status) return null;
  return (
    <div className="mt-2 flex flex-col items-center gap-1.5" data-testid="identity-counts">
      {counts.length > 0 && (
        <div className="flex items-center justify-center flex-wrap gap-x-3 text-[13px]">
          {counts.map((c) => {
            const body = (
              <>
                <span className="font-semibold text-foreground tabular-nums">{c.value}</span>{" "}
                <span className="text-muted-foreground">{c.label}</span>
              </>
            );
            const id = `identity-stat-${c.label === "follower" ? "followers" : c.label}`;
            return onSeeNetwork ? (
              <button
                key={c.label}
                type="button"
                onClick={onSeeNetwork}
                className="inline-flex items-center min-h-11 -my-3 px-1 rounded-md hover:underline underline-offset-4 decoration-muted-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={id}
              >
                <span>{body}</span>
              </button>
            ) : (
              <span key={c.label} data-testid={id}>{body}</span>
            );
          })}
        </div>
      )}
      {status && (
        <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="identity-activity">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          {status}
        </div>
      )}
    </div>
  );
}

export function IdentityPresence({
  totalPosts,
  totalReplies,
  totalArticles,
  joinedAt,
  topics,
}: {
  totalPosts?: number;
  totalReplies?: number;
  totalArticles?: number;
  joinedAt?: number;
  /** Top recurring hashtags the person posts about (already ranked, no '#'). */
  topics?: string[];
}) {
  const now = Math.floor(Date.now() / 1000);
  const isNew = joinedAt !== undefined && Math.max(DAY, now - joinedAt) < 30 * DAY;
  const totals = totalsLine({ totalPosts, totalReplies, totalArticles });

  // "Often posts about #pyramid" — a single tag is not a pattern, and claiming
  // one from a single hashtag is the kind of thin signal the Circle grid already
  // refuses (it needs four faces or it hides). Two or nothing.
  const ranked = (topics ?? []).slice(0, 4);
  const topTopics = ranked.length >= 2 ? ranked : [];
  if (totals.length === 0 && topTopics.length === 0 && !isNew) return null;

  return (
    // No card: one quiet line in the same gutter as the Media shelf below it,
    // so the page's left edge stays one line down the column.
    <section className="mb-4 px-3 space-y-1.5" data-testid="identity-presence">
      {(totals.length > 0 || isNew) && (
        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 text-[13px] text-muted-foreground" data-testid="identity-presence-totals">
          {totals.map((t, i) => (
            // The separator trails its own segment rather than leading the next
            // one, so a wrapped line never starts with a stray "·".
            <span key={t} className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
              {t}
              {i < totals.length - 1 && <span className="text-muted-foreground/30">·</span>}
            </span>
          ))}
          {isNew && (
            <span className="ml-0.5 inline-flex items-center gap-1 rounded-full bg-brand/10 text-brand text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5">
              <Sparkles className="w-3 h-3" /> New here
            </span>
          )}
        </div>
      )}

      {topTopics.length > 0 && (
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[13px]" data-testid="identity-presence-topics">
          <span className="text-muted-foreground/70">Often posts about</span>
          {topTopics.map((t) => (
            <a
              key={t}
              href={`/search?tab=hashtags&q=${encodeURIComponent(`#${t}`)}`}
              onClick={(e) => {
                e.preventDefault();
                const url = `/search?tab=hashtags&q=${encodeURIComponent(`#${t}`)}`;
                window.history.pushState(null, "", url);
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              className="font-medium text-brand no-underline hover:underline"
              data-testid={`identity-topic-${t}`}
            >
              #{t}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Rank the hashtags a person actually posts about, from their loaded notes.
 * Counts both NIP-12 `t` tags and inline `#tags`, keeps only genuinely recurring
 * ones (appears ≥2×) so a single stray tag never becomes a "topic", and returns
 * the most frequent first. Pure + exported for unit testing.
 */
export function rankTopics(
  events: { content: string; tags: string[][] }[],
  cap = 4,
): string[] {
  const counts = new Map<string, number>();
  const inlineRe = /(?:^|\s)#([a-z0-9_]+)/gi;
  const clean = (raw: string): string | null => {
    const t = raw.toLowerCase().replace(/^#/, "").trim();
    // Sane hashtag shape: 2–30 chars, word-ish. Skips URLs/junk.
    if (t.length < 2 || t.length > 30 || !/^[a-z0-9_]+$/.test(t)) return null;
    return t;
  };
  for (const ev of events) {
    // Count each distinct tag at most once PER NOTE, so a hashtag that appears
    // both inline and as a `t` tag in the same post isn't double-counted — "≥2"
    // then means "in ≥2 separate posts", i.e. a genuine recurring theme.
    const perNote = new Set<string>();
    for (const tag of ev.tags) {
      if (tag[0] === "t" && tag[1]) { const c = clean(tag[1]); if (c) perNote.add(c); }
    }
    let m: RegExpExecArray | null;
    inlineRe.lastIndex = 0;
    while ((m = inlineRe.exec(ev.content)) !== null) { const c = clean(m[1]); if (c) perNote.add(c); }
    for (const t of perNote) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([t]) => t);
}
