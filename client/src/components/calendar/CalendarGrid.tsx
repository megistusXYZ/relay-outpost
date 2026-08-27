import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import type { CalendarItem } from "@/lib/calendar-events";
import { getCalendarEventEndDate } from "@/lib/calendar-events";
import type { Holiday } from "@/lib/calendar-holidays";
import { isSameDay } from "@/lib/calendar-utils";

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startPad = firstDay.getDay();
  for (let i = startPad - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

  const endPad = 6 - lastDay.getDay();
  for (let i = 1; i <= endPad; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

interface CalendarGridProps {
  year: number;
  month: number;
  loading: boolean;
  items: CalendarItem[];
  holidays: Holiday[];
  selectedDay: Date | null;
  onSelectDay: (day: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onGoToToday: () => void;
  monthLabel: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function CalendarGrid({
  year,
  month,
  loading,
  items,
  holidays,
  selectedDay,
  onSelectDay,
  onPrevMonth,
  onNextMonth,
  onGoToToday,
  monthLabel,
  onRefresh,
  refreshing,
}: CalendarGridProps) {
  const today = new Date();
  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    const addTo = (key: string, item: CalendarItem) => {
      const existing = map.get(key) || [];
      existing.push(item);
      map.set(key, existing);
    };
    for (const item of items) {
      // Multi-day calendar events should show on every day they span, not only
      // the start day. Scoped to our own pinned calendar events (end date is
      // inclusive as we publish it); other item types stay single-day.
      let end: Date | null = null;
      if (item.type === "pinned-event") end = getCalendarEventEndDate(item.calendarEvent);
      if (end && end.getTime() > item.date.getTime()) {
        const cur = new Date(item.date.getFullYear(), item.date.getMonth(), item.date.getDate());
        const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        let guard = 0;
        while (cur.getTime() <= last.getTime() && guard < 366) {
          addTo(dayKey(cur), item);
          cur.setDate(cur.getDate() + 1);
          guard++;
        }
      } else {
        addTo(dayKey(item.date), item);
      }
    }
    return map;
  }, [items]);

  const holidaysByDay = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    for (const h of holidays) {
      const key = `${year}-${h.month}-${h.day}`;
      const existing = map.get(key) || [];
      existing.push(h);
      map.set(key, existing);
    }
    return map;
  }, [holidays, year]);

  return (
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] p-0" onClick={onPrevMonth} aria-label="Previous month">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-brand uppercase tracking-wider text-gray-900 dark:text-gray-100">{monthLabel}</span>
            <Button variant="ghost" size="sm" className="min-h-[36px] text-[10px] px-2.5 text-gray-500 dark:text-gray-400" onClick={onGoToToday}>
              Today
            </Button>
          </div>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-[44px] min-w-[44px] p-0 text-gray-400 dark:text-gray-500 hover:text-brand"
                onClick={onRefresh}
                disabled={refreshing}
                title="Refresh feeds"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            )}
            <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] p-0" onClick={onNextMonth} aria-label="Next month">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px mb-1">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400 py-1 font-medium">
              {d}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RelayOutpostInlineLoader className="w-6 h-6 text-brand" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-px">
            {days.map((day, i) => {
              const isCurrentMonth = day.getMonth() === month;
              const isToday = isSameDay(day, today);
              const isSelected = selectedDay && isSameDay(day, selectedDay);
              const key = dayKey(day);
              const dayItems = itemsByDay.get(key) || [];
              const dayHolidays = isCurrentMonth ? (holidaysByDay.get(key) || []) : [];

              return (
                <button
                  key={i}
                  onClick={() => onSelectDay(day)}
                  className={`
                    relative p-1.5 min-h-[52px] md:min-h-[64px] rounded-md text-left transition-colors
                    ${isCurrentMonth
                      ? "hover:bg-gray-100 dark:hover:bg-white/[0.06]"
                      : "opacity-40"
                    }
                    ${isSelected
                      ? "bg-brand dark:bg-brand/10 ring-1 ring-brand dark:ring-brand/40"
                      : ""
                    }
                    ${isToday && !isSelected
                      ? "bg-gray-50 dark:bg-white/[0.04]"
                      : ""
                    }
                  `}
                >
                  <span
                    className={`
                      text-[11px] font-medium
                      ${isToday
                        ? "text-brand font-bold"
                        : isCurrentMonth
                          ? "text-gray-700 dark:text-gray-300"
                          : "text-gray-400 dark:text-gray-600"
                      }
                    `}
                  >
                    {day.getDate()}
                  </span>
                  {dayHolidays.length > 0 && (
                    <div className="mt-0.5 hidden md:block">
                      <span className="text-[8px] leading-tight text-amber-600 dark:text-amber-400 line-clamp-1 block">
                        {dayHolidays[0].emoji ? `${dayHolidays[0].emoji} ` : ""}{dayHolidays[0].name}
                      </span>
                    </div>
                  )}
                  {dayHolidays.length > 0 && (
                    <div className="mt-0.5 md:hidden">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                    </div>
                  )}
                  {dayItems.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-0.5">
                      {dayItems.slice(0, 4).map((item, idx) => (
                        <div key={`${item.id}-${idx}`} className={`w-1.5 h-1.5 rounded-full ${item.dotColor}`} />
                      ))}
                      {dayItems.length > 4 && (
                        <span className="text-[8px] text-gray-500 dark:text-gray-400">+{dayItems.length - 4}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
