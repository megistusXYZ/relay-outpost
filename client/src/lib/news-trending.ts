/**
 * Client types + pure helpers for the trending-news front page
 * (NEWS_TRENDING_PLAN.md, phase 2). The ranking is computed server-side
 * (/api/news/trending); the client fetches one payload and renders it. This
 * module owns the shape and the read-state annotation — which, per decision 5,
 * DIMS read stories in place and never reorders them: rank leads, read-state
 * is a visual, not the sort key.
 */
import { useSyncExternalStore } from "react";
import { loadRssReadLedger, RSS_READ_LEDGER_KEY } from "./orbit-stories";

/** One clustered story as the server ranks it. */
export interface TrendingStory {
  title: string;
  link: string;
  /** The lead outlet. */
  source: string;
  /** Every distinct outlet covering the story (the corroboration count is
   *  sources.length; also carried as outletCount for convenience). */
  sources: string[];
  outletCount: number;
  thumbnail: string;
  description: string;
  pubDate: string;
  /** Every member outlet's link — so the Nostr-network re-rank (phase 3) can
   *  match a shared URL even when a friend linked a different outlet's copy. */
  memberLinks: string[];
}

export interface TrendingResponse {
  topic: string;
  builtAt: number;
  stories: TrendingStory[];
}

/** A story with its read-state resolved — the shape the list renders. */
export interface AnnotatedStory extends TrendingStory {
  read: boolean;
}

/**
 * Annotate each story with whether it has been read, WITHOUT reordering.
 * A story is read if its own link or ANY member outlet's link is in the ledger
 * — reading BBC's copy marks the whole cluster read, because it is one story.
 * Order is preserved exactly (the server's trending rank); read only dims.
 */
export function annotateReadState(stories: TrendingStory[], readSet: Set<string>): AnnotatedStory[] {
  return stories.map((s) => {
    const links = [s.link, ...s.memberLinks];
    return { ...s, read: links.some((l) => l && readSet.has(l)) };
  });
}

/**
 * How many of the currently-shown stories are new since the reference build —
 * for the "N new since you looked" nudge (decision 5), which surfaces freshness
 * without reordering. A story counts as new when its lead is newer than the
 * last time the user looked at this feed.
 */
export function countNewSince(stories: TrendingStory[], lastSeenMs: number): number {
  if (!lastSeenMs) return 0;
  let n = 0;
  for (const s of stories) {
    const t = Date.parse(s.pubDate);
    if (Number.isFinite(t) && t > lastSeenMs) n++;
  }
  return n;
}

/**
 * Mark a story read in the SHARED ledger (`ro_rss_read_v1`, same key the News
 * reader uses), so opening a trending story dims it here AND in the reader.
 * Writes the lead + all member links, so the cluster reads as one story.
 * Newest-first, capped — mirrors the reader's LRU.
 */
const READ_CAP = 3000;
export function markStoryRead(links: string[]): void {
  try {
    const fresh = links.filter(Boolean);
    if (fresh.length === 0) return;
    const existing = loadRssReadLedger();
    for (const l of fresh) existing.delete(l); // move to front
    const merged = [...fresh, ...existing].slice(0, READ_CAP);
    localStorage.setItem(RSS_READ_LEDGER_KEY, JSON.stringify(merged));
  } catch { /* storage full/blocked — the story just re-shows as unread */ }
}

// ── The rollout flag ─────────────────────────────────────────────────────────
// Default OFF: the trending page lands inert and the existing News reader keeps
// serving until this flips. Same fail-safe shape as the IA/bento flags — only a
// literal "1" turns it on, so a corrupt/half-written value reads as off and the
// proven reader stays.
const FLAG_KEY = "ro_news_trending";
const FLAG_CHANGED = "news-trending-changed";
const ON = "1";

export function isNewsTrendingOn(): boolean {
  try { return localStorage.getItem(FLAG_KEY) === ON; } catch { return false; }
}

export function setNewsTrendingOn(on: boolean): void {
  try { localStorage.setItem(FLAG_KEY, on ? "1" : "0"); } catch { /* storage full/blocked */ }
  try { window.dispatchEvent(new Event(FLAG_CHANGED)); } catch { /* no window */ }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(FLAG_CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(FLAG_CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useNewsTrendingOn(): boolean {
  return useSyncExternalStore(subscribe, () => (isNewsTrendingOn() ? "1" : "0"), () => "0") === "1";
}
