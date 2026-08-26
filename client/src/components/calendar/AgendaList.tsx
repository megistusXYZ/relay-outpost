// The agenda — the Calendar page's hero. A scrolling list of day sections
// ("Today", "Tomorrow", then day-by-day) over the next ~30 days; only days
// with content render. Rows reuse the same shared renderers as DayDetail
// (ScheduledPostCard / EventCard / CalendarItemRows) so an item looks the same
// wherever it appears.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, X, PinOff, Pencil, Trash2, Share2 } from "lucide-react";
import type { CalendarItem, CalendarEventData } from "@/lib/calendar-events";
import type { ScheduledPostWithDecrypted } from "@/lib/schedule";
import type { Holiday } from "@/lib/calendar-holidays";
import { agendaDayLabel, type AgendaDay } from "@/lib/calendar-agenda";
import { EventCard } from "@/components/EventCard";
import { ScheduledPostCard } from "./ScheduledPostCard";
import { ShareReminderDialog } from "./ShareReminderDialog";
import { CreatorStreamCard, FeedEventCard, HolidayRow, PublishedPostCard } from "./CalendarItemRows";

// The owner/viewer action cluster for a saved-event row: share always; then
// edit + delete for the user's OWN events, unpin for everyone else's. Shared
// by the agenda sections and the collapsed Past list on the page.
export function EventRowActions({
  ce,
  currentPubkey,
  onShareEvent,
  onEditEvent,
  onDeleteEvent,
  onUnpinEvent,
}: {
  ce: CalendarEventData;
  currentPubkey: string;
  onShareEvent: (ce: CalendarEventData) => void;
  onEditEvent: (ce: CalendarEventData) => void;
  onDeleteEvent: (ce: CalendarEventData) => void;
  onUnpinEvent: (eventId: string) => void;
}) {
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0 text-gray-400 dark:text-gray-500 hover:text-brand"
        onClick={() => onShareEvent(ce)}
        title="Share to feed"
        data-testid={`button-share-agenda-${ce.id.slice(0, 8)}`}
      >
        <Share2 className="w-3.5 h-3.5" />
      </Button>
      {ce.pubkey === currentPubkey ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-gray-400 dark:text-gray-500 hover:text-sky-500 dark:hover:text-sky-400"
            onClick={() => onEditEvent(ce)}
            title="Edit event"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400"
            onClick={() => onDeleteEvent(ce)}
            title="Delete event"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400"
          onClick={() => onUnpinEvent(ce.id)}
          title="Unpin"
        >
          <PinOff className="w-3.5 h-3.5" />
        </Button>
      )}
    </>
  );
}

interface AgendaListProps {
  days: AgendaDay[];
  today: Date;
  currentPubkey: string;
  /** Local day key of the currently selected day (ribbon/grid tap), if any. */
  selectedKey?: string | null;
  onClearSelection?: () => void;
  onCancelScheduled: (id: number) => void;
  onRescheduleScheduled: (id: number, newTime: Date) => void;
  onRetryScheduled?: (id: number) => void;
  onUnpinEvent: (eventId: string) => void;
  onEditEvent: (ce: CalendarEventData) => void;
  onDeleteEvent: (ce: CalendarEventData) => void;
  onShareEvent: (ce: CalendarEventData) => void;
}

export function AgendaList({
  days,
  today,
  currentPubkey,
  selectedKey,
  onClearSelection,
  onCancelScheduled,
  onRescheduleScheduled,
  onRetryScheduled,
  onUnpinEvent,
  onEditEvent,
  onDeleteEvent,
  onShareEvent,
}: AgendaListProps) {
  const [shareHoliday, setShareHoliday] = useState<{ holiday: Holiday; day: Date } | null>(null);

  const renderEventActions = (ce: CalendarEventData) => (
    <EventRowActions
      ce={ce}
      currentPubkey={currentPubkey}
      onShareEvent={onShareEvent}
      onEditEvent={onEditEvent}
      onDeleteEvent={onDeleteEvent}
      onUnpinEvent={onUnpinEvent}
    />
  );

  const renderItem = (day: AgendaDay, item: CalendarItem) => {
    const key = `${day.key}-${item.id}`;
    switch (item.type) {
      case "scheduled":
        return (
          <ScheduledPostCard
            key={key}
            post={item.data as ScheduledPostWithDecrypted}
            onCancel={onCancelScheduled}
            onReschedule={onRescheduleScheduled}
            onRetry={onRetryScheduled}
          />
        );
      case "published":
        return <PublishedPostCard key={key} item={item} />;
      case "pinned-event":
        return <EventCard key={key} ce={item.calendarEvent} actions={renderEventActions(item.calendarEvent)} />;
      case "subscribed":
        return <FeedEventCard key={key} item={item} />;
      case "creator-stream":
        return <CreatorStreamCard key={key} item={item} />;
      default:
        return null;
    }
  };

  const openScheduleForDay = (day: Date) => {
    window.dispatchEvent(new CustomEvent("open-compose-schedule", { detail: { date: day.toISOString() } }));
  };

  return (
    <div className="space-y-5" data-testid="calendar-agenda">
      {days.map((day) => {
        const { primary, secondary } = agendaDayLabel(day.date, today);
        const isToday = primary === "Today";
        const isEmpty = day.items.length === 0 && day.holidays.length === 0;
        const isSelected = selectedKey === day.key;
        return (
          <section key={day.key} id={`agenda-day-${day.key}`} className="scroll-mt-28" data-testid={`agenda-day-${day.key}`}>
            <div className="flex items-baseline gap-2 mb-2">
              <h3
                className={`text-[10px] font-brand uppercase tracking-wider ${
                  isToday ? "text-brand" : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {primary}
              </h3>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">{secondary}</span>
              {isSelected && onClearSelection && (
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="ml-auto text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1 -m-1"
                  aria-label="Clear day selection"
                  data-testid="button-clear-day-selection"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {isEmpty ? (
              // Only selected days render empty (buildAgendaDays skips
              // contentless days otherwise) — offer the day-scoped schedule CTA.
              <div className="rounded-lg border border-dashed border-gray-200 dark:border-white/10 py-4 text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Nothing on this day.</p>
                {day.date >= today && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-[11px] border-brand dark:border-brand/30 text-brand hover:bg-brand dark:hover:bg-brand/10"
                    onClick={() => openScheduleForDay(day.date)}
                    data-testid="button-schedule-empty-day"
                  >
                    <Send className="w-3 h-3 mr-1.5" />
                    Schedule a post
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {day.holidays.map((h) => (
                  <HolidayRow key={`${day.key}-${h.id}`} holiday={h} onShare={(holiday) => setShareHoliday({ holiday, day: day.date })} />
                ))}
                {day.items.map((item) => renderItem(day, item))}
              </div>
            )}
          </section>
        );
      })}

      {shareHoliday && (
        <ShareReminderDialog
          open={!!shareHoliday}
          onOpenChange={(v) => { if (!v) setShareHoliday(null); }}
          holiday={shareHoliday.holiday}
          selectedDay={shareHoliday.day}
        />
      )}
    </div>
  );
}
