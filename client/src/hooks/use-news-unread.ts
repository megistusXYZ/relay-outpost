/**
 * Priority-News unread count, read entirely from data ALREADY on the device —
 * the react-query RSS cache plus the News read-ledger. No new relay or network
 * work; recomputed on mount, on window focus, and on a slow interval so the
 * badge stays honest without polling anything.
 *
 * Lifted out of DesktopStoriesRail so the mobile footer can show the same number
 * instead of computing its own. The footer used to hardcode its tabs and had no
 * news badge at all; under the collapsed IA, News lives inside Discover and its
 * count rolls up there — which only works if both surfaces agree on the count.
 */
import { useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { DEFAULT_FEEDS, loadCustomFeeds, loadHiddenDefaults } from "@/lib/rss-feeds";
import { loadNewsAlertPrefs } from "@/lib/news-alert-settings";
import { computePriorityNewsUnread, loadRssReadLedger, type RssCachedItemLite } from "@/lib/orbit-stories";

/** How often to recompute in the background. Cheap (local reads only). */
const REFRESH_MS = 90_000;

export function useNewsUnread(): number {
  const [newsUnread, setNewsUnread] = useState(0);

  useEffect(() => {
    const recompute = () => {
      try {
        const cached = queryClient
          .getQueriesData<{ items?: RssCachedItemLite[] }>({ queryKey: ["/api/rss"] })
          .map(([key, data]) => ({
            url: typeof key[1] === "string" ? key[1] : undefined,
            items: data?.items,
          }));
        const hidden = loadHiddenDefaults();
        const savedFeeds = [...DEFAULT_FEEDS.filter((f) => !hidden.has(f.url)), ...loadCustomFeeds()];
        const prefs = loadNewsAlertPrefs();
        const summary = computePriorityNewsUnread(cached, savedFeeds, loadRssReadLedger(), Date.now(), {
          mutedSources: prefs.mutedSources,
          mutedKeywords: prefs.mutedKeywords,
          onlyPresets: prefs.onlyPresets,
          onlyCreators: prefs.onlyCreators,
        });
        setNewsUnread(summary.count);
      } catch {
        setNewsUnread(0);
      }
    };
    recompute();
    const onFocus = () => recompute();
    window.addEventListener("focus", onFocus);
    const interval = setInterval(recompute, REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, []);

  return newsUnread;
}
