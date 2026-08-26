export type RecurrenceType = "once" | "weekly" | "monthly" | "yearly";

export interface Holiday {
  id: string;
  name: string;
  month: number;
  day: number;
  isBuiltIn: boolean;
  note?: string;
  year?: number;
  emoji?: string;
  url?: string;
  recurrence?: RecurrenceType;
}

export interface CustomHoliday {
  id: string;
  name: string;
  month: number;
  day: number;
  note?: string;
  year?: number;
  emoji?: string;
  url?: string;
  recurrence?: RecurrenceType;
  weekday?: number;
}

function easterDate(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): number {
  const first = new Date(year, month, 1);
  let day = 1 + ((weekday - first.getDay() + 7) % 7);
  day += (nth - 1) * 7;
  return day;
}

function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const lastDate = new Date(year, month, lastDay);
  const diff = (lastDate.getDay() - weekday + 7) % 7;
  return lastDay - diff;
}

const builtInCache = new Map<number, Holiday[]>();

export function getBuiltInHolidays(year: number): Holiday[] {
  const cached = builtInCache.get(year);
  if (cached) return cached;

  const easter = easterDate(year);

  const holidays: Holiday[] = [
    { id: "new-years-day", name: "New Year's Day", month: 0, day: 1, isBuiltIn: true, emoji: "🎆" },
    { id: "valentines-day", name: "Valentine's Day", month: 1, day: 14, isBuiltIn: true, emoji: "❤️" },
    { id: "st-patricks-day", name: "St. Patrick's Day", month: 2, day: 17, isBuiltIn: true, emoji: "☘️" },
    { id: "easter", name: "Easter", month: easter.month, day: easter.day, isBuiltIn: true, emoji: "🐣", year },
    { id: "mothers-day", name: "Mother's Day", month: 4, day: nthWeekday(year, 4, 0, 2), isBuiltIn: true, emoji: "💐", year },
    { id: "memorial-day", name: "Memorial Day", month: 4, day: lastWeekday(year, 4, 1), isBuiltIn: true, emoji: "🇺🇸", year },
    { id: "fathers-day", name: "Father's Day", month: 5, day: nthWeekday(year, 5, 0, 3), isBuiltIn: true, emoji: "👔", year },
    { id: "independence-day", name: "Independence Day", month: 6, day: 4, isBuiltIn: true, emoji: "🎆" },
    { id: "labor-day", name: "Labor Day", month: 8, day: nthWeekday(year, 8, 1, 1), isBuiltIn: true, emoji: "⚒️", year },
    { id: "halloween", name: "Halloween", month: 9, day: 31, isBuiltIn: true, emoji: "🎃" },
    { id: "veterans-day", name: "Veterans Day", month: 10, day: 11, isBuiltIn: true, emoji: "🎖️" },
    { id: "thanksgiving", name: "Thanksgiving", month: 10, day: nthWeekday(year, 10, 4, 4), isBuiltIn: true, emoji: "🦃", year },
    { id: "christmas-eve", name: "Christmas Eve", month: 11, day: 24, isBuiltIn: true, emoji: "🎄" },
    { id: "christmas", name: "Christmas Day", month: 11, day: 25, isBuiltIn: true, emoji: "🎁" },
    { id: "new-years-eve", name: "New Year's Eve", month: 11, day: 31, isBuiltIn: true, emoji: "🥂" },
  ];

  builtInCache.set(year, holidays);
  return holidays;
}

const CUSTOM_HOLIDAYS_PREFIX = "relay-outpost-custom-holidays";
const HIDDEN_HOLIDAYS_PREFIX = "relay-outpost-hidden-holidays";

function customHolidaysKey(pubkey: string): string {
  return `${CUSTOM_HOLIDAYS_PREFIX}:${pubkey}`;
}

function hiddenHolidaysKey(pubkey: string): string {
  return `${HIDDEN_HOLIDAYS_PREFIX}:${pubkey}`;
}

export function getCustomHolidays(pubkey: string): CustomHoliday[] {
  try {
    const raw = localStorage.getItem(customHolidaysKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomHolidays(pubkey: string, holidays: CustomHoliday[]): void {
  localStorage.setItem(customHolidaysKey(pubkey), JSON.stringify(holidays));
}

export function addCustomHoliday(pubkey: string, holiday: Omit<CustomHoliday, "id">): CustomHoliday {
  const existing = getCustomHolidays(pubkey);
  const newHoliday: CustomHoliday = {
    ...holiday,
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  existing.push(newHoliday);
  saveCustomHolidays(pubkey, existing);
  return newHoliday;
}

export function updateCustomHoliday(pubkey: string, id: string, updates: Partial<Omit<CustomHoliday, "id">>): void {
  const existing = getCustomHolidays(pubkey);
  const idx = existing.findIndex((h) => h.id === id);
  if (idx === -1) return;
  existing[idx] = { ...existing[idx], ...updates };
  saveCustomHolidays(pubkey, existing);
}

export function deleteCustomHoliday(pubkey: string, id: string): void {
  const existing = getCustomHolidays(pubkey);
  saveCustomHolidays(pubkey, existing.filter((h) => h.id !== id));
}

export function getHiddenHolidayIds(pubkey: string): string[] {
  try {
    const raw = localStorage.getItem(hiddenHolidaysKey(pubkey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setHiddenHolidayIds(pubkey: string, ids: string[]): void {
  localStorage.setItem(hiddenHolidaysKey(pubkey), JSON.stringify(ids));
}

export function toggleHiddenHoliday(pubkey: string, holidayId: string): void {
  const hidden = getHiddenHolidayIds(pubkey);
  if (hidden.includes(holidayId)) {
    setHiddenHolidayIds(pubkey, hidden.filter((id) => id !== holidayId));
  } else {
    setHiddenHolidayIds(pubkey, [...hidden, holidayId]);
  }
}

export function getHolidaysForMonth(pubkey: string, year: number, month: number): Holiday[] {
  const builtIn = getBuiltInHolidays(year);
  const hidden = getHiddenHolidayIds(pubkey);
  const custom = getCustomHolidays(pubkey);

  const visibleBuiltIn = builtIn
    .filter((h) => h.month === month && !hidden.includes(h.id));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const customForMonth: Holiday[] = [];

  for (const h of custom) {
    const rec = h.recurrence || (h.year ? "once" : "yearly");

    if (rec === "once") {
      if (h.month === month && h.year === year) {
        customForMonth.push({ ...h, isBuiltIn: false });
      }
    } else if (rec === "yearly") {
      if (h.month === month) {
        customForMonth.push({ ...h, isBuiltIn: false });
      }
    } else if (rec === "monthly") {
      if (h.day <= daysInMonth) {
        customForMonth.push({ ...h, isBuiltIn: false, month });
      }
    } else if (rec === "weekly") {
      const dayOfWeek = h.weekday ?? new Date(h.year || year, h.month, h.day).getDay();
      for (let d = 1; d <= daysInMonth; d++) {
        const dt = new Date(year, month, d);
        if (dt.getDay() === dayOfWeek) {
          customForMonth.push({ ...h, isBuiltIn: false, id: `${h.id}-w${d}`, month, day: d });
        }
      }
    }
  }

  return [...visibleBuiltIn, ...customForMonth];
}

export function getHolidaysForDay(pubkey: string, year: number, month: number, day: number): Holiday[] {
  return getHolidaysForMonth(pubkey, year, month).filter((h) => h.day === day);
}
