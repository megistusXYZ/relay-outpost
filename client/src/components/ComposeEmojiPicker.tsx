import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { SmilePlus, ExternalLink, Search} from "lucide-react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { useCustomEmojis, type CustomEmoji } from "@/hooks/use-custom-emojis";
import {
  EMOJI_CATEGORIES,
  getEmojisByCategory,
  searchEmojis,
  getFrequentEmojis,
  trackFrequentEmoji,
  getCategoryIcon,
  type EmojiItem } from "@/lib/emoji-data";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

type TabId = "emoji" | "stickers" | "gifs";

interface ComposeEmojiPickerProps {
  onInsert: (text: string, emoji?: CustomEmoji) => void;
  onGifSelect?: (url: string) => void;
  disabled?: boolean;
  /** Hide the Stickers tab (e.g. encrypted-outpost chat, where stickers don't fit). */
  hideStickers?: boolean;
}

interface GifResult {
  id: string;
  url: string;
  preview_url: string;
  dims: [number, number];
  description: string;
}

export function ComposeEmojiPicker({ onInsert, onGifSelect, disabled, hideStickers }: ComposeEmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("emoji");
  const { emojis } = useCustomEmojis();

  const [emojiSearch, setEmojiSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("frequent");

  const [gifSearch, setGifSearch] = useState("");
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [gifNext, setGifNext] = useState("");
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState("");
  const gifDebounce = useRef<ReturnType<typeof setTimeout>>();
  const gifFetched = useRef(false);

  const grouped = useMemo(() => {
    const map = new Map<string, CustomEmoji[]>();
    for (const e of emojis) {
      const list = map.get(e.packName) || [];
      list.push(e);
      map.set(e.packName, list);
    }
    return map;
  }, [emojis]);

  const filteredEmojis = useMemo(() => {
    if (emojiSearch.trim()) return searchEmojis(emojiSearch);
    return getEmojisByCategory(selectedCategory);
  }, [emojiSearch, selectedCategory]);

  const frequentEmojis = useMemo(() => getFrequentEmojis(), [open]);

  const handleEmojiClick = useCallback((item: EmojiItem) => {
    trackFrequentEmoji(item.emoji);
    onInsert(item.emoji);
    setOpen(false);
  }, [onInsert]);

  const handleStickerClick = useCallback((emoji: CustomEmoji) => {
    onInsert(`:${emoji.shortcode}:`, emoji);
    setOpen(false);
  }, [onInsert]);

  const loadMoreGifs = useCallback(async (query: string, pos: string) => {
    if (!pos) return;
    setGifLoading(true);
    try {
      const endpoint = query
        ? `/api/gifs/search?q=${encodeURIComponent(query)}&limit=20&pos=${encodeURIComponent(pos)}`
        : `/api/gifs/trending?limit=20&pos=${encodeURIComponent(pos)}`;
      const resp = await fetch(endpoint);
      if (!resp.ok) return;
      const data = await resp.json();
      setGifs((prev) => [...prev, ...(data.results || [])]);
      setGifNext(data.next || "");
    } catch {} finally {
      setGifLoading(false);
    }
  }, []);

  const handleGifClick = useCallback((gif: GifResult) => {
    if (onGifSelect) {
      onGifSelect(gif.url);
    } else {
      onInsert(`\n${gif.url}\n`);
    }
    setOpen(false);
  }, [onInsert, onGifSelect]);

  const gifRequestId = useRef(0);

  useEffect(() => {
    if (tab !== "gifs" || !open) return;
    if (gifFetched.current && !gifSearch) return;
    clearTimeout(gifDebounce.current);
    const id = ++gifRequestId.current;
    gifDebounce.current = setTimeout(() => {
      setGifLoading(true);
      setGifError("");
      const endpoint = gifSearch
        ? `/api/gifs/search?q=${encodeURIComponent(gifSearch)}&limit=20`
        : `/api/gifs/trending?limit=20`;
      fetch(endpoint)
        .then((r) => r.ok ? r.json() : r.json().then((e) => Promise.reject(e.error || "Failed")))
        .then((data) => {
          if (gifRequestId.current !== id) return;
          setGifs(data.results || []);
          setGifNext(data.next || "");
          if (!gifSearch) gifFetched.current = true;
        })
        .catch((err) => {
          if (gifRequestId.current !== id) return;
          setGifError(typeof err === "string" ? err : "Failed to load GIFs");
        })
        .finally(() => {
          if (gifRequestId.current === id) setGifLoading(false);
        });
    }, gifSearch ? 300 : 0);
    return () => clearTimeout(gifDebounce.current);
  }, [tab, open, gifSearch]);

  useEffect(() => {
    if (!open) {
      setEmojiSearch("");
      setGifSearch("");
      setGifs([]);
      setGifNext("");
      setGifError("");
      gifFetched.current = false;
      gifRequestId.current++;
    }
  }, [open]);

  const tabBtnClass = (t: TabId) =>
    `flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
      tab === t
        ? "bg-brand/15 text-brand"
        : "text-primary/50 hover:text-primary/70 hover:bg-brand/5"
    }`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          // shrink-0: a fixed-size icon button has no business absorbing a
          // flex row's overflow. Without it this was the only shrinkable item
          // in the chat composer and got squeezed from 32px to 18.
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-md text-brand/60 hover:text-brand/90 hover:bg-brand/10 dark:hover:bg-brand/15 transition-colors cursor-pointer disabled:opacity-40"
          disabled={disabled}
          onClick={(e) => e.stopPropagation()}
          data-testid="button-compose-emoji-picker"
        >
          <SmilePlus className="w-[18px] h-[18px]" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className={cn(
            "w-72 sm:w-80 p-0 border-brand/20 bg-[rgba(242,238,255,0.98)] dark:bg-[rgba(4,4,10,0.97)] z-[200]",
            "rounded-md border shadow-md outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
          )}
          side="top"
          align="start"
          sideOffset={4}
          collisionPadding={16}
          onClick={(e) => e.stopPropagation()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("[data-testid='button-compose-emoji-picker']")) {
              e.preventDefault();
            }
          }}
        >
        <div className="flex gap-1 p-1.5 border-b border-brand/10">
          <button type="button" className={tabBtnClass("emoji")} onClick={() => setTab("emoji")}>
            😀 Emoji
          </button>
          {!hideStickers && (
            <button type="button" className={tabBtnClass("stickers")} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setTab("stickers"); }}>
              ✨ Stickers
            </button>
          )}
          <button type="button" className={tabBtnClass("gifs")} onClick={(e) => { e.stopPropagation(); e.preventDefault(); setTab("gifs"); }}>
            GIF
          </button>
        </div>

        {tab === "emoji" && (
          <div className="flex flex-col">
            <div className="px-2 pt-2 pb-1">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand/30" />
                <input
                  type="text"
                  value={emojiSearch}
                  onChange={(e) => setEmojiSearch(e.target.value)}
                  placeholder="Search emoji..."
                  className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-brand/5 dark:bg-brand/10 border border-brand/10 focus:border-brand/30 focus:outline-none text-brand placeholder:text-brand/30"
                />
              </div>
            </div>
            {!emojiSearch && (
              <div className="flex gap-0.5 px-2 pb-1 overflow-x-auto">
                {EMOJI_CATEGORIES.filter((c) => c.id !== "frequent" || frequentEmojis.length > 0).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`w-7 h-7 flex items-center justify-center rounded text-sm shrink-0 transition-colors cursor-pointer ${
                      selectedCategory === cat.id
                        ? "bg-brand/15"
                        : "hover:bg-brand/5"
                    }`}
                    title={cat.label}
                  >
                    {getCategoryIcon(cat.id)}
                  </button>
                ))}
              </div>
            )}
            <div className="px-2 pb-2 max-h-52 overflow-y-auto">
              {!emojiSearch && !filteredEmojis.length && selectedCategory === "frequent" ? (
                <p className="text-[10px] text-brand/30 text-center py-4">
                  Your frequently used emoji will appear here
                </p>
              ) : filteredEmojis.length === 0 ? (
                <p className="text-[10px] text-brand/30 text-center py-4">No emoji found</p>
              ) : (
                <>
                  {!emojiSearch && (
                    <p className="text-[10px] font-display text-brand/70 dark:text-brand/60 px-0.5 mb-1">
                      {EMOJI_CATEGORIES.find((c) => c.id === selectedCategory)?.label}
                    </p>
                  )}
                  <div className="grid grid-cols-8 gap-0.5">
                    {filteredEmojis.map((item) => (
                      <button
                        key={item.emoji + item.name}
                        type="button"
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-brand/10 dark:hover:bg-brand/15 transition-colors cursor-pointer text-xl"
                        onClick={(e) => { e.stopPropagation(); handleEmojiClick(item); }}
                        title={item.name}
                      >
                        {item.emoji}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {tab === "stickers" && !hideStickers && (
          <div>
            <div className="p-2 max-h-56 overflow-y-auto">
              {Array.from(grouped.entries()).map(([packName, packEmojis]: [string, CustomEmoji[]]) => (
                <div key={packName} className="mb-2 last:mb-0">
                  <p className="text-[10px] font-display text-brand/70 dark:text-brand/60 px-1 mb-1 truncate">{packName}</p>
                  <div className="grid grid-cols-6 sm:grid-cols-7 gap-1">
                    {packEmojis.map((emoji) => (
                      <button
                        key={emoji.shortcode}
                        type="button"
                        className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg hover:bg-brand/10 dark:hover:bg-brand/15 transition-colors cursor-pointer"
                        onClick={(e) => { e.stopPropagation(); handleStickerClick(emoji); }}
                        title={`:${emoji.shortcode}:`}
                        disabled={disabled}
                      >
                        <img
                          src={emoji.url}
                          alt={emoji.shortcode}
                          className="w-7 h-7 sm:w-6 sm:h-6 object-contain"
                          loading="eager"
                          decoding="async"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <a
              href="https://emojiverse.shakespeare.wtf/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] text-brand/50 dark:text-brand/40 hover:text-brand-strong/80 dark:hover:text-brand-strong/70 transition-colors border-t border-brand/10"
              onClick={(e) => e.stopPropagation()}
            >
              Explore more on EmojiVerse
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        )}

        {tab === "gifs" && (
          <div className="flex flex-col">
            <div className="px-2 pt-2 pb-1">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand/30" />
                <input
                  type="text"
                  value={gifSearch}
                  onChange={(e) => setGifSearch(e.target.value)}
                  placeholder="Search GIFs..."
                  className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-brand/5 dark:bg-brand/10 border border-brand/10 focus:border-brand/30 focus:outline-none text-brand placeholder:text-brand/30"
                />
              </div>
            </div>
            <div className="px-2 pb-1 max-h-56 overflow-y-auto">
              {gifError === "GIF search not configured" ? (
                <p className="text-[10px] text-brand/30 text-center py-6">GIF search not configured</p>
              ) : gifError ? (
                <p className="text-[10px] text-red-700 dark:text-red-400 text-center py-4">{gifError}</p>
              ) : gifs.length === 0 && !gifLoading ? (
                <p className="text-[10px] text-brand/30 text-center py-6">
                  {gifSearch ? "No GIFs found" : "Loading trending GIFs..."}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1">
                    {gifs.map((gif) => (
                      <button
                        key={gif.id}
                        type="button"
                        className="rounded-lg overflow-hidden hover:ring-2 hover:ring-brand/40 transition-all cursor-pointer bg-brand/5"
                        onClick={(e) => { e.stopPropagation(); handleGifClick(gif); }}
                        title={gif.description}
                      >
                        <img
                          src={gif.preview_url}
                          alt={gif.description}
                          className="w-full h-24 object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                  {gifNext && !gifLoading && (
                    <button
                      type="button"
                      onClick={() => loadMoreGifs(gifSearch, gifNext)}
                      className="w-full py-2 text-[10px] text-brand/60 hover:text-brand-strong/90 transition-colors cursor-pointer"
                    >
                      Load more
                    </button>
                  )}
                </>
              )}
              {gifLoading && (
                <div className="flex justify-center py-3">
                  <RelayOutpostInlineLoader className="w-4 h-4 text-brand/50" />
                </div>
              )}
            </div>
            <div className="px-2 py-1 border-t border-brand/10">
              <p className="text-[8px] text-brand/20 text-center">Powered by KLIPY</p>
            </div>
          </div>
        )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function useEmojiTags() {
  const usedEmojisRef = useRef<Map<string, string>>(new Map());

  const trackEmoji = useCallback((emoji: CustomEmoji) => {
    usedEmojisRef.current.set(emoji.shortcode, emoji.url);
  }, []);

  const getEmojiTags = useCallback((content?: string): string[][] => {
    const tags: string[][] = [];
    usedEmojisRef.current.forEach((url, shortcode) => {
      if (content && !content.includes(`:${shortcode}:`)) return;
      tags.push(["emoji", shortcode, url]);
    });
    return tags;
  }, []);

  const clearEmojiTags = useCallback(() => {
    usedEmojisRef.current.clear();
  }, []);

  return { trackEmoji, getEmojiTags, clearEmojiTags };
}
