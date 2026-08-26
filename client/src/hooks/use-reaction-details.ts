import { useState, useCallback, useRef } from "react";
import { pool, DEFAULT_RELAYS, fetchProfilesCached, eventStore } from "@/lib/nostr";

export interface Reactor {
  pubkey: string;
  createdAt: number;
}

export interface EmojiGroup {
  emoji: string;
  displayEmoji: string;
  count: number;
  reactors: Reactor[];
  imageUrl?: string;
}

function normalizeEmoji(content: string): string {
  if (content === "+" || content === "" || content === "\u2764\uFE0F" || content === "\u2764") return "\u2764\uFE0F";
  if (content === "-") return "\u{1F44E}";
  return content;
}

function getCustomEmojiUrl(ev: any): string | undefined {
  const emojiTag = ev.tags?.find((t: string[]) => t[0] === "emoji" && t[1] && t[2]);
  return emojiTag?.[2];
}

export function useReactionDetails(eventId: string) {
  const [groups, setGroups] = useState<EmojiGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const fetchedRef = useRef(false);

  const fetch = useCallback(async () => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);

    try {
      const relays = DEFAULT_RELAYS.slice(0, 3);
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [7],
          "#e": [eventId],
          limit: 100,
        }),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000)),
      ]) as any[];

      const localEvents = [...eventStore.getByFilters({ kinds: [7] })].filter(
        (e) => e.tags.some((t) => t[0] === "e" && t[1] === eventId)
      );

      const allEvents = [...events, ...localEvents];
      const seen = new Set<string>();
      const groupMap = new Map<string, Reactor[]>();
      const groupImageUrls = new Map<string, string>();

      for (const ev of allEvents) {
        const emoji = normalizeEmoji(ev.content);
        const key = `${ev.pubkey}-${emoji}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const existing = groupMap.get(emoji) || [];
        existing.push({ pubkey: ev.pubkey, createdAt: ev.created_at });
        groupMap.set(emoji, existing);

        if (!groupImageUrls.has(emoji)) {
          const imgUrl = getCustomEmojiUrl(ev);
          if (imgUrl) groupImageUrls.set(emoji, imgUrl);
        }
      }

      const result: EmojiGroup[] = [];
      for (const [emoji, reactors] of groupMap) {
        result.push({
          emoji,
          displayEmoji: emoji,
          count: reactors.length,
          reactors: reactors.sort((a, b) => b.createdAt - a.createdAt),
          imageUrl: groupImageUrls.get(emoji),
        });
      }
      result.sort((a, b) => b.count - a.count);

      setGroups(result);
      setFetched(true);

      const pubkeys = Array.from(new Set(allEvents.map(e => e.pubkey)));
      if (pubkeys.length > 0) {
        fetchProfilesCached(pubkeys);
      }
    } catch (err) {
      console.error("Failed to fetch reaction details:", err);
      setFetched(true);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  return { groups, loading, fetched, fetch };
}
