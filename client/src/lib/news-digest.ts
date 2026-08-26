// Batching + digest for scored News alerts (news-scoring.ts feeds this).
//
// Pure and framework-free: turns a flat list of scored items into typed digest
// groups — by creator when the source is an individual creator ("Huberman Lab ·
// 3 new episodes"), else by category ("Sports · 8 new updates") — sorted by
// each group's top item score. The News page renders these as the Priority
// strip, or collapses them into a single once-per-session digest card when the
// user enables digest-only mode.

import {
  ALERTING_TIERS,
  type AlertTier,
  type ScorableNewsItem,
  type ScoredNewsItem,
} from "@/lib/news-scoring";

export interface DigestGroup<T extends ScorableNewsItem = ScorableNewsItem> {
  /** Stable group key ("creator:<url>" or "category:<name>"). */
  key: string;
  kind: "creator" | "category";
  /** Display label — the creator/source name, or the category. */
  label: string;
  /** "New episode" / "3 new episodes" / "8 new updates". */
  countLabel: string;
  /** Group members, best score first. */
  items: ScoredNewsItem<T>[];
  /** The best item's score (drives group ordering). */
  topScore: number;
}

function countLabel(items: ScoredNewsItem[]): string {
  const n = items.length;
  const podcasts = items.filter((s) => !!s.item.isPodcast).length;
  const unit = podcasts * 2 >= n ? "episode" : "update";
  return n === 1 ? `New ${unit}` : `${n} new ${unit}s`;
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

/**
 * Group scored items into digest groups.
 *
 * - Only items in `tiers` (default: the alerting tiers 1–2) are grouped.
 * - An item from an individual creator (creatorLed) groups under its SOURCE
 *   ("Huberman Lab"); everything else groups under its CATEGORY ("Sports"),
 *   falling back to "News" when the source has no category.
 * - Groups sort by top item score (desc), then size (desc), then label;
 *   items within a group sort by score (desc) — ties keep input order.
 */
export function buildDigestGroups<T extends ScorableNewsItem>(
  scored: ScoredNewsItem<T>[],
  opts: { tiers?: readonly AlertTier[] } = {},
): DigestGroup<T>[] {
  const tiers = new Set<AlertTier>(opts.tiers ?? ALERTING_TIERS);
  const groups = new Map<string, { kind: "creator" | "category"; label: string; items: ScoredNewsItem<T>[] }>();

  for (const s of scored) {
    if (!tiers.has(s.tier)) continue;
    const it = s.item;
    let key: string;
    let kind: "creator" | "category";
    let label: string;
    if (s.creatorLed && (it.sourceUrl || it.sourceName)) {
      kind = "creator";
      key = `creator:${it.sourceUrl || it.sourceName}`;
      label = it.sourceName || hostOf(it.sourceUrl) || "Creator";
    } else {
      kind = "category";
      const cat = (it.sourceCategory || "").trim() || "News";
      key = `category:${cat.toLowerCase()}`;
      label = cat;
    }
    const g = groups.get(key);
    if (g) g.items.push(s);
    else groups.set(key, { kind, label, items: [s] });
  }

  const out: DigestGroup<T>[] = [];
  for (const [key, g] of groups) {
    // Stable sort by score desc (Array.prototype.sort is stable in ES2019+).
    const items = [...g.items].sort((a, b) => b.score - a.score);
    out.push({
      key,
      kind: g.kind,
      label: g.label,
      countLabel: countLabel(items),
      items,
      topScore: items[0]?.score ?? 0,
    });
  }
  out.sort(
    (a, b) =>
      b.topScore - a.topScore ||
      b.items.length - a.items.length ||
      a.label.localeCompare(b.label),
  );
  return out;
}

export interface DigestSummary {
  totalItems: number;
  sourceCount: number;
  /** e.g. "12 new items from 4 sources". */
  headline: string;
}

/** One-line summary for the collapsed digest-only presentation. */
export function digestSummary(groups: DigestGroup[]): DigestSummary {
  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);
  const sources = new Set<string>();
  for (const g of groups) {
    for (const s of g.items) sources.add(s.item.sourceUrl || s.item.sourceName || g.key);
  }
  const sourceCount = sources.size;
  const headline =
    totalItems === 0
      ? "You're all caught up"
      : `${totalItems} new ${totalItems === 1 ? "item" : "items"} from ${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`;
  return { totalItems, sourceCount, headline };
}
