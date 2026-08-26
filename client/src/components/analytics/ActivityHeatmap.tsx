import { useState, useCallback, useMemo, useEffect } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { pool, DEFAULT_RELAYS, throttledPoolSubscribe, eventStore } from "@/lib/nostr";
import { getProfileContent, getAvatarUrl } from "@/lib/nostr-helpers";
import { format, subDays, startOfWeek, addDays, differenceInDays, parseISO, startOfDay, endOfDay } from "date-fns";
import {
  CalendarDays, Flame, Activity, Search, X,
  MessageSquare, Repeat2, Heart, Zap, FileText, Image,
  Video, Bookmark, ChevronDown, ChevronUp, Calendar,
  ArrowLeft, Eye, Send, Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import { ProfileLink } from "./ProfileLink";
import { Link } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const TIME_RANGES = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "Custom", days: -1 },
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const KIND_LABELS: Record<number, string> = {
  0: "Profile Update",
  1: "Text Note",
  4: "DM",
  6: "Repost",
  7: "Reaction",
  20: "Picture",
  21: "Video",
  1111: "Comment",
  9735: "Zap Receipt",
  10003: "Bookmark",
  30023: "Long-form Article" };

const KIND_ICONS: Record<number, typeof MessageSquare> = {
  1: FileText,
  4: Send,
  6: Repeat2,
  7: Heart,
  20: Image,
  21: Video,
  9735: Zap,
  10003: Bookmark,
  30023: FileText };

function getKindLabel(kind: number): string {
  return KIND_LABELS[kind] || `Kind ${kind}`;
}

function getKindIcon(kind: number) {
  return KIND_ICONS[kind] || FileText;
}

function getKindColor(kind: number): string {
  switch (kind) {
    case 1: return "text-blue-700 dark:text-blue-400";
    case 4: return "text-green-800 dark:text-green-400";
    case 6: return "text-emerald-800 dark:text-emerald-400";
    case 7: return "text-pink-400";
    case 9735: return "text-amber-800 dark:text-amber-400";
    case 20: case 21: return "text-cyan-800 dark:text-cyan-400";
    case 30023: return "text-brand";
    default: return "text-muted-foreground";
  }
}

function getHeatmapColor(count: number, max: number): string {
  if (count === 0 || max === 0) return "bg-brand/5 border border-brand/10";
  const ratio = count / max;
  if (ratio >= 0.75) return "bg-brand";
  if (ratio >= 0.5) return "bg-brand";
  if (ratio >= 0.25) return "bg-brand";
  return "bg-brand";
}

function resolvePubkey(input: string): string | null {
  const trimmed = input.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data as string;
  } catch {}
  return null;
}

function isReply(event: Event): boolean {
  return event.kind === 1 && event.tags.some(t => t[0] === "e" && (t[3] === "reply" || t[3] === "root"));
}

function getReplyTarget(event: Event): string | null {
  const replyTag = event.tags.find(t => t[0] === "e" && t[3] === "reply");
  if (replyTag) return replyTag[1];
  const rootTag = event.tags.find(t => t[0] === "e" && t[3] === "root");
  if (rootTag) return rootTag[1];
  const eTags = event.tags.filter(t => t[0] === "e");
  return eTags.length > 0 ? eTags[eTags.length - 1][1] : null;
}

function getTaggedPubkey(event: Event): string | null {
  const pTag = event.tags.find(t => t[0] === "p");
  return pTag ? pTag[1] : null;
}

function getZapAmount(event: Event): number {
  const bolt11Tag = event.tags.find(t => t[0] === "bolt11");
  if (!bolt11Tag) return 0;
  try {
    const bolt11 = bolt11Tag[1].toLowerCase();
    const match = bolt11.match(/lnbc(\d+)([munp]?)/);
    if (!match) return 0;
    const amount = parseInt(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = { "": 100000000, m: 100000, u: 100, n: 0.1, p: 0.001 };
    return Math.round((amount * (multipliers[unit] || 1)) / 1000);
  } catch {
    return 0;
  }
}

function truncateContent(content: string, maxLen: number = 120): string {
  if (content.length <= maxLen) return content;
  const truncated = content.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > maxLen * 0.5 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

function ProfileAvatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(0, pubkey), [pubkey]);
  const { avatarUrl, displayName } = useMemo(() => {
    if (!profile) return { avatarUrl: "", displayName: "" };
    const content = getProfileContent(profile);
    return {
      avatarUrl: getAvatarUrl(profile) || "",
      displayName: content?.display_name || content?.name || "" };
  }, [profile]);

  return (
    <Avatar className="w-5 h-5 shrink-0">
      <AvatarImage src={avatarUrl} alt={displayName} />
      <AvatarFallback className="bg-brand/20 text-[8px]">
        {displayName ? displayName.slice(0, 1).toUpperCase() : "?"}
      </AvatarFallback>
    </Avatar>
  );
}

function TargetProfileHeader({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(0, pubkey), [pubkey]);
  const { avatarUrl, displayName } = useMemo(() => {
    if (!profile) return { avatarUrl: "", displayName: "" };
    const content = getProfileContent(profile);
    return {
      avatarUrl: getAvatarUrl(profile) || "",
      displayName: content?.display_name || content?.name || "" };
  }, [profile]);

  const npub = useMemo(() => {
    try { return nip19.npubEncode(pubkey); } catch { return ""; }
  }, [pubkey]);

  return (
    <div className="flex items-center gap-2">
      <Avatar className="w-8 h-8 shrink-0 border border-brand/20">
        <AvatarImage src={avatarUrl} alt={displayName} />
        <AvatarFallback className="bg-brand/20 text-xs">
          {displayName ? displayName.slice(0, 2).toUpperCase() : "??"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <ProfileLink pubkey={pubkey} className="text-sm font-medium text-foreground" showAvatar={false} />
      </div>
    </div>
  );
}

type EventCategory = "notes" | "replies" | "reposts" | "reactions" | "zaps" | "dms" | "media" | "articles" | "other";

function categorizeEvent(event: Event): EventCategory {
  if (event.kind === 4) return "dms";
  if (event.kind === 9735) return "zaps";
  if (event.kind === 7) return "reactions";
  if (event.kind === 6) return "reposts";
  if (event.kind === 20 || event.kind === 21) return "media";
  if (event.kind === 30023) return "articles";
  if (event.kind === 1) return isReply(event) ? "replies" : "notes";
  return "other";
}

const CATEGORY_META: Record<EventCategory, { label: string; icon: typeof FileText; color: string }> = {
  notes: { label: "Notes", icon: FileText, color: "text-blue-700 dark:text-blue-400" },
  replies: { label: "Replies", icon: MessageSquare, color: "text-sky-400" },
  reposts: { label: "Reposts", icon: Repeat2, color: "text-emerald-800 dark:text-emerald-400" },
  reactions: { label: "Reactions", icon: Heart, color: "text-pink-400" },
  zaps: { label: "Zaps", icon: Zap, color: "text-amber-800 dark:text-amber-400" },
  dms: { label: "DMs", icon: Send, color: "text-green-800 dark:text-green-400" },
  media: { label: "Media", icon: Image, color: "text-cyan-800 dark:text-cyan-400" },
  articles: { label: "Articles", icon: FileText, color: "text-brand" },
  other: { label: "Other", icon: Eye, color: "text-muted-foreground" } };

function EventRow({ event }: { event: Event }) {
  const category = categorizeEvent(event);
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const time = format(new Date(event.created_at * 1000), "HH:mm");
  const taggedPubkey = getTaggedPubkey(event);
  const noteId = useMemo(() => {
    try { return nip19.noteEncode(event.id); } catch { return ""; }
  }, [event.id]);

  const replyTargetId = category === "replies" ? getReplyTarget(event) : null;
  const replyNoteId = useMemo(() => {
    if (!replyTargetId) return "";
    try { return nip19.noteEncode(replyTargetId); } catch { return ""; }
  }, [replyTargetId]);

  const zapAmount = category === "zaps" ? getZapAmount(event) : 0;

  const reactionContent = category === "reactions" ? (event.content || "+") : null;
  const reactionTargetId = useMemo(() => {
    if (category !== "reactions") return "";
    const eTag = event.tags.find(t => t[0] === "e");
    if (!eTag) return "";
    try { return nip19.noteEncode(eTag[1]); } catch { return ""; }
  }, [event, category]);

  return (
    <div className="flex items-start gap-2 py-2 px-3 rounded-lg hover:bg-brand/5 transition-colors group" data-testid={`event-row-${event.id.slice(0, 8)}`}>
      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
        <span className="text-[10px] text-muted-foreground/50 font-mono w-10">{time}</span>
        <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        {category === "notes" && (
          <>
            <p className="text-xs text-foreground/80 leading-relaxed">{truncateContent(event.content)}</p>
            {noteId && (
              <Link href={`/thread/${noteId}`} className="text-[10px] text-brand hover:underline" data-testid={`link-thread-${event.id.slice(0, 8)}`}>
                Open thread →
              </Link>
            )}
          </>
        )}

        {category === "replies" && (
          <>
            <p className="text-xs text-foreground/80 leading-relaxed">{truncateContent(event.content)}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {taggedPubkey && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                  replied to <ProfileAvatar pubkey={taggedPubkey} /> <ProfileLink pubkey={taggedPubkey} className="text-sky-400 text-[10px]" showAvatar={false} />
                </span>
              )}
              {replyNoteId && (
                <Link href={`/thread/${replyNoteId}`} className="text-[10px] text-brand hover:underline" data-testid={`link-reply-thread-${event.id.slice(0, 8)}`}>
                  View context →
                </Link>
              )}
            </div>
          </>
        )}

        {category === "reposts" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-emerald-800/70 dark:text-emerald-400/70">Reposted</span>
            {taggedPubkey && (
              <span className="flex items-center gap-1">
                <ProfileAvatar pubkey={taggedPubkey} />
                <ProfileLink pubkey={taggedPubkey} className="text-xs text-emerald-800 dark:text-emerald-400" showAvatar={false} />
              </span>
            )}
            {(() => {
              const eTag = event.tags.find(t => t[0] === "e");
              if (!eTag) return null;
              try {
                const nid = nip19.noteEncode(eTag[1]);
                return (
                  <Link href={`/thread/${nid}`} className="text-[10px] text-brand hover:underline">
                    View →
                  </Link>
                );
              } catch { return null; }
            })()}
          </div>
        )}

        {category === "reactions" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-pink-500/20 text-pink-400">
              {reactionContent === "+" ? <Heart className="w-2.5 h-2.5 fill-pink-400" /> : reactionContent}
            </Badge>
            {taggedPubkey && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                on <ProfileAvatar pubkey={taggedPubkey} /> <ProfileLink pubkey={taggedPubkey} className="text-xs text-pink-400" showAvatar={false} />
              </span>
            )}
            {reactionTargetId && (
              <Link href={`/thread/${reactionTargetId}`} className="text-[10px] text-brand hover:underline">
                View post →
              </Link>
            )}
          </div>
        )}

        {category === "zaps" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/20 text-amber-800 dark:text-amber-400 font-mono gap-0.5">
              <Zap className="w-2.5 h-2.5" /> {zapAmount > 0 ? zapAmount.toLocaleString() + " sats" : "zap"}
            </Badge>
            {taggedPubkey && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                to <ProfileAvatar pubkey={taggedPubkey} /> <ProfileLink pubkey={taggedPubkey} className="text-xs text-amber-800 dark:text-amber-400" showAvatar={false} />
              </span>
            )}
          </div>
        )}

        {category === "dms" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-green-800/70 dark:text-green-400/70">Encrypted message</span>
            {taggedPubkey && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                to <ProfileAvatar pubkey={taggedPubkey} /> <ProfileLink pubkey={taggedPubkey} className="text-xs text-green-800 dark:text-green-400" showAvatar={false} />
              </span>
            )}
          </div>
        )}

        {category === "media" && (
          <>
            <p className="text-xs text-foreground/80">{truncateContent(event.content || "Media post")}</p>
            {noteId && (
              <Link href={`/thread/${noteId}`} className="text-[10px] text-brand hover:underline">
                View →
              </Link>
            )}
          </>
        )}

        {category === "articles" && (
          <>
            <p className="text-xs text-foreground/80">
              {event.tags.find(t => t[0] === "title")?.[1] || truncateContent(event.content)}
            </p>
            {noteId && (
              <Link href={`/thread/${noteId}`} className="text-[10px] text-brand hover:underline">
                Read →
              </Link>
            )}
          </>
        )}

        {category === "other" && (
          <p className="text-xs text-muted-foreground/60">
            {getKindLabel(event.kind)}{event.content ? ": " + truncateContent(event.content, 80) : ""}
          </p>
        )}
      </div>
    </div>
  );
}

interface DayDrilldownProps {
  date: string;
  events: Event[];
  onClose: () => void;
}

function DayDrilldown({ date, events, onClose }: DayDrilldownProps) {
  const [expandedCategory, setExpandedCategory] = useState<EventCategory | null>(null);

  const grouped = useMemo(() => {
    const groups: Record<EventCategory, Event[]> = {
      notes: [], replies: [], reposts: [], reactions: [], zaps: [], dms: [], media: [], articles: [], other: [] };
    const sorted = [...events].sort((a, b) => b.created_at - a.created_at);
    for (const e of sorted) {
      groups[categorizeEvent(e)].push(e);
    }
    return groups;
  }, [events]);

  const totalZapSats = useMemo(() => {
    return grouped.zaps.reduce((sum, e) => sum + getZapAmount(e), 0);
  }, [grouped.zaps]);

  const displayDate = useMemo(() => {
    try { return format(parseISO(date), "EEEE, MMM d, yyyy"); } catch { return date; }
  }, [date]);

  const categories: EventCategory[] = ["notes", "replies", "reposts", "reactions", "zaps", "dms", "media", "articles", "other"];

  return (
    <div className="border border-brand/20 rounded-lg bg-white/90 dark:bg-[rgba(4,4,10,0.6)] backdrop-blur-sm" data-testid="day-drilldown">
      <div className="flex items-center justify-between p-3 border-b border-brand/10">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onClose} className="w-7 h-7" data-testid="button-close-drilldown">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h3 className="text-sm font-display text-brand" data-testid="drilldown-date">{displayDate}</h3>
            <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              {events.length} events{totalZapSats > 0 && <><span className="mx-0.5">·</span><Zap className="w-2.5 h-2.5 text-amber-800 dark:text-amber-400 inline" /> {totalZapSats.toLocaleString()} sats</>}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="w-7 h-7">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="p-2 space-y-1">
        {categories.map((cat) => {
          const catEvents = grouped[cat];
          if (catEvents.length === 0) return null;
          const meta = CATEGORY_META[cat];
          const CatIcon = meta.icon;
          const isExpanded = expandedCategory === cat;

          return (
            <div key={cat} className="rounded-lg border border-brand/10 overflow-hidden" data-testid={`drilldown-category-${cat}`}>
              <button
                onClick={() => setExpandedCategory(isExpanded ? null : cat)}
                className="w-full flex items-center justify-between p-2.5 hover:bg-brand/5 transition-colors"
                data-testid={`button-expand-${cat}`}
              >
                <div className="flex items-center gap-2">
                  <CatIcon className={`w-3.5 h-3.5 ${meta.color}`} />
                  <span className="text-xs font-medium text-foreground/80">{meta.label}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-brand/20 text-brand font-mono">
                    {catEvents.length}
                  </Badge>
                  {cat === "zaps" && totalZapSats > 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/20 text-amber-800 dark:text-amber-400 font-mono gap-0.5">
                      <Zap className="w-2.5 h-2.5" /> {totalZapSats.toLocaleString()}
                    </Badge>
                  )}
                </div>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />}
              </button>

              {isExpanded && (
                <div className="border-t border-brand/10 max-h-[300px] overflow-y-auto">
                  {catEvents.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type StatView = "active-days" | "longest-streak" | "current-streak" | null;

interface ActivityHeatmapProps {
  pubkey?: string;
  relays?: string[];
}

export function ActivityHeatmap({ pubkey: propPubkey, relays: propRelays }: ActivityHeatmapProps) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [inputValue, setInputValue] = useState(propPubkey || "");
  const [activePubkey, setActivePubkey] = useState<string | null>(propPubkey ? resolvePubkey(propPubkey) : null);
  const [days, setDays] = useState(90);
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [hoveredCell, setHoveredCell] = useState<{ date: string; count: number; x: number; y: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [statView, setStatView] = useState<StatView>(null);
  const [summaryMode, setSummaryMode] = useState<"daily" | "weekly" | "monthly">("daily");

  useEffect(() => {
    if (propPubkey && propPubkey !== inputValue) {
      setInputValue(propPubkey);
      const resolved = resolvePubkey(propPubkey);
      if (resolved) {
        setActivePubkey(resolved);
      }
    }
  }, [propPubkey]);

  useEffect(() => {
    if (activePubkey && events.length === 0 && !loading) {
      handleSearch();
    }
  }, [activePubkey]);

  const effectiveDays = useMemo(() => {
    if (!isCustom) return days;
    if (!customRange.from || !customRange.to) return days;
    const from = parseISO(customRange.from);
    const to = parseISO(customRange.to);
    if (from > to) return days;
    return Math.max(1, differenceInDays(to, from) + 1);
  }, [isCustom, customRange, days]);

  const effectiveStart = useMemo(() => {
    if (isCustom && customRange.from) return parseISO(customRange.from);
    return subDays(new Date(), effectiveDays - 1);
  }, [isCustom, customRange, effectiveDays]);

  const effectiveEnd = useMemo(() => {
    if (isCustom && customRange.to) return parseISO(customRange.to);
    return new Date();
  }, [isCustom, customRange]);

  const handleSearch = useCallback(() => {
    const resolved = activePubkey || resolvePubkey(inputValue);
    if (!resolved) return;
    setActivePubkey(resolved);
    setLoading(true);
    setEvents([]);
    setSelectedDay(null);
    setStatView(null);

    const until = Math.floor(endOfDay(effectiveEnd).getTime() / 1000);
    const since = Math.floor(startOfDay(effectiveStart).getTime() / 1000);
    const collected: Event[] = [];
    const seenIds = new Set<string>();

    const sub = throttledPoolSubscribe(relaysToUse, { authors: [resolved], since, until }, {
      onevent(event: Event) {
        if (seenIds.has(event.id)) return;
        seenIds.add(event.id);
        collected.push(event);
      },
      oneose() {
        sub.close();
        setEvents([...collected]);
        setLoading(false);
      } });
  }, [inputValue, activePubkey, effectiveStart, effectiveEnd, relaysToUse]);

  const handleRangeChange = useCallback((v: string) => {
    if (v === "-1") {
      setIsCustom(true);
    } else {
      setIsCustom(false);
      setDays(Number(v));
    }
  }, []);

  const eventsPerDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of events) {
      const key = format(new Date(e.created_at * 1000), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [events]);

  const activityMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [key, evts] of eventsPerDay) {
      map.set(key, evts.length);
    }
    return map;
  }, [eventsPerDay]);

  const { grid, weekCount, maxCount } = useMemo(() => {
    const start = effectiveStart;
    const end = effectiveEnd;
    const weekStart = startOfWeek(start, { weekStartsOn: 1 });
    const totalDays = differenceInDays(end, weekStart) + 1;
    const weeks = Math.ceil(totalDays / 7);

    const cells: { date: string; count: number; dayOfWeek: number; week: number; inRange: boolean }[] = [];
    let maxVal = 0;

    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const cellDate = addDays(weekStart, w * 7 + d);
        const dateStr = format(cellDate, "yyyy-MM-dd");
        const count = activityMap.get(dateStr) || 0;
        const inRange = cellDate >= start && cellDate <= end;
        if (inRange && count > maxVal) maxVal = count;
        cells.push({ date: dateStr, count: inRange ? count : -1, dayOfWeek: d, week: w, inRange });
      }
    }

    return { grid: cells, weekCount: weeks, maxCount: maxVal };
  }, [activityMap, effectiveStart, effectiveEnd]);

  const stats = useMemo(() => {
    if (events.length === 0) return null;

    const start = effectiveStart;
    const daysCount = effectiveDays;
    const sortedDates: string[] = [];

    for (let i = 0; i < daysCount; i++) {
      sortedDates.push(format(addDays(start, i), "yyyy-MM-dd"));
    }

    let activeDays = 0;
    let longestStreak = 0;
    let longestStreakStart = 0;
    let longestStreakEnd = 0;
    let currentStreak = 0;
    let streak = 0;
    let streakStartIdx = 0;
    let totalEventsInActive = 0;

    for (let i = 0; i < sortedDates.length; i++) {
      const count = activityMap.get(sortedDates[i]) || 0;
      if (count > 0) {
        activeDays++;
        totalEventsInActive += count;
        if (streak === 0) streakStartIdx = i;
        streak++;
        if (streak > longestStreak) {
          longestStreak = streak;
          longestStreakStart = streakStartIdx;
          longestStreakEnd = i;
        }
      } else {
        streak = 0;
      }
    }

    let currentStreakStart = sortedDates.length;
    for (let i = sortedDates.length - 1; i >= 0; i--) {
      const count = activityMap.get(sortedDates[i]) || 0;
      if (count > 0) {
        currentStreak++;
        currentStreakStart = i;
      } else {
        break;
      }
    }

    return {
      totalActiveDays: activeDays,
      longestStreak,
      longestStreakDates: sortedDates.slice(longestStreakStart, longestStreakEnd + 1),
      currentStreak,
      currentStreakDates: currentStreak > 0 ? sortedDates.slice(currentStreakStart) : [],
      avgPerActiveDay: activeDays > 0 ? Math.round(totalEventsInActive / activeDays) : 0,
      totalEvents: events.length,
      activeDatesList: sortedDates.filter(d => (activityMap.get(d) || 0) > 0) };
  }, [events, activityMap, effectiveDays, effectiveStart]);

  const monthLabels = useMemo(() => {
    const start = effectiveStart;
    const weekStart = startOfWeek(start, { weekStartsOn: 1 });
    const labels: { label: string; week: number }[] = [];
    let lastMonth = "";

    for (let w = 0; w < weekCount; w++) {
      const d = addDays(weekStart, w * 7);
      const m = format(d, "MMM");
      if (m !== lastMonth) {
        labels.push({ label: m, week: w });
        lastMonth = m;
      }
    }
    return labels;
  }, [effectiveStart, weekCount]);

  const highlightedDates = useMemo(() => {
    if (!stats) return new Set<string>();
    if (statView === "active-days") return new Set(stats.activeDatesList);
    if (statView === "longest-streak") return new Set(stats.longestStreakDates);
    if (statView === "current-streak") return new Set(stats.currentStreakDates);
    return new Set<string>();
  }, [stats, statView]);

  const statDaysList = useMemo(() => {
    if (!stats || !statView) return [];
    let dates: string[] = [];
    if (statView === "active-days") dates = stats.activeDatesList;
    else if (statView === "longest-streak") dates = stats.longestStreakDates;
    else if (statView === "current-streak") dates = stats.currentStreakDates;
    return dates.map(d => ({ date: d, count: activityMap.get(d) || 0 })).reverse();
  }, [stats, statView, activityMap]);

  const weeklyMonthlyData = useMemo(() => {
    if (summaryMode === "daily" || events.length === 0) return [];
    const buckets = new Map<string, { label: string; events: Event[]; start: string; end: string }>();
    const sorted = [...events].sort((a, b) => a.created_at - b.created_at);

    for (const e of sorted) {
      const d = new Date(e.created_at * 1000);
      let key: string;
      let label: string;
      if (summaryMode === "weekly") {
        const ws = startOfWeek(d, { weekStartsOn: 1 });
        key = format(ws, "yyyy-MM-dd");
        label = `Week of ${format(ws, "MMM d")}`;
      } else {
        key = format(d, "yyyy-MM");
        label = format(d, "MMMM yyyy");
      }
      if (!buckets.has(key)) {
        buckets.set(key, { label, events: [], start: format(d, "yyyy-MM-dd"), end: format(d, "yyyy-MM-dd") });
      }
      const bucket = buckets.get(key)!;
      bucket.events.push(e);
      bucket.end = format(d, "yyyy-MM-dd");
    }

    return Array.from(buckets.values()).reverse();
  }, [events, summaryMode]);

  const selectedDayEvents = useMemo(() => {
    if (!selectedDay) return [];
    return eventsPerDay.get(selectedDay) || [];
  }, [selectedDay, eventsPerDay]);

  return (
    <div className="overflow-visible" data-testid="activity-heatmap">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-brand" />
            <h2 className="text-sm font-display text-brand">Activity Heatmap</h2>
          </div>
          {activePubkey && events.length > 0 && (
            <div className="flex items-center gap-1">
              {(["daily", "weekly", "monthly"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={summaryMode === mode ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => { setSummaryMode(mode); setSelectedDay(null); setStatView(null); }}
                  className="text-[10px] h-6 px-2"
                  data-testid={`button-summary-${mode}`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Button>
              ))}
            </div>
          )}
        </div>

        {activePubkey && <TargetProfileHeader pubkey={activePubkey} />}

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="heatmap-pubkey" className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
              Pubkey / npub
            </Label>
            <div className="flex gap-2">
              <Input
                id="heatmap-pubkey"
                data-testid="input-heatmap-pubkey"
                placeholder="npub1... or hex pubkey"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
                className="font-mono text-sm"
                style={{ fontSize: "16px" }}
              />
              <Button
                data-testid="button-heatmap-search"
                onClick={handleSearch}
                disabled={loading || !inputValue.trim()}
              >
                {loading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Search className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
              Time Range
            </Label>
            <Select value={isCustom ? "-1" : String(days)} onValueChange={handleRangeChange}>
              <SelectTrigger data-testid="select-heatmap-range" className="w-[100px]" style={{ fontSize: "16px" }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGES.map((r) => (
                  <SelectItem key={r.days} value={String(r.days)} data-testid={`select-item-${r.label}`}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isCustom && (
          <div className="flex flex-col sm:flex-row gap-2 items-end" data-testid="custom-range-inputs">
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">From</Label>
              <Input
                type="date"
                value={customRange.from}
                onChange={(e) => setCustomRange(prev => ({ ...prev, from: e.target.value }))}
                className="font-mono text-sm"
                style={{ fontSize: "16px" }}
                data-testid="input-custom-from"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">To</Label>
              <Input
                type="date"
                value={customRange.to}
                onChange={(e) => setCustomRange(prev => ({ ...prev, to: e.target.value }))}
                className="font-mono text-sm"
                style={{ fontSize: "16px" }}
                data-testid="input-custom-to"
              />
            </div>
            <Button
              onClick={handleSearch}
              disabled={loading || !customRange.from || !customRange.to || (customRange.from && customRange.to && customRange.from > customRange.to)}
              className="shrink-0"
              data-testid="button-custom-search"
            >
              {loading ? <RelayOutpostInlineLoader className="w-4 h-4" /> : <Search className="w-4 h-4" />}
              <span className="ml-1.5">Search</span>
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8" data-testid="heatmap-loading">
            <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            <span className="text-sm text-muted-foreground">Fetching events...</span>
          </div>
        )}

        {!loading && activePubkey && events.length > 0 && stats && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="heatmap-stats">
              <button
                onClick={() => setStatView(statView === "active-days" ? null : "active-days")}
                className={`space-y-1 p-3 rounded-lg border transition-all text-left ${
                  statView === "active-days"
                    ? "bg-brand/20 border-brand/40 ring-1 ring-brand/30"
                    : "bg-brand/10 border-brand/10 hover:border-brand/30"
                }`}
                data-testid="stat-card-active-days"
              >
                <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Active Days</p>
                <p className="text-lg font-mono text-brand" data-testid="stat-active-days">
                  {stats.totalActiveDays}
                </p>
              </button>
              <button
                onClick={() => setStatView(statView === "longest-streak" ? null : "longest-streak")}
                className={`space-y-1 p-3 rounded-lg border transition-all text-left ${
                  statView === "longest-streak"
                    ? "bg-orange-500/20 border-orange-500/40 ring-1 ring-orange-500/30"
                    : "bg-brand/10 border-brand/10 hover:border-brand/30"
                }`}
                data-testid="stat-card-longest-streak"
              >
                <div className="flex items-center gap-1">
                  <Flame className="w-3 h-3 text-orange-800 dark:text-orange-400" />
                  <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Longest Streak</p>
                </div>
                <p className="text-lg font-mono text-orange-800 dark:text-orange-400" data-testid="stat-longest-streak">
                  {stats.longestStreak}d
                </p>
              </button>
              <button
                onClick={() => setStatView(statView === "current-streak" ? null : "current-streak")}
                className={`space-y-1 p-3 rounded-lg border transition-all text-left ${
                  statView === "current-streak"
                    ? "bg-amber-500/20 border-amber-500/40 ring-1 ring-amber-500/30"
                    : "bg-brand/10 border-brand/10 hover:border-brand/30"
                }`}
                data-testid="stat-card-current-streak"
              >
                <div className="flex items-center gap-1">
                  <Flame className="w-3 h-3 text-amber-800 dark:text-amber-400" />
                  <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Current Streak</p>
                </div>
                <p className="text-lg font-mono text-amber-800 dark:text-amber-400" data-testid="stat-current-streak">
                  {stats.currentStreak}d
                </p>
              </button>
              <div className="space-y-1 p-3 rounded-lg bg-brand/10 border border-brand/10">
                <div className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-brand" />
                  <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Avg/Day</p>
                </div>
                <p className="text-lg font-mono text-brand" data-testid="stat-avg-per-day">
                  {stats.avgPerActiveDay}
                </p>
              </div>
              <div className="space-y-1 p-3 rounded-lg bg-brand/10 border border-brand/10 col-span-2 sm:col-span-1">
                <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Total Events</p>
                <p className="text-lg font-mono text-foreground" data-testid="stat-total-events">
                  {stats.totalEvents.toLocaleString()}
                </p>
              </div>
            </div>

            {statView && statDaysList.length > 0 && (
              <div className="border border-brand/20 rounded-lg bg-white/90 dark:bg-[rgba(4,4,10,0.4)] p-3 space-y-2" data-testid="stat-drilldown">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-display text-brand">
                    {statView === "active-days" ? "All Active Days" : statView === "longest-streak" ? "Longest Streak Days" : "Current Streak Days"}
                    <span className="text-muted-foreground/50 ml-1">({statDaysList.length})</span>
                  </h4>
                  <Button variant="ghost" size="icon" onClick={() => setStatView(null)} className="w-6 h-6">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="max-h-[200px] overflow-y-auto space-y-0.5">
                  {statDaysList.map((item) => (
                    <button
                      key={item.date}
                      onClick={() => { setSelectedDay(item.date); setStatView(null); }}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-brand/10 transition-colors text-left"
                      data-testid={`stat-day-${item.date}`}
                    >
                      <span className="text-xs font-mono text-foreground/80">
                        {format(parseISO(item.date), "EEE, MMM d")}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-brand/20 text-brand font-mono">
                        {item.count}
                      </Badge>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {summaryMode === "daily" && !selectedDay && (
              <div className="space-y-1 relative" data-testid="heatmap-grid-container">
                <div className="flex gap-1 text-[9px] text-muted-foreground/40 pl-8">
                  {monthLabels.map((m, i) => (
                    <span
                      key={`${m.label}-${i}`}
                      style={{ marginLeft: i === 0 ? `${m.week * 14}px` : undefined }}
                    >
                      {m.label}
                    </span>
                  ))}
                </div>

                <div className="flex gap-0.5">
                  <div className="flex flex-col gap-0.5 pt-0.5">
                    {DAY_LABELS.map((label, i) => (
                      <div
                        key={label}
                        className="w-6 h-3 flex items-center justify-end pr-1 text-[8px] text-muted-foreground/40"
                        style={{ visibility: i % 2 === 0 ? "visible" : "hidden" }}
                      >
                        {label}
                      </div>
                    ))}
                  </div>

                  <div
                    className="grid gap-0.5"
                    style={{
                      gridTemplateRows: "repeat(7, 1fr)",
                      gridTemplateColumns: `repeat(${weekCount}, 1fr)`,
                      gridAutoFlow: "column" }}
                    data-testid="heatmap-grid"
                  >
                    {grid.map((cell) => (
                      <div
                        key={cell.date}
                        data-testid={`heatmap-cell-${cell.date}`}
                        className={`w-3 h-3 rounded-sm transition-all cursor-pointer ${
                          cell.inRange ? getHeatmapColor(cell.count, maxCount) : "bg-transparent pointer-events-none"
                        } ${highlightedDates.has(cell.date) ? "ring-1 ring-white/40" : ""}`}
                        onClick={() => {
                          if (!cell.inRange || cell.count <= 0) return;
                          setSelectedDay(cell.date);
                          setStatView(null);
                        }}
                        onMouseEnter={(e) => {
                          if (!cell.inRange) return;
                          const rect = (e.target as HTMLElement).getBoundingClientRect();
                          setHoveredCell({ date: cell.date, count: cell.count, x: rect.left, y: rect.top });
                        }}
                        onMouseLeave={() => setHoveredCell(null)}
                      />
                    ))}
                  </div>
                </div>

                {hoveredCell && (
                  <div
                    className="fixed z-50 rounded-md border border-brand/20 bg-white dark:bg-[rgba(4,4,10,0.95)] px-2.5 py-1.5 text-xs shadow-lg pointer-events-none"
                    style={{ left: hoveredCell.x, top: hoveredCell.y - 40 }}
                    data-testid="heatmap-tooltip"
                  >
                    <p className="text-brand font-mono text-[10px]">{hoveredCell.date}</p>
                    <p className="text-foreground">
                      {hoveredCell.count} event{hoveredCell.count !== 1 ? "s" : ""}
                    </p>
                    {hoveredCell.count > 0 && (
                      <p className="text-[9px] text-brand dark:text-brand/60 mt-0.5">Click to drill down</p>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <span className="text-[9px] text-muted-foreground/40">Less</span>
                  <div className="w-3 h-3 rounded-sm bg-brand/5 border border-brand/10" />
                  <div className="w-3 h-3 rounded-sm bg-brand" />
                  <div className="w-3 h-3 rounded-sm bg-brand" />
                  <div className="w-3 h-3 rounded-sm bg-brand" />
                  <div className="w-3 h-3 rounded-sm bg-brand" />
                  <span className="text-[9px] text-muted-foreground/40">More</span>
                </div>
              </div>
            )}

            {summaryMode !== "daily" && weeklyMonthlyData.length > 0 && !selectedDay && (
              <div className="space-y-2" data-testid="summary-view">
                {weeklyMonthlyData.map((bucket) => {
                  const cats: Record<EventCategory, number> = {
                    notes: 0, replies: 0, reposts: 0, reactions: 0, zaps: 0, dms: 0, media: 0, articles: 0, other: 0 };
                  let zapSats = 0;
                  for (const e of bucket.events) {
                    cats[categorizeEvent(e)]++;
                    if (e.kind === 9735) zapSats += getZapAmount(e);
                  }

                  return (
                    <div key={bucket.label} className="border border-brand/10 rounded-lg p-3 hover:border-brand/20 transition-colors" data-testid={`summary-bucket-${bucket.start}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="text-xs font-display text-brand">{bucket.label}</h4>
                          <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                            {bucket.events.length} events{zapSats > 0 && <><span className="mx-0.5">·</span><Zap className="w-2.5 h-2.5 text-amber-800 dark:text-amber-400 inline" /> {zapSats.toLocaleString()} sats</>}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(Object.entries(cats) as [EventCategory, number][])
                          .filter(([, count]) => count > 0)
                          .map(([cat, count]) => {
                            const meta = CATEGORY_META[cat];
                            const CatIcon = meta.icon;
                            return (
                              <Badge key={cat} variant="outline" className={`text-[10px] px-1.5 py-0.5 gap-1 border-brand/15 ${meta.color}`}>
                                <CatIcon className="w-2.5 h-2.5" /> {count} {meta.label}
                              </Badge>
                            );
                          })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedDay && (
              <DayDrilldown
                date={selectedDay}
                events={selectedDayEvents}
                onClose={() => setSelectedDay(null)}
              />
            )}
          </>
        )}

        {!loading && activePubkey && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2" data-testid="heatmap-empty">
            <CalendarDays className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">No events found for this pubkey in the selected range.</p>
          </div>
        )}

        {!activePubkey && !loading && (
          <div className="flex flex-col items-center justify-center py-8 gap-2" data-testid="heatmap-placeholder">
            <Search className="w-8 h-8 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/50">Enter a pubkey or npub to view activity heatmap.</p>
          </div>
        )}
      </div>
    </div>
  );
}
