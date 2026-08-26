import { useState, useEffect, useRef, useCallback } from "react";
import { pool, DEFAULT_RELAYS } from "@/lib/nostr";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { withSignerTimeout, SIGNER_SIGN_TIMEOUT } from "@/lib/signer-timeout";

export interface CustomEmoji {
  shortcode: string;
  url: string;
  packName: string;
}

interface CustomEmojiState {
  emojis: CustomEmoji[];
  loading: boolean;
  loaded: boolean;
  addPack: (packRef: string) => Promise<void>;
}

const B = "https://blossom.primal.net/";

const DEFAULT_CUSTOM_EMOJIS: CustomEmoji[] = [
  { shortcode: "GM_Smile", url: `${B}25b937518340c5b469ca9e1727c8842f2ba02c2a0a7275be174bf3494ce195b0.gif`, packName: "GM" },
  { shortcode: "GM_coffee", url: `${B}cfcdc98645630483e08fb34558b29c08ebee45f506897bd4067b92b3029fbf8f.gif`, packName: "GM" },
  { shortcode: "GM_hug", url: `${B}13dd82d91092b5f41301fde4d7601914981383563b7e33e59819843fb953ec0b.gif`, packName: "GM" },
  { shortcode: "GM_kiss", url: `${B}1d209a156972bf2ef81dcadfc3548849118043c84ca0add8609af49fba921a84.gif`, packName: "GM" },
  { shortcode: "GM_Love_Monster", url: `${B}29f79df3d587c64ca2db1fd3ccca453025ae8aa67a127fa1af3eb66d295b5678.gif`, packName: "GM" },
  { shortcode: "GM_cute_bear", url: `${B}192f8435918cb486d7a5beb6333a038b76714a907b954c93da49eb6ff1c58c94.gif`, packName: "GM" },
  { shortcode: "GM_Monkey", url: `${B}7dd41ccc4918a533f3dd8dcf53b24f071fd4dd3e5f7f89d05d2fd1c3503308ac.gif`, packName: "GM" },
  { shortcode: "GM_sun", url: `${B}7c58e9ab475e2aad340f1bd0a7faf97c35b5b476f7ce0cfda2a9580d622cac8f.gif`, packName: "GM" },
  { shortcode: "GM_Balloon", url: `${B}070c55815aba8109e90d66688ed2547fac6943ac09986ab0ba0d111b496d9173.gif`, packName: "GM" },
  { shortcode: "GM_scream", url: `${B}aef17c5018195a186e778c537fdb797997906171b85d621e630ad6166847d95c.gif`, packName: "GM" },
  { shortcode: "GM_cloud_lightning", url: `${B}2059934e11445bed380a3a163a8ca96aa264b0d5b42ab25d1e3abacd8afc920f.gif`, packName: "GM" },
  { shortcode: "GM_drip", url: `${B}213e453b33e8f5861b38ec5a086bdcb6be8f70db3daf66a96963da5be99038ff.gif`, packName: "GM" },
  { shortcode: "GM_Monster", url: `${B}c37dee1012413cf6c98ffbef92a021d5d6b95a0dcaf87d7316f27ab5108b4dcd.gif`, packName: "GM" },
  { shortcode: "GM_POPbom", url: `${B}2cb9569773dcb48a81bd275cfc85d776d921a20ce3a751d7f9ce17c12c2e3c8e.gif`, packName: "GM" },
  { shortcode: "GM", url: `${B}63b855b87873fc7e6a25348aa1962c50b1241ddcb3e1b5a57f21644a7c1e792e.gif`, packName: "GM" },
  { shortcode: "Nostr_run", url: `${B}f485ab5266b58247cbd7c97ac60b7fc9809edfdd108009f6d0117f7ed1e1520c.gif`, packName: "Nostr" },
  { shortcode: "Nostrich_run", url: `${B}162f7aeff5df7b263b5be74e534a411a857c8e3152b150893edac71d56009298.gif`, packName: "Nostr" },
  { shortcode: "LightningMan", url: `${B}7e04f9e9f875e11e8a0070f6643f2e35f55d17061b1df4dea94a3afb0a82e5b9.gif`, packName: "Zaps" },
  { shortcode: "LN_bot", url: `${B}71f1a99d801e272f8790678d0f42589a32ed79e268fa8869e42e98bf9c8436b9.gif`, packName: "Zaps" },
  { shortcode: "Bot_dance", url: `${B}42cebdbaab90bb1afebe9f9dc27270d311bd78e93e7323294e1b56c92ea101bd.gif`, packName: "Zaps" },
];

const emojiCache = new Map<string, CustomEmoji[]>();

function mergeWithDefaults(userEmojis: CustomEmoji[]): CustomEmoji[] {
  const seen = new Set<string>();
  const result: CustomEmoji[] = [];
  for (const e of userEmojis) {
    if (!seen.has(e.shortcode)) {
      seen.add(e.shortcode);
      result.push(e);
    }
  }
  for (const e of DEFAULT_CUSTOM_EMOJIS) {
    if (!seen.has(e.shortcode)) {
      seen.add(e.shortcode);
      result.push(e);
    }
  }
  return result;
}

export function useCustomEmojis(): CustomEmojiState {
  const { pubkey } = useNostrAuth();
  const [emojis, setEmojis] = useState<CustomEmoji[]>(DEFAULT_CUSTOM_EMOJIS);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(true);
  const fetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pubkey) {
      setEmojis(DEFAULT_CUSTOM_EMOJIS);
      setLoaded(true);
      fetchedForRef.current = null;
      return;
    }

    if (fetchedForRef.current === pubkey) return;
    fetchedForRef.current = pubkey;

    const cached = emojiCache.get(pubkey);
    if (cached) {
      setEmojis(mergeWithDefaults(cached));
      setLoaded(true);
      return;
    }

    setEmojis(DEFAULT_CUSTOM_EMOJIS);
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const relays = DEFAULT_RELAYS.slice(0, 4);

        const emojiListEvents = await Promise.race([
          pool.querySync(relays, { kinds: [10030], authors: [pubkey], limit: 1 }),
          new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000)),
        ]) as any[];

        if (cancelled) return;

        const emojiListEvent = emojiListEvents.sort((a, b) => b.created_at - a.created_at)[0];
        if (!emojiListEvent) {
          if (!cancelled) {
            emojiCache.set(pubkey, []);
            setEmojis(DEFAULT_CUSTOM_EMOJIS);
            setLoaded(true);
            setLoading(false);
          }
          return;
        }

        const packRefs: string[] = [];
        const inlineEmojis: CustomEmoji[] = [];

        for (const tag of emojiListEvent.tags) {
          if (tag[0] === "a" && tag[1]) {
            packRefs.push(tag[1]);
          }
          if (tag[0] === "emoji" && tag[1] && tag[2]) {
            inlineEmojis.push({ shortcode: tag[1], url: tag[2], packName: "My Emojis" });
          }
        }

        const userEmojis: CustomEmoji[] = [...inlineEmojis];

        if (packRefs.length > 0) {
          const packFilters = packRefs.map((ref) => {
            const parts = ref.split(":");
            if (parts.length >= 3 && parseInt(parts[0]) === 30030) {
              return { kind: 30030, authors: [parts[1]], "#d": [parts.slice(2).join(":")] };
            }
            return null;
          }).filter(Boolean) as any[];

          if (packFilters.length > 0) {
            const batchSize = 5;
            for (let i = 0; i < packFilters.length; i += batchSize) {
              if (cancelled) return;
              const batch = packFilters.slice(i, i + batchSize);
              const packResults = await Promise.race([
                Promise.all(batch.map((f: any) => pool.querySync(relays, { ...f, limit: 1 }))),
                new Promise<any[][]>((resolve) => setTimeout(() => resolve(batch.map(() => [])), 6000)),
              ]) as any[][];

              for (const packEvents of packResults) {
                if (!packEvents || packEvents.length === 0) continue;
                const pack = packEvents.sort((a: any, b: any) => b.created_at - a.created_at)[0];
                const packName = pack.tags.find((t: string[]) => t[0] === "d")?.[1] || "Emoji Pack";
                for (const tag of pack.tags) {
                  if (tag[0] === "emoji" && tag[1] && tag[2]) {
                    userEmojis.push({ shortcode: tag[1], url: tag[2], packName });
                  }
                }
              }
            }
          }
        }

        if (!cancelled) {
          const seen = new Set<string>();
          const deduped = userEmojis.filter((e) => {
            if (seen.has(e.shortcode)) return false;
            seen.add(e.shortcode);
            return true;
          });
          emojiCache.set(pubkey, deduped);
          setEmojis(mergeWithDefaults(deduped));
          setLoaded(true);
        }
      } catch (err) {
        console.error("[CustomEmojis] Failed to fetch emoji packs:", err);
        if (!cancelled) {
          setEmojis(DEFAULT_CUSTOM_EMOJIS);
          setLoaded(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pubkey]);

  const addPack = useCallback(async (packRef: string) => {
    if (!pubkey) return;
    try {
      const relays = DEFAULT_RELAYS.slice(0, 4);
      const parts = packRef.split(":");
      if (parts.length < 3 || parseInt(parts[0]) !== 30030) return;

      const packEvents = await Promise.race([
        pool.querySync(relays, { kinds: [30030], authors: [parts[1]], "#d": [parts.slice(2).join(":")], limit: 1 }),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000)),
      ]) as any[];

      const pack = packEvents.sort((a: any, b: any) => b.created_at - a.created_at)[0];
      if (!pack) return;

      const packName = pack.tags.find((t: string[]) => t[0] === "d")?.[1] || "Emoji Pack";
      const newEmojis: CustomEmoji[] = [];
      for (const tag of pack.tags) {
        if (tag[0] === "emoji" && tag[1] && tag[2]) {
          newEmojis.push({ shortcode: tag[1], url: tag[2], packName });
        }
      }

      const existingList = await Promise.race([
        pool.querySync(relays, { kinds: [10030], authors: [pubkey], limit: 1 }),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 6000)),
      ]) as any[];

      const existing = existingList.sort((a: any, b: any) => b.created_at - a.created_at)[0];
      const tags: string[][] = existing
        ? existing.tags.filter((t: string[]) => !(t[0] === "a" && t[1] === packRef))
        : [];
      tags.push(["a", packRef]);

      const event = {
        kind: 10030,
        content: "",
        tags,
        created_at: Math.floor(Date.now() / 1000),
      };

      if (typeof window !== "undefined" && (window as any).nostr) {
        const signed = await withSignerTimeout((window as any).nostr.signEvent(event), SIGNER_SIGN_TIMEOUT, "signEvent");
        await Promise.allSettled(relays.map((r) => pool.publish([r], signed)));
      }

      setEmojis((prev) => {
        const seen = new Set(prev.map((e) => e.shortcode));
        const additions = newEmojis.filter((e) => !seen.has(e.shortcode));
        const updated = [...additions, ...prev];
        emojiCache.set(pubkey, updated.filter((e) => !DEFAULT_CUSTOM_EMOJIS.some((d) => d.shortcode === e.shortcode)));
        return updated;
      });
    } catch (err) {
      console.error("[CustomEmojis] Failed to add pack:", err);
    }
  }, [pubkey]);

  return { emojis, loading, loaded, addPack };
}

export function isCustomEmoji(content: string): boolean {
  return /^:[a-zA-Z0-9_]+:$/.test(content);
}

export function getCustomEmojiShortcode(content: string): string | null {
  const match = content.match(/^:([a-zA-Z0-9_]+):$/);
  return match ? match[1] : null;
}
