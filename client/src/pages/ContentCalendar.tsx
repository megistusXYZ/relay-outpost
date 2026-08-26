import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  getScheduledPosts,
  cancelScheduledPost,
  reschedulePost,
  retryScheduledPost,
  formatScheduledTime,
  createScheduledPost,
  type ScheduledPostWithDecrypted,
} from "@/lib/schedule";
import {
  getLocalScheduledPosts,
  cancelLocalScheduledPost,
  updateLocalScheduledPost,
} from "@/lib/local-schedule";
import {
  fetchUserPublishedPosts,
  fetchCalendarEventsByIds,
  getPinnedEventIds,
  getPinnedEventRefs,
  unpinEvent as unpinCalendarEvent,
  removePrivateEvent,
  buildEventDeletion,
  getCalendarEventDate,
  getCalendarEventEndDate,
  type CalendarItem,
  type CalendarItemScheduled,
  type CalendarItemPinnedEvent,
  type CalendarItemSubscribed,
  type CalendarItemCreatorStream,
  type CalendarEventData,
} from "@/lib/calendar-events";
import {
  AGENDA_WINDOW_DAYS,
  addDays,
  buildAgendaDays,
  buildDayDotMap,
  dayKeyLocal,
  monthsInRange,
  parseDayKey,
  startOfDay,
  type HolidayOccurrence,
} from "@/lib/calendar-agenda";
import { publishEvent } from "@/lib/nostr";
import { signWithTimeout } from "@/lib/signer-timeout";
import type { ISigner } from "applesauce-signers";
import { getHolidaysForMonth, type Holiday } from "@/lib/calendar-holidays";
import { fetchAllSubscribedFeedEvents, getSubscribedFeeds, getLastFeedErrors, getFeedReminderSettings, getFeedReminderEnabledFeeds, FEED_REMINDER_OPTIONS, getScheduledFeedReminderIds, addScheduledFeedReminderId } from "@/lib/calendar-feeds";
import { fetchSubscribedCreatorStreams, getSubscribedCreators } from "@/lib/creator-subscriptions";
import { createGiftWrap, getDMRelaysForContact, publishWithFallback } from "@/lib/dm";
import { fetchDMRelayList } from "@/lib/outbox";
import { CalendarGrid } from "@/components/calendar/CalendarGrid";
import { DayDetail } from "@/components/calendar/DayDetail";
import { EventSearchPanel } from "@/components/calendar/EventSearchPanel";
import { HolidayManager } from "@/components/calendar/HolidayManager";
import { SubscriptionManager } from "@/components/calendar/SubscriptionManager";
import { WeekRibbon } from "@/components/calendar/WeekRibbon";
import { AgendaList, EventRowActions } from "@/components/calendar/AgendaList";
import { EventCard, EventCardSkeleton } from "@/components/EventCard";
import { ShareEventDialog } from "@/components/ShareEventDialog";
import { Button } from "@/components/ui/button";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Send,
  Search,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Check,
  MoreHorizontal,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarAddIcon } from "@/components/icons/CalendarAddIcon";
import { CreateEventIcon } from "@/components/icons/CreateEventIcon";
import { SubscriptionIcon } from "@/components/icons/SubscriptionIcon";

type FilterCategory = "scheduled" | "published" | "events" | "reminders" | "feeds" | "streams";

const FILTER_CONFIG: { key: FilterCategory; label: string; dot: string; dotActive: string }[] = [
  { key: "scheduled", label: "Scheduled", dot: "bg-brand", dotActive: "bg-brand" },
  { key: "published", label: "Published", dot: "bg-emerald-500", dotActive: "bg-emerald-500" },
  { key: "events", label: "Events", dot: "bg-sky-500", dotActive: "bg-sky-500" },
  { key: "reminders", label: "Holidays", dot: "bg-amber-500 dark:bg-amber-400", dotActive: "bg-amber-500 dark:bg-amber-400" },
  { key: "feeds", label: "Feeds", dot: "bg-rose-500", dotActive: "bg-rose-500" },
  { key: "streams", label: "Streams", dot: "bg-brand", dotActive: "bg-brand" },
];

const FILTER_TO_ITEM_TYPES: Record<FilterCategory, string[]> = {
  scheduled: ["scheduled"],
  published: ["published"],
  events: ["pinned-event"],
  reminders: [],
  feeds: ["subscribed"],
  streams: ["creator-stream"],
};

function parseDayParam(): Date | null {
  const params = new URLSearchParams(window.location.search);
  const day = params.get("day");
  if (!day) return null;
  // parseDayKey validates ranges AND round-trips the date, so a malformed or
  // edited ?day= (2026-13-40, 2026-02-31) can't silently roll over onto the
  // wrong day.
  return parseDayKey(day);
}

function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -day.getDay());
}

export default function ContentCalendar() {
  useDocumentTitle("Calendar");
  const { pubkey, follows, signer } = useNostrAuth();
  const { toast } = useToast();

  const [posts, setPosts] = useState<ScheduledPostWithDecrypted[]>([]);
  const [publishedItems, setPublishedItems] = useState<CalendarItem[]>([]);
  // All resolved pinned events, window-agnostic. null = first fetch still in
  // flight (drives the saved-events skeletons in the agenda).
  const [pinnedEvents, setPinnedEvents] = useState<CalendarEventData[] | null>(null);
  const [hasPins, setHasPins] = useState(false);
  const [shareEvent, setShareEvent] = useState<CalendarEventData | null>(null);
  const [loading, setLoading] = useState(true);

  // "Today" is fixed per mount: every window/label derives from it.
  const today = useMemo(() => startOfDay(new Date()), []);
  const agendaEndDay = useMemo(() => addDays(today, AGENDA_WINDOW_DAYS - 1), [today]);
  const currentWeekStart = useMemo(() => startOfWeek(today), [today]);

  const initialDay = useMemo(() => parseDayParam(), []);
  const [selectedDay, setSelectedDayRaw] = useState<Date | null>(initialDay);
  // Month shown in the "Jump to month" sheet (also drives how far data loads).
  const [currentDate, setCurrentDate] = useState(() => {
    const d = parseDayParam();
    return d ? new Date(d.getFullYear(), d.getMonth(), 1) : new Date();
  });
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = parseDayParam();
    return startOfWeek(d ?? new Date());
  });
  const [showMonthSheet, setShowMonthSheet] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const [showEventSearch, setShowEventSearch] = useState(false);
  const [showHolidayManager, setShowHolidayManager] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEventData | null>(null);
  const [showSubscriptionManager, setShowSubscriptionManager] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<FilterCategory>>(() => new Set(FILTER_CONFIG.map(f => f.key)));
  const [holidayRefreshKey, setHolidayRefreshKey] = useState(0);
  const [subscribedItems, setSubscribedItems] = useState<CalendarItemSubscribed[]>([]);
  const [creatorStreamItems, setCreatorStreamItems] = useState<CalendarItemCreatorStream[]>([]);
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const [hasSubscribedFeeds, setHasSubscribedFeeds] = useState(false);
  const [hasSubscribedCreators, setHasSubscribedCreators] = useState(false);
  const [creatorRefreshKey, setCreatorRefreshKey] = useState(0);
  const fetchVersionRef = useRef(0);

  const setSelectedDay = useCallback((day: Date | null) => {
    setSelectedDayRaw(day);
    if (day) {
      const url = `/calendar?day=${dayKeyLocal(day)}`;
      window.history.pushState(null, "", url);
    } else {
      window.history.pushState(null, "", "/calendar");
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      const day = parseDayParam();
      setSelectedDayRaw(day);
      if (day) {
        setCurrentDate(new Date(day.getFullYear(), day.getMonth(), 1));
        setWeekStart(startOfWeek(day));
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthStart = useMemo(() => new Date(year, month, 1), [year, month]);
  const monthEnd = useMemo(() => new Date(year, month + 1, 0, 23, 59, 59), [year, month]);

  // The fetch window: whatever span the agenda (today → +30d), the ribbon's
  // shown week, the sheet's viewed month, and the selected day need — snapped
  // to whole months so paging the ribbon week-by-week doesn't refetch.
  const selectedDayMs = selectedDay ? startOfDay(selectedDay).getTime() : null;
  const weekStartMs = weekStart.getTime();
  const { loadStart, loadEnd } = useMemo(() => {
    const week0 = new Date(weekStartMs);
    const weekEnd = addDays(week0, 6);
    const sel = selectedDayMs !== null ? new Date(selectedDayMs) : null;
    let min = monthStart.getTime();
    for (const d of [today, week0, sel]) {
      if (d && d.getTime() < min) min = d.getTime();
    }
    let max = monthEnd.getTime();
    for (const d of [agendaEndDay, weekEnd, sel]) {
      if (d && d.getTime() > max) max = d.getTime();
    }
    const minD = new Date(min);
    const maxD = new Date(max);
    return {
      loadStart: new Date(minD.getFullYear(), minD.getMonth(), 1),
      loadEnd: new Date(maxD.getFullYear(), maxD.getMonth() + 1, 0, 23, 59, 59),
    };
  }, [monthStart, monthEnd, today, agendaEndDay, weekStartMs, selectedDayMs]);

  const loadPosts = useCallback(async () => {
    if (!pubkey) return;
    setLoading(true);
    try {
      const [server, local] = await Promise.all([
        getScheduledPosts(pubkey),
        Promise.resolve(getLocalScheduledPosts(pubkey)),
      ]);
      const merged = [...server, ...local].sort(
        (a, b) => new Date(a.scheduledAt as any).getTime() - new Date(b.scheduledAt as any).getTime(),
      );
      setPosts(merged);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [pubkey, toast]);

  const loadPublishedPosts = useCallback(async () => {
    if (!pubkey) return;
    const version = ++fetchVersionRef.current;
    try {
      const items = await fetchUserPublishedPosts(pubkey, loadStart, loadEnd);
      if (fetchVersionRef.current === version) setPublishedItems(items);
    } catch (err) {
      console.error("Failed to load published posts:", err);
    }
  }, [pubkey, loadStart, loadEnd]);

  // Pinned events load eagerly on page open — the pin store already knows the
  // addresses, so we fetch every pinned event immediately (no month scoping,
  // no waiting for a day click). Agenda/ribbon/sheet views derive from this list.
  const pinnedVersionRef = useRef(0);
  const loadPinnedEvents = useCallback(async () => {
    if (!pubkey) return;
    const version = ++pinnedVersionRef.current;
    try {
      const pinnedIds = getPinnedEventIds(pubkey);
      const pinnedRefs = getPinnedEventRefs(pubkey);
      setHasPins(pinnedIds.length > 0 || pinnedRefs.length > 0);
      if (pinnedIds.length === 0 && pinnedRefs.length === 0) {
        if (pinnedVersionRef.current === version) setPinnedEvents([]);
        return;
      }
      const events = await fetchCalendarEventsByIds(pinnedIds, pinnedRefs);
      if (pinnedVersionRef.current !== version) return;
      setPinnedEvents(events);
    } catch (err) {
      console.error("Failed to load pinned events:", err);
      if (pinnedVersionRef.current === version) setPinnedEvents((prev) => prev ?? []);
    }
  }, [pubkey]);

  const pinnedItems: CalendarItemPinnedEvent[] = useMemo(() => {
    if (!pinnedEvents) return [];
    const items: CalendarItemPinnedEvent[] = [];
    for (const ce of pinnedEvents) {
      const date = getCalendarEventDate(ce);
      if (!date) continue;
      // Span-intersect with the load window: a multi-day event that STARTED
      // before the window but runs into it must still surface (it previously
      // vanished because only the start date was range-checked).
      const end = getCalendarEventEndDate(ce) || date;
      if (end < loadStart || date > loadEnd) continue;
      items.push({
        type: "pinned-event",
        id: ce.id,
        date,
        dotColor: "bg-sky-500",
        calendarEvent: ce,
      });
    }
    return items;
  }, [pinnedEvents, loadStart, loadEnd]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    const handler = () => loadPosts();
    window.addEventListener("scheduled-post-updated", handler);
    return () => window.removeEventListener("scheduled-post-updated", handler);
  }, [loadPosts]);

  useEffect(() => {
    loadPublishedPosts();
  }, [loadPublishedPosts]);

  useEffect(() => {
    loadPinnedEvents();
  }, [loadPinnedEvents]);

  const feedVersionRef = useRef(0);
  const [feedsRefreshing, setFeedsRefreshing] = useState(false);
  const loadSubscribedFeeds = useCallback(async (forceRefresh?: boolean) => {
    if (!pubkey) return;
    const version = ++feedVersionRef.current;
    const feeds = getSubscribedFeeds(pubkey);
    setHasSubscribedFeeds(feeds.length > 0);
    if (feeds.length === 0) {
      setSubscribedItems([]);
      return;
    }
    if (forceRefresh) setFeedsRefreshing(true);
    try {
      const onBgRefresh = forceRefresh ? undefined : () => loadSubscribedFeeds(true);
      const feedEvents = await fetchAllSubscribedFeedEvents(pubkey, loadStart, loadEnd, forceRefresh, onBgRefresh);
      if (feedVersionRef.current !== version) return;
      const items: CalendarItemSubscribed[] = feedEvents.map((fe) => ({
        type: "subscribed" as const,
        id: `feed-${fe.feedId}-${fe.event.uid}`,
        feedId: fe.feedId,
        date: fe.event.dtstart,
        dotColor: "bg-rose-500",
        summary: fe.event.summary,
        feedName: fe.feedName,
        feedEmoji: fe.feedEmoji,
        description: fe.event.description,
        location: fe.event.location,
        dtend: fe.event.dtend,
      }));
      setSubscribedItems(items);
      const errors = getLastFeedErrors();
      if (errors.length > 0) {
        const names = errors.map((e) => e.feedName).join(", ");
        toast({
          title: "Some feeds failed to load",
          description: `Could not fetch: ${names}. The feed URL may be broken — try removing and re-adding it.`,
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error("Failed to load subscribed feed events:", err);
    } finally {
      if (forceRefresh) setFeedsRefreshing(false);
    }
  }, [pubkey, loadStart, loadEnd, feedRefreshKey, toast]);

  useEffect(() => {
    loadSubscribedFeeds();
  }, [loadSubscribedFeeds]);

  const scheduleFeedRemindersRef = useRef(false);
  useEffect(() => {
    if (!pubkey || !signer || subscribedItems.length === 0) return;
    const reminderIntervals = getFeedReminderSettings(pubkey);
    if (reminderIntervals.length === 0) return;
    let enabledFeeds = getFeedReminderEnabledFeeds(pubkey);
    if (enabledFeeds.size === 0) {
      const allFeeds = getSubscribedFeeds(pubkey);
      if (allFeeds.length > 0) {
        enabledFeeds = new Set(allFeeds.map(f => f.id));
      }
    }
    if (enabledFeeds.size === 0) return;
    if (scheduleFeedRemindersRef.current) return;
    scheduleFeedRemindersRef.current = true;

    (async () => {
      try {
        const now = Date.now();
        const alreadyScheduled = getScheduledFeedReminderIds(pubkey);
        let scheduled = 0;

        for (const item of subscribedItems) {
          if (item.type !== "subscribed") continue;
          if (!enabledFeeds.has((item as CalendarItemSubscribed).feedId)) continue;
          const eventMs = item.date.getTime();
          if (eventMs <= now) continue;

          for (const intervalKey of reminderIntervals) {
            const option = FEED_REMINDER_OPTIONS.find((o) => o.value === intervalKey);
            if (!option) continue;

            const reminderMs = eventMs - option.minutes * 60 * 1000;
            if (reminderMs <= now) continue;

            const reminderId = `feed-${item.id}-${eventMs}-${intervalKey}`;
            if (alreadyScheduled.has(reminderId)) continue;

            const timeLabel = item.date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            const dateLabel = item.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
            const reminderMessage = `⏰ Feed reminder: "${item.summary}" starts in ${option.label}!\n📅 ${dateLabel} at ${timeLabel}${(item as CalendarItemSubscribed).feedName ? `\n📡 ${(item as CalendarItemSubscribed).feedEmoji} ${(item as CalendarItemSubscribed).feedName}` : ""}`;

            try {
              await fetchDMRelayList(pubkey).catch(() => {});
              const dmRelays = getDMRelaysForContact(pubkey, pubkey);
              // createGiftWrap returns { wrap, rumorId } — schedule the WRAP
              // event (the whole result object used to be stored, producing an
              // unpublishable reminder with kind undefined).
              const wrapped = await createGiftWrap(signer, pubkey, pubkey, reminderMessage);
              if (wrapped) {
                await createScheduledPost(wrapped.wrap, dmRelays, new Date(reminderMs), pubkey, `Feed: ${item.summary.slice(0, 40)}`);
                addScheduledFeedReminderId(pubkey, reminderId);
                scheduled++;
              }
            } catch (err) {
              console.warn(`Failed to schedule feed reminder for "${item.summary}":`, err);
            }
          }
        }

        if (scheduled > 0) {
          console.log(`[feed-reminders] Scheduled ${scheduled} feed reminder(s)`);
        }
      } catch (err) {
        console.error("[feed-reminders] Error scheduling feed reminders:", err);
      } finally {
        scheduleFeedRemindersRef.current = false;
      }
    })();
  }, [pubkey, signer, subscribedItems]);

  const creatorVersionRef = useRef(0);
  const [creatorsRefreshing, setCreatorsRefreshing] = useState(false);
  const loadCreatorStreams = useCallback(async (forceRefresh?: boolean) => {
    if (!pubkey) return;
    const version = ++creatorVersionRef.current;
    const creators = getSubscribedCreators(pubkey);
    setHasSubscribedCreators(creators.length > 0);
    if (creators.length === 0) {
      setCreatorStreamItems([]);
      return;
    }
    if (forceRefresh) setCreatorsRefreshing(true);
    try {
      const onBgRefresh = forceRefresh ? undefined : () => loadCreatorStreams(true);
      const streams = await fetchSubscribedCreatorStreams(pubkey, forceRefresh, onBgRefresh);
      if (creatorVersionRef.current !== version) return;
      const startMs = loadStart.getTime();
      const endMs = loadEnd.getTime();
      const items: CalendarItemCreatorStream[] = [];
      for (const s of streams) {
        const streamDate = s.starts ? new Date(s.starts * 1000) : new Date(s.eventCreatedAt * 1000);
        const dateMs = streamDate.getTime();
        if (dateMs >= startMs && dateMs <= endMs) {
          items.push({
            type: "creator-stream",
            id: `creator-stream-${s.pubkey}-${s.dTag}`,
            date: streamDate,
            dotColor: "bg-brand",
            title: s.title,
            summary: s.summary,
            creatorPubkey: s.pubkey,
            image: s.image,
            starts: s.starts,
            ends: s.ends,
            hashtags: s.hashtags,
            eventId: s.eventId,
            dTag: s.dTag,
            status: s.status,
          });
        }
      }
      setCreatorStreamItems(items);
    } catch (err) {
      console.error("Failed to load creator streams:", err);
    } finally {
      if (forceRefresh) setCreatorsRefreshing(false);
    }
  }, [pubkey, loadStart, loadEnd, creatorRefreshKey]);

  useEffect(() => {
    loadCreatorStreams();
  }, [loadCreatorStreams]);

  useEffect(() => {
    const handleSettingsApplied = () => {
      loadPinnedEvents();
      setHolidayRefreshKey((k) => k + 1);
    };
    const handleStorageChange = (e: StorageEvent) => {
      if (!pubkey || !e.key) return;
      if (e.key === `relay-outpost-pinned-calendar-events:${pubkey}`) {
        loadPinnedEvents();
      }
      if (e.key === `relay-outpost-custom-holidays:${pubkey}` || e.key === `relay-outpost-hidden-holidays:${pubkey}`) {
        setHolidayRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener("nip78-settings-applied", handleSettingsApplied);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("nip78-settings-applied", handleSettingsApplied);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [loadPinnedEvents, pubkey]);

  const scheduledItems: CalendarItemScheduled[] = useMemo(() => {
    return posts
      .filter((post) => post.status !== "cancelled" && post.status !== "published")
      .map((post) => ({
        type: "scheduled" as const,
        id: `scheduled-${post.id}`,
        date: new Date(post.scheduledAt),
        dotColor: "bg-brand",
        data: post,
      }));
  }, [posts]);

  // Holidays for the month-grid sheet (viewed month only).
  const holidays: Holiday[] = useMemo(() => {
    if (!pubkey) return [];
    return getHolidaysForMonth(pubkey, year, month);
  }, [pubkey, year, month, holidayRefreshKey]);

  // Dated holiday occurrences across the whole load window (the agenda and
  // ribbon span more than one month, so month/day pairs get pinned to a year).
  const holidayOccurrences: HolidayOccurrence[] = useMemo(() => {
    if (!pubkey) return [];
    const out: HolidayOccurrence[] = [];
    for (const { year: y, month: m } of monthsInRange(loadStart, loadEnd)) {
      for (const h of getHolidaysForMonth(pubkey, y, m)) {
        out.push({ date: new Date(y, m, h.day), holiday: h });
      }
    }
    return out;
  }, [pubkey, loadStart, loadEnd, holidayRefreshKey]);

  const allItems: CalendarItem[] = useMemo(() => {
    return [...scheduledItems, ...publishedItems, ...pinnedItems, ...subscribedItems, ...creatorStreamItems];
  }, [scheduledItems, publishedItems, pinnedItems, subscribedItems, creatorStreamItems]);

  const allFiltersActive = activeFilters.size === FILTER_CONFIG.length;

  const filteredItems: CalendarItem[] = useMemo(() => {
    if (allFiltersActive) return allItems;
    const allowedTypes: string[] = [];
    FILTER_CONFIG.forEach((f) => {
      if (activeFilters.has(f.key)) {
        FILTER_TO_ITEM_TYPES[f.key].forEach((t) => allowedTypes.push(t));
      }
    });
    return allItems.filter((item) => allowedTypes.includes(item.type));
  }, [allItems, activeFilters, allFiltersActive]);

  const filteredHolidaysEnabled = activeFilters.has("reminders");

  const toggleFilter = useCallback((key: FilterCategory) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  // ── Agenda derivations ──────────────────────────────────────────────────
  const selectedDayKey = selectedDay ? dayKeyLocal(selectedDay) : null;
  const selectedInWindow = !!selectedDay
    && startOfDay(selectedDay).getTime() >= today.getTime()
    && startOfDay(selectedDay).getTime() <= agendaEndDay.getTime();

  const agendaDays = useMemo(() => {
    return buildAgendaDays(
      filteredItems,
      filteredHolidaysEnabled ? holidayOccurrences : [],
      today,
      AGENDA_WINDOW_DAYS,
      selectedInWindow && selectedDayKey ? [selectedDayKey] : [],
    );
  }, [filteredItems, filteredHolidaysEnabled, holidayOccurrences, today, selectedInWindow, selectedDayKey]);

  const dotMap = useMemo(() => {
    return buildDayDotMap(
      filteredItems,
      filteredHolidaysEnabled ? holidayOccurrences : [],
      loadStart,
      loadEnd,
    );
  }, [filteredItems, filteredHolidaysEnabled, holidayOccurrences, loadStart, loadEnd]);

  // Past pinned/saved events for the collapsed "Past" section at the bottom.
  const pastPinnedEvents = useMemo(() => {
    if (!pinnedEvents) return [];
    const out = pinnedEvents.filter((ce) => {
      const start = getCalendarEventDate(ce);
      if (!start) return false;
      const end = getCalendarEventEndDate(ce) || start;
      return end < today;
    });
    out.sort((a, b) => (getCalendarEventDate(b)?.getTime() ?? 0) - (getCalendarEventDate(a)?.getTime() ?? 0));
    return out;
  }, [pinnedEvents, today]);

  // Scroll the agenda to the selected day's section (which always exists in
  // the window thanks to alwaysIncludeKeys).
  useEffect(() => {
    if (!selectedDay || !selectedInWindow || !selectedDayKey) return;
    const t = window.setTimeout(() => {
      document.getElementById(`agenda-day-${selectedDayKey}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [selectedDay, selectedInWindow, selectedDayKey]);

  const handleSelectDay = useCallback((day: Date) => {
    setSelectedDay(day);
    setWeekStart(startOfWeek(day));
    // Off-window days render in the DayDetail panel, which pulls from the
    // load window — keep the sheet month in sync so the data covers them.
    const d0 = startOfDay(day);
    if (d0 < today || d0 > agendaEndDay) {
      setCurrentDate(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }, [setSelectedDay, today, agendaEndDay]);

  const handleGridSelectDay = useCallback((day: Date) => {
    setShowMonthSheet(false);
    handleSelectDay(day);
  }, [handleSelectDay]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = useCallback(() => {
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setWeekStart(currentWeekStart);
    handleSelectDay(new Date());
  }, [today, currentWeekStart, handleSelectDay]);

  const monthLabel = currentDate.toLocaleDateString([], { month: "long", year: "numeric" });

  const pendingCount = posts.filter((p) => p.status === "pending").length;
  const failedCount = posts.filter((p) => p.status === "failed").length;

  // Device-scheduled items live only in this browser; route their actions to the
  // local store instead of the server API.
  const isDevicePost = (id: number) => (posts.find((p) => p.id === id) as any)?.backend === "device";

  const handleCancel = async (id: number) => {
    if (!pubkey) return;
    try {
      if (isDevicePost(id)) cancelLocalScheduledPost(id, pubkey);
      else await cancelScheduledPost(id, pubkey);
      toast({ title: "Cancelled", description: "Scheduled post has been cancelled." });
      loadPosts();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleReschedule = async (id: number, newTime: Date) => {
    if (!pubkey) return;
    try {
      if (isDevicePost(id)) updateLocalScheduledPost(id, pubkey, { scheduledAt: newTime });
      else await reschedulePost(id, pubkey, newTime);
      toast({ title: "Rescheduled", description: `Post rescheduled to ${formatScheduledTime(newTime)}` });
      loadPosts();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleRetry = async (id: number) => {
    if (!pubkey) return;
    try {
      if (isDevicePost(id)) {
        updateLocalScheduledPost(id, pubkey, {}); // re-arm to pending; runner picks it up
        toast({ title: "Retrying", description: "Will republish from this device when it's open." });
      } else {
        await retryScheduledPost(id, pubkey);
        toast({ title: "Retrying", description: "Post queued for publishing. It will go out within 60 seconds." });
      }
      loadPosts();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleUnpinEvent = (eventId: string) => {
    if (!pubkey) return;
    const calendarEvent = pinnedEvents?.find((ce) => ce.id === eventId);
    unpinCalendarEvent(pubkey, eventId, calendarEvent);
    setPinnedEvents((prev) => (prev ? prev.filter((ce) => ce.id !== eventId) : prev));
    setHasPins(getPinnedEventIds(pubkey).length > 0);
    toast({ title: "Unpinned", description: "Event removed from your calendar." });
  };

  // Delete one of the user's OWN events: publish a NIP-9 deletion (a no-op on
  // relays if it was never published, e.g. private) and clear it locally.
  const handleDeleteEvent = useCallback(async (ce: CalendarEventData) => {
    if (!pubkey || ce.pubkey !== pubkey) return;
    try {
      if (signer) {
        // Best-effort NIP-9 deletion publish — deliberately NOT awaited: the
        // relay round-trip (connect timeouts + AUTH retries) can hang for
        // 10s+, and gating the local removal on it made Delete look dead
        // (found in QA). Local cleanup below happens immediately.
        signWithTimeout(signer, buildEventDeletion(ce) as Parameters<ISigner["signEvent"]>[0])
          .then((signed) => publishEvent(signed))
          .catch(() => { /* deletion publish best-effort */ });
      }
      unpinCalendarEvent(pubkey, ce.id, ce);
      removePrivateEvent(ce.id);
      setPinnedEvents((prev) => (prev ? prev.filter((item) => item.id !== ce.id) : prev));
      setHasPins(getPinnedEventIds(pubkey).length > 0);
      toast({ title: "Event deleted", description: `"${ce.title}" was deleted.` });
    } catch {
      toast({ title: "Error", description: "Failed to delete the event.", variant: "destructive" });
    }
  }, [pubkey, signer, toast]);

  const handleEditEvent = useCallback((ce: CalendarEventData) => {
    if (!pubkey || ce.pubkey !== pubkey) return;
    setEditingEvent(ce);
    setShowHolidayManager(true);
  }, [pubkey]);

  const onRefreshFeeds = (hasSubscribedFeeds || hasSubscribedCreators) ? () => {
    if (hasSubscribedFeeds) loadSubscribedFeeds(true);
    if (hasSubscribedCreators) loadCreatorStreams(true);
  } : undefined;

  if (!pubkey) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400 text-sm">
        Sign in to view your content calendar.
      </div>
    );
  }

  const pinsStillLoading = hasPins && pinnedEvents === null;
  const pinsFailedToLoad = hasPins && pinnedEvents !== null && pinnedEvents.length === 0;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      {/* No page title — Schedule Post lives in the actions row below (with the
          pending/failed counts as its badge), so the page is one control row +
          the calendar. */}
      {/* Same glass container as the unified page tabs (glass-feed-tabs) — the
          actions keep their own colors/labels/order, they just live in the
          same rounded-lg glass row the content switchers use. */}
      <div className="glass-feed-tabs rounded-lg p-1 sm:px-3 sm:py-2 sm:flex sm:items-center sm:justify-between">
        {/* Action-priority order: the primary Schedule CTA leads and is always
            visible; Filters is a view control, so it sits last (icon-only). */}
        <div className="sm:hidden flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
          <button
            className="glass-tab-exempt relative shrink-0 flex items-center justify-center gap-1.5 px-2.5 min-h-[40px] rounded-lg bg-brand text-white text-[11px] font-medium whitespace-nowrap transition-colors touch-manipulation active:bg-brand"
            onClick={() => window.dispatchEvent(new CustomEvent("open-compose-schedule"))}
            data-testid="button-schedule-post"
          >
            <Send className="w-3.5 h-3.5" />
            Schedule
            {(pendingCount > 0 || failedCount > 0) && (
              <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold leading-4 text-white text-center ${failedCount > 0 ? "bg-red-500" : "bg-emerald-500"}`}>
                {failedCount > 0 ? failedCount : pendingCount}
              </span>
            )}
          </button>
          {/* One primary CTA + a ⋯ overflow: Create/Discover/Subscriptions
              fold into a menu so the row stays a calm three controls instead
              of five rainbow chips (same slim-row + ⋯ pattern as News). */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="glass-tab-exempt shrink-0 flex items-center justify-center w-10 min-h-[40px] rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-300 touch-manipulation transition-colors active:bg-gray-100 dark:active:bg-white/10"
                aria-label="More calendar actions"
                data-testid="button-calendar-more"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-1.5" sideOffset={8}>
              <button
                onClick={() => setShowHolidayManager(true)}
                className="flex items-center gap-2.5 w-full px-2.5 py-2.5 rounded-md text-[13px] text-foreground transition-colors hover:bg-muted/50 active:bg-muted touch-manipulation"
              >
                <CreateEventIcon className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                Create event
              </button>
              <button
                onClick={() => setShowEventSearch(true)}
                className="flex items-center gap-2.5 w-full px-2.5 py-2.5 rounded-md text-[13px] text-foreground transition-colors hover:bg-muted/50 active:bg-muted touch-manipulation"
              >
                <Search className="w-4 h-4 text-sky-500 dark:text-sky-400" />
                Discover events
              </button>
              <button
                onClick={() => setShowSubscriptionManager(true)}
                className="flex items-center gap-2.5 w-full px-2.5 py-2.5 rounded-md text-[13px] text-foreground transition-colors hover:bg-muted/50 active:bg-muted touch-manipulation"
              >
                <SubscriptionIcon className="w-4 h-4 text-rose-500 dark:text-rose-400" />
                Subscriptions
              </button>
            </PopoverContent>
          </Popover>
          <div className="flex-1" />
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="glass-tab-exempt shrink-0 flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[12px] text-gray-700 dark:text-gray-200 whitespace-nowrap touch-manipulation transition-colors active:bg-gray-100 dark:active:bg-white/10"
                aria-label="Filters"
                title="Filters"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                {!allFiltersActive && (
                  <span className="text-[10px] text-brand font-medium">
                    {activeFilters.size}/{FILTER_CONFIG.length}
                  </span>
                )}
                <ChevronDown className="w-3 h-3 text-gray-400 dark:text-gray-500" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-2" sideOffset={8}>
              <div className="space-y-0.5">
                {FILTER_CONFIG.map((f) => {
                  const active = activeFilters.has(f.key);
                  return (
                    <button
                      key={f.key}
                      onClick={() => toggleFilter(f.key)}
                      className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-md text-[12px] transition-colors hover:bg-muted/50 active:bg-muted touch-manipulation"
                    >
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${active ? f.dot : "bg-gray-300 dark:bg-gray-700"}`} />
                      <span className={active ? "text-foreground" : "text-muted-foreground/60"}>{f.label}</span>
                      {active && <Check className="w-3.5 h-3.5 ml-auto text-brand" />}
                    </button>
                  );
                })}
              </div>
              {!allFiltersActive && (
                <button
                  onClick={() => setActiveFilters(new Set(FILTER_CONFIG.map(f => f.key)))}
                  className="w-full mt-1.5 pt-1.5 border-t border-border/50 text-[11px] text-brand hover:text-brand-strong py-1.5 transition-colors text-center"
                >
                  Show all
                </button>
              )}
            </PopoverContent>
          </Popover>
        </div>

        <div className="hidden sm:flex sm:items-center sm:gap-3">
          <button
            className="glass-tab-exempt text-[11px] font-medium text-brand hover:text-brand-strong transition-colors flex items-center gap-1"
            onClick={() => window.dispatchEvent(new CustomEvent("open-compose-schedule"))}
            data-testid="button-schedule-post-desktop"
          >
            <Send className="w-3 h-3" />
            Schedule Post
            {pendingCount > 0 && (
              <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-brand dark:bg-brand/15 text-brand text-[9px] font-semibold leading-4 text-center">
                {pendingCount}
              </span>
            )}
            {failedCount > 0 && (
              <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400 text-[9px] font-semibold leading-4 text-center" title={`${failedCount} failed`}>
                {failedCount}!
              </span>
            )}
          </button>
          <button
            className="glass-tab-exempt text-[11px] text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors flex items-center gap-1"
            onClick={() => setShowHolidayManager(true)}
          >
            <CreateEventIcon className="w-3 h-3" />
            Create Event
          </button>
          <button
            className="glass-tab-exempt text-[11px] text-gray-500 dark:text-gray-400 hover:text-sky-600 dark:hover:text-sky-400 transition-colors flex items-center gap-1"
            onClick={() => setShowEventSearch(true)}
          >
            <Search className="w-3 h-3" />
            Discover Events
          </button>
          <button
            className="glass-tab-exempt text-[11px] text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors flex items-center gap-1"
            onClick={() => setShowSubscriptionManager(true)}
          >
            <SubscriptionIcon className="w-3 h-3" />
            Subscriptions
          </button>
        </div>
        <div className="hidden sm:flex sm:items-center sm:gap-1.5 sm:flex-wrap sm:justify-end sm:ml-3">
          {FILTER_CONFIG.map((f) => {
            const active = activeFilters.has(f.key);
            return (
              <button
                key={f.key}
                onClick={() => toggleFilter(f.key)}
                className={`glass-tab-exempt flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] transition-all select-none ${
                  active
                    ? "text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-white/10"
                    : "text-gray-400 dark:text-gray-600 opacity-50"
                }`}
                title={`${active ? "Hide" : "Show"} ${f.label}`}
              >
                <span className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${active ? f.dot : "bg-gray-300 dark:bg-gray-700"}`} />
                {f.label}
              </button>
            );
          })}
          {!allFiltersActive && (
            <button
              onClick={() => setActiveFilters(new Set(FILTER_CONFIG.map(f => f.key)))}
              className="glass-tab-exempt text-[9px] text-brand hover:text-brand-strong px-1.5 py-0.5 transition-colors"
              title="Show all"
            >
              Show all
            </button>
          )}
        </div>
      </div>

      {/* Week ribbon — the page's compact navigation. The month grid lives
          behind its "Month" button as a sheet. */}
      <WeekRibbon
        weekStart={weekStart}
        today={today}
        selectedDay={selectedDay}
        dotMap={dotMap}
        onSelectDay={handleSelectDay}
        onPrevWeek={() => setWeekStart(addDays(weekStart, -7))}
        onNextWeek={() => setWeekStart(addDays(weekStart, 7))}
        onGoToToday={goToToday}
        onOpenMonth={() => setShowMonthSheet(true)}
        onRefresh={onRefreshFeeds}
        refreshing={feedsRefreshing || creatorsRefreshing}
      />

      {/* A selected day OUTSIDE the agenda window (past, or >30 days out via
          the month sheet) shows the classic day panel. */}
      {selectedDay && !selectedInWindow && (
        <DayDetail
          selectedDay={selectedDay}
          items={filteredItems}
          holidays={filteredHolidaysEnabled ? getHolidaysForMonth(pubkey, selectedDay.getFullYear(), selectedDay.getMonth()) : []}
          onClose={() => setSelectedDay(null)}
          onCancelScheduled={handleCancel}
          onRescheduleScheduled={handleReschedule}
          onRetryScheduled={handleRetry}
          onUnpinEvent={handleUnpinEvent}
          currentPubkey={pubkey}
          onEditEvent={handleEditEvent}
          onDeleteEvent={handleDeleteEvent}
          onShareEvent={setShareEvent}
        />
      )}

      {loading && agendaDays.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <RelayOutpostInlineLoader className="w-6 h-6 text-brand" />
        </div>
      ) : agendaDays.length === 0 ? (
        !pinsStillLoading && (
          <div className="text-center py-12" data-testid="calendar-empty-state">
            <CalendarAddIcon className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Your calendar is empty</p>
            <p className="text-[10px] text-gray-500 dark:text-gray-500 mb-3">
              Schedule posts or discover community events to fill your calendar.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button
                size="sm"
                className="h-8 px-4 text-xs bg-brand hover:bg-brand text-white"
                onClick={() => window.dispatchEvent(new CustomEvent("open-compose-schedule"))}
              >
                <Send className="w-3 h-3 mr-1.5" />
                Schedule Post
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-4 text-xs border-sky-300 dark:border-sky-500/30 text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10"
                onClick={() => setShowEventSearch(true)}
              >
                <Search className="w-3 h-3 mr-1.5" />
                Discover Events
              </Button>
            </div>
          </div>
        )
      ) : (
        <AgendaList
          days={agendaDays}
          today={today}
          currentPubkey={pubkey}
          selectedKey={selectedInWindow ? selectedDayKey : null}
          onClearSelection={() => setSelectedDay(null)}
          onCancelScheduled={handleCancel}
          onRescheduleScheduled={handleReschedule}
          onRetryScheduled={handleRetry}
          onUnpinEvent={handleUnpinEvent}
          onEditEvent={handleEditEvent}
          onDeleteEvent={handleDeleteEvent}
          onShareEvent={setShareEvent}
        />
      )}

      {/* Saved events that couldn't resolve yet / at all. */}
      {pinsStillLoading && (
        <div className="space-y-2" data-testid="pinned-events-loading">
          <EventCardSkeleton />
          <EventCardSkeleton />
        </div>
      )}
      {pinsFailedToLoad && (
        <p className="text-xs text-muted-foreground/70 py-1.5">
          Your pinned events couldn't be loaded from relays right now.
        </p>
      )}

      {/* Past saved events, collapsed at the bottom. */}
      {pastPinnedEvents.length > 0 && (
        <div data-testid="section-past-events">
          <button
            type="button"
            onClick={() => setShowPast((s) => !s)}
            className="flex items-center gap-1.5 w-full text-left py-2 px-1 rounded-md hover:bg-muted/30 transition-colors"
            data-testid="button-toggle-past-events"
          >
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/60 transition-transform ${showPast ? "rotate-90" : ""}`} />
            <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider font-brand">Past</span>
            <span className="text-[10px] text-muted-foreground/40">({pastPinnedEvents.length})</span>
          </button>
          {showPast && (
            <div className="space-y-2 mt-1.5">
              {pastPinnedEvents.map((ce) => (
                <EventCard
                  key={ce.id}
                  ce={ce}
                  dimmed
                  actions={
                    <EventRowActions
                      ce={ce}
                      currentPubkey={pubkey}
                      onShareEvent={setShareEvent}
                      onEditEvent={handleEditEvent}
                      onDeleteEvent={handleDeleteEvent}
                      onUnpinEvent={handleUnpinEvent}
                    />
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      {shareEvent && <ShareEventDialog ce={shareEvent} onClose={() => setShareEvent(null)} />}

      {/* Month grid — long-range navigation, in a sheet instead of as hero. */}
      <Sheet open={showMonthSheet} onOpenChange={setShowMonthSheet}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl px-3 pb-6 pt-4 sm:max-w-lg sm:mx-auto">
          <SheetHeader className="mb-2">
            <SheetTitle className="text-xs font-brand uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left">
              Jump to a day
            </SheetTitle>
          </SheetHeader>
          <CalendarGrid
            year={year}
            month={month}
            loading={loading}
            items={filteredItems}
            holidays={filteredHolidaysEnabled ? holidays : []}
            selectedDay={selectedDay}
            onSelectDay={handleGridSelectDay}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
            onGoToToday={() => { setShowMonthSheet(false); goToToday(); }}
            monthLabel={monthLabel}
            onRefresh={onRefreshFeeds}
            refreshing={feedsRefreshing || creatorsRefreshing}
          />
        </SheetContent>
      </Sheet>

      <EventSearchPanel
        open={showEventSearch}
        onOpenChange={setShowEventSearch}
        followedPubkeys={follows}
        onPinChange={loadPinnedEvents}
      />

      {pubkey && (
        <HolidayManager
          open={showHolidayManager}
          onOpenChange={(v) => { setShowHolidayManager(v); if (!v) setEditingEvent(null); }}
          pubkey={pubkey}
          year={year}
          onChanged={() => {
            setHolidayRefreshKey((k) => k + 1);
            loadPinnedEvents();
          }}
          signer={signer}
          follows={follows}
          editEvent={editingEvent}
        />
      )}

      {pubkey && (
        <SubscriptionManager
          open={showSubscriptionManager}
          onOpenChange={setShowSubscriptionManager}
          pubkey={pubkey}
          onChanged={() => setFeedRefreshKey((k) => k + 1)}
          onCreatorsChanged={() => setCreatorRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
