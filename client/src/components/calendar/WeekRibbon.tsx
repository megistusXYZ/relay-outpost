// Compact horizontal week strip at the top of the agenda-first Calendar page:
// 7 day chips (Sun–Sat), arrows/swipe to move between weeks, per-day activity
// dots in the calendar's existing color language, today in violet. Tapping a
// day selects it (the page scrolls the agenda to that day's section). The
// month grid survives behind the "Month" affordance as a sheet, not as the
// page hero.
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, CalendarDays, RefreshCw } from "lucide-react";
import { addDays, dayKeyLocal } from "@/lib/calendar-agenda";
import { isSameDay } from "@/lib/calendar-utils";

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

interface WeekRibbonProps {
  /** First day (Sunday) of the displayed week. */
  weekStart: Date;
  today: Date;
  selectedDay: Date | null;
  /** local "YYYY-MM-DD" → dot color classes (from buildDayDotMap). */
  dotMap: Map<string, string[]>;
  onSelectDay: (day: Date) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onGoToToday: () => void;
  onOpenMonth: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function WeekRibbon({
  weekStart,
  today,
  selectedDay,
  dotMap,
  onSelectDay,
  onPrevWeek,
  onNextWeek,
  onGoToToday,
  onOpenMonth,
  onRefresh,
  refreshing,
}: WeekRibbonProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekEnd = days[6];
  const isCurrentWeek = today >= weekStart && today <= addDays(weekStart, 6);

  // Label the week by the month most of it sits in (the Thursday pivot).
  const pivot = days[4];
  const monthLabel = pivot.toLocaleDateString([], {
    month: "long",
    ...(pivot.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });

  // Light swipe support: horizontal drags over the chip row page the week.
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) onNextWeek();
      else onPrevWeek();
    }
  };

  return (
    <div
      className="glass-card rounded-lg border px-2 pt-2 pb-1.5"
      data-testid="week-ribbon"
    >
      <div className="flex items-center justify-between px-1 mb-1">
        <span className="text-[10px] font-brand uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {monthLabel}
        </span>
        <div className="flex items-center gap-0.5">
          {!isCurrentWeek && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2 text-brand"
              onClick={onGoToToday}
              data-testid="button-ribbon-today"
            >
              Today
            </Button>
          )}
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-gray-400 dark:text-gray-500 hover:text-brand"
              onClick={onRefresh}
              disabled={refreshing}
              title="Refresh feeds"
              data-testid="button-ribbon-refresh"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-gray-500 dark:text-gray-400 hover:text-brand flex items-center gap-1"
            onClick={onOpenMonth}
            title="Jump to month"
            data-testid="button-open-month"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Month
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-0.5" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-6 p-0 shrink-0 text-gray-400 dark:text-gray-500"
          onClick={onPrevWeek}
          aria-label="Previous week"
          data-testid="button-prev-week"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <div className="flex-1 grid grid-cols-7 gap-0.5">
          {days.map((day, i) => {
            const isToday = isSameDay(day, today);
            const isSelected = !!selectedDay && isSameDay(day, selectedDay);
            const isPast = day < today && !isToday;
            const dots = dotMap.get(dayKeyLocal(day)) || [];
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelectDay(day)}
                className={`
                  flex flex-col items-center justify-center gap-0.5 py-1 min-h-[48px] rounded-lg
                  transition-colors touch-manipulation
                  ${isSelected
                    ? "bg-brand dark:bg-brand/10 ring-1 ring-brand dark:ring-brand/40"
                    : "hover:bg-gray-100 dark:hover:bg-white/[0.06]"}
                  ${isPast && !isSelected ? "opacity-50" : ""}
                `}
                aria-label={day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                aria-pressed={isSelected}
                data-testid={`ribbon-day-${dayKeyLocal(day)}`}
              >
                <span className={`text-[9px] uppercase tracking-wider font-medium ${isToday ? "text-brand" : "text-gray-400 dark:text-gray-500"}`}>
                  {WEEKDAY_LETTERS[day.getDay()]}
                </span>
                <span className={`text-[13px] leading-none font-medium ${
                  isToday
                    ? "text-brand font-bold"
                    : "text-gray-700 dark:text-gray-300"
                }`}>
                  {day.getDate()}
                </span>
                <span className="flex items-center gap-0.5 h-1.5">
                  {dots.slice(0, 3).map((dot, di) => (
                    <span key={di} className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-6 p-0 shrink-0 text-gray-400 dark:text-gray-500"
          onClick={onNextWeek}
          aria-label={`Next week (from ${weekEnd.toLocaleDateString()})`}
          data-testid="button-next-week"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
