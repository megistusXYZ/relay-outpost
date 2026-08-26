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
 * tenure, the topics they actually post about (top recurring hashtags, and only
 * when they genuinely tag — it fades away otherwise), and one quiet line of
 * lifetime totals (standard social-profile info, not a cadence flex).
 */
import { Sparkles } from "lucide-react";

const DAY = 86_400;

function tenureLabel(joinedAt: number): string {
  // Plain, platform-agnostic wording — a newcomer never has to know what "Nostr"
  // is. Matches the familiar "Joined 2022" convention from mainstream apps.
  const year = new Date(joinedAt * 1000).getFullYear();
  return `Joined ${year}`;
}

/** Bucketed, gentle recency — no exact timestamp. Returns null when the last
 *  activity is old enough that any label would read as a negative judgment; the
 *  caller then simply shows tenure alone. */
export function activityStatus(lastActive: number | undefined, now: number): string | null {
  if (!lastActive) return null;
  const days = (now - lastActive) / DAY;
  if (days < 1) return "Active today";
  if (days < 7) return "Active this week";
  if (days < 31) return "Active this month";
  return null; // older → don't label them "quiet"; tenure carries it.
}

/**
 * A single headline stat (Following / Followers / Posts) in the summary grid.
 *
 * Following and Followers get an `onClick` and render as buttons; Posts has
 * nowhere to go and stays inert. Without this the big bold counts were plain
 * text and the ONLY way into the list was the smaller "Connections" button in
 * the rail — so the same numbers appeared twice and only the less prominent
 * copy responded to a tap.
 */
function Stat({ label, value, onClick }: { label: string; value?: number; onClick?: () => void }) {
  const body = (
    <>
      {/* `undefined` means we never got an answer, and it used to print as
          "0" via `?? 0` — a measured-looking number for a stat nobody
          measured. Primal's cache flaps (~50% of probes returned 502 on
          2026-08-03), so this was routinely a real profile reading
          "0 FOLLOWERS". A real zero still prints 0; only the unknown dashes. */}
      <div className="text-lg font-bold tabular-nums text-foreground">
        {value === undefined ? "—" : value.toLocaleString()}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
    </>
  );
  if (!onClick) return <div className="text-center">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-center rounded-lg py-1 transition-colors hover:bg-primary/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`identity-stat-${label.toLowerCase()}`}
    >
      {body}
    </button>
  );
}

export function IdentityPresence({
  following,
  followers,
  totalPosts,
  totalReplies,
  totalArticles,
  joinedAt,
  lastActiveAt,
  topics,
  onSeeNetwork,
}: {
  following?: number;
  followers?: number;
  totalPosts?: number;
  totalReplies?: number;
  totalArticles?: number;
  joinedAt?: number;
  lastActiveAt?: number;
  /** Top recurring hashtags the person posts about (already ranked, no '#'). */
  topics?: string[];
  /** Opens the following/followers list. Absent ⇒ the counts stay inert. */
  onSeeNetwork?: () => void;
}) {
  const now = Math.floor(Date.now() / 1000);
  const tenureSec = joinedAt ? Math.max(DAY, now - joinedAt) : undefined;
  const isNew = tenureSec !== undefined && tenureSec < 30 * DAY;
  const status = activityStatus(lastActiveAt, now);

  // ONE flowing metadata line — activity, tenure, and secondary totals used to
  // stack on separate rows; now they read as a single "· "-separated sentence.
  // Activity is emphasized (foreground); the rest is quiet. POSTS is omitted (it
  // is already the Posts headline stat above), so nothing is shown twice.
  const metaSegments: { text: string; strong?: boolean }[] = [];
  if (status) metaSegments.push({ text: status, strong: true });
  // Tenure lives in the Details card directly above this one, as "Joined Dec
  // 2021" — the precise form. Repeating a vaguer "Joined 2021" forty pixels
  // below it said the same thing twice and cost the line a segment it could not
  // fit.
  if (totalReplies) metaSegments.push({ text: `${totalReplies.toLocaleString()} replies` });
  if (totalArticles) metaSegments.push({ text: `${totalArticles.toLocaleString()} articles` });

  // "Often posts about #pyramid" — a single tag is not a pattern, and claiming
  // one from a single hashtag is the kind of thin signal the Circle grid already
  // refuses (it needs four faces or it hides). Two or nothing.
  const ranked = (topics ?? []).slice(0, 4);
  const topTopics = ranked.length >= 2 ? ranked : [];
  const hasStats = following !== undefined || followers !== undefined || totalPosts !== undefined;

  // Nothing worth a CARD. The bar is the headline stats, or a summary line with
  // something actually in it — not a single phrase.
  //
  // Seen live while the counts were still in flight: a full-width bordered card
  // whose entire contents were the words "Active today". A card is a promise
  // that something is inside it, and two words is not that. Same rule as the
  // Circle grid (four faces or it hides) and the topics row above.
  const worthACard = hasStats || metaSegments.length >= 2 || topTopics.length > 0 || isNew;
  if (!worthACard) return null;

  // The metadata line + topics form the lower block; it only gets a top divider
  // when the headline stats sit above it.
  const hasLowerBlock = metaSegments.length > 0 || isNew || topTopics.length > 0;

  return (
    // The SAME shell every other card in this column uses — border, elevation
    // and inset all matched. It drifted to its own `p-4` and a flatter border,
    // which put its content 4px deeper than Details and Circle directly above
    // it and made the one card holding the headline numbers look like a
    // leftover. Headerless on purpose: follower counts are the loudest thing on
    // a profile and a small uppercase label above them would demote them.
    <section className="rounded-xl border border-border/60 dark:border-white/[0.07] bg-card p-3 mb-4 shadow-sm shadow-black/[0.04] dark:shadow-none" data-testid="identity-presence">
      {/* Headline stats — folded in from the old separate stats card so the
          identity summary is one block, not two (and "posts" isn't shown twice). */}
      {hasStats && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Following" value={following} onClick={onSeeNetwork} />
          <Stat label="Followers" value={followers} onClick={onSeeNetwork} />
          <Stat label="Posts" value={totalPosts} />
        </div>
      )}

      {hasStats && hasLowerBlock && <div className="mt-3 pt-3 border-t border-border/40" />}

      {(metaSegments.length > 0 || isNew) && (
        <div className="flex items-center flex-wrap gap-x-1.5 gap-y-1 text-sm">
          {metaSegments.map((seg, i) => (
            // The separator trails its own segment rather than leading the next
            // one. When the line wrapped, a leading "·" became the first thing
            // on the second row — "· 301 articles" — which reads as a bullet
            // list that lost its first item.
            <span key={i} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className={seg.strong ? "text-foreground/90 font-medium" : "text-muted-foreground"}>{seg.text}</span>
              {i < metaSegments.length - 1 && <span className="text-muted-foreground/30">·</span>}
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
        <div className="mt-2.5" data-testid="identity-presence-topics">
          <div className="text-[11px] text-muted-foreground/60 mb-1">Often posts about</div>
          <div className="flex flex-wrap gap-1.5">
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
                className="text-[13px] font-medium text-brand no-underline hover:underline"
                data-testid={`identity-topic-${t}`}
              >
                #{t}
              </a>
            ))}
          </div>
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
