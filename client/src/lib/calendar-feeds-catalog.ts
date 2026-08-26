export interface FeedCatalogEntry {
  id: string;
  name: string;
  emoji: string;
  url: string;
  category: string;
  subcategory?: string;
}

export interface FeedCategory {
  id: string;
  name: string;
  emoji: string;
  feeds: FeedCatalogEntry[];
}

const catalog: FeedCatalogEntry[] = [
  // ── Sports: Formula 1 ──
  { id: "f1-full", name: "F1 Race Calendar", emoji: "🏎️", url: "https://files-f1.motorsportcalendars.com/f1-calendar_p1_p2_p3_q_gp.ics", category: "sports", subcategory: "Formula 1" },
  { id: "f1-races-only", name: "F1 Races Only", emoji: "🏎️", url: "https://files-f1.motorsportcalendars.com/f1-calendar_gp_only.ics", category: "sports", subcategory: "Formula 1" },

  // ── Holidays ──
  { id: "holidays-us", name: "US Holidays", emoji: "🇺🇸", url: "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-uk", name: "UK Holidays", emoji: "🇬🇧", url: "https://calendar.google.com/calendar/ical/en.uk%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-canada", name: "Canadian Holidays", emoji: "🇨🇦", url: "https://calendar.google.com/calendar/ical/en.canadian%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-australia", name: "Australian Holidays", emoji: "🇦🇺", url: "https://calendar.google.com/calendar/ical/en.australian%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-india", name: "Indian Holidays", emoji: "🇮🇳", url: "https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-germany", name: "German Holidays", emoji: "🇩🇪", url: "https://calendar.google.com/calendar/ical/en.german%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-france", name: "French Holidays", emoji: "🇫🇷", url: "https://calendar.google.com/calendar/ical/en.french%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-japan", name: "Japanese Holidays", emoji: "🇯🇵", url: "https://calendar.google.com/calendar/ical/en.japanese%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-brazil", name: "Brazilian Holidays", emoji: "🇧🇷", url: "https://calendar.google.com/calendar/ical/en.brazilian%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },
  { id: "holidays-mexico", name: "Mexican Holidays", emoji: "🇲🇽", url: "https://calendar.google.com/calendar/ical/en.mexican%23holiday%40group.v.calendar.google.com/public/basic.ics", category: "holidays", subcategory: "Public Holidays" },

  // ── Astronomy & Space ──
  { id: "moon-phases", name: "Moon Phases", emoji: "🌙", url: "https://calendar.google.com/calendar/ical/ht3jlfaac5lfd6263ulfh4tql8%40group.calendar.google.com/public/basic.ics", category: "space", subcategory: "Astronomy" },

  // ── Time & Date ──
  { id: "world-holidays", name: "World Holidays", emoji: "🌍", url: "https://www.timeanddate.com/scripts/ics.php?type=hl&lng=en&country=1", category: "holidays", subcategory: "World Holidays" },
];

export const FEED_CATEGORIES: FeedCategory[] = [
  {
    id: "holidays",
    name: "Holidays",
    emoji: "🎉",
    feeds: catalog.filter((f) => f.category === "holidays"),
  },
  {
    id: "space",
    name: "Space",
    emoji: "🔭",
    feeds: catalog.filter((f) => f.category === "space"),
  },
];

export function getCatalogFeedById(id: string): FeedCatalogEntry | undefined {
  return catalog.find((f) => f.id === id);
}

export function getAllCatalogFeeds(): FeedCatalogEntry[] {
  return catalog;
}
