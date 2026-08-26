import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, FileText, Clock, Pin, PinOff, Send, CalendarPlus, Rss, Radio, ChevronDown, ChevronRight, Pencil, Trash2, Share2 } from "lucide-react";
import type { CalendarItem, CalendarItemSubscribed, CalendarItemCreatorStream, CalendarEventData } from "@/lib/calendar-events";
import { getCalendarEventEndDate } from "@/lib/calendar-events";
import { EventCard } from "@/components/EventCard";
import type { Holiday } from "@/lib/calendar-holidays";
import { isSameDay } from "@/lib/calendar-utils";
import { ShareReminderDialog } from "./ShareReminderDialog";
import { ScheduledPostCard } from "./ScheduledPostCard";
import type { ScheduledPostWithDecrypted } from "@/lib/schedule";
import { CreatorStreamCard, FeedEventCard, HolidayRow, PublishedPostCard } from "./CalendarItemRows";

function CollapsibleSection({
  icon,
  label,
  count,
  colorClass,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  colorClass: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 w-full text-left group mb-1.5`}
      >
        {open ? (
          <ChevronDown className={`w-3 h-3 ${colorClass}`} />
        ) : (
          <ChevronRight className={`w-3 h-3 ${colorClass}`} />
        )}
        <span className="flex items-center gap-1.5">
          {icon}
          <span className={`text-[10px] font-brand uppercase tracking-wider ${colorClass}`}>
            {label}
          </span>
        </span>
        <span className={`text-[10px] ${colorClass} opacity-60`}>({count})</span>
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </div>
  );
}

interface DayDetailProps {
  selectedDay: Date;
  items: CalendarItem[];
  holidays: Holiday[];
  onClose: () => void;
  onCancelScheduled: (id: number) => void;
  onRescheduleScheduled: (id: number, newTime: Date) => void;
  onRetryScheduled?: (id: number) => void;
  onUnpinEvent: (eventId: string) => void;
  currentPubkey?: string | null;
  onEditEvent?: (ce: CalendarEventData) => void;
  onDeleteEvent?: (ce: CalendarEventData) => void;
  onShareEvent?: (ce: CalendarEventData) => void;
}

export function DayDetail({
  selectedDay,
  items,
  holidays,
  onClose,
  onCancelScheduled,
  onRescheduleScheduled,
  onRetryScheduled,
  onUnpinEvent,
  currentPubkey,
  onEditEvent,
  onDeleteEvent,
  onShareEvent,
}: DayDetailProps) {
  const dayItems = useMemo(() => {
    const sel = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate()).getTime();
    return items.filter((item) => {
      if (isSameDay(item.date, selectedDay)) return true;
      // Multi-day calendar events also belong to every day in their range.
      if (item.type === "pinned-event") {
        const end = getCalendarEventEndDate(item.calendarEvent);
        if (end) {
          const start = new Date(item.date.getFullYear(), item.date.getMonth(), item.date.getDate()).getTime();
          const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
          return sel >= start && sel <= endDay;
        }
      }
      return false;
    });
  }, [items, selectedDay]);

  const dayHolidays = useMemo(() => {
    return holidays.filter((h) =>
      h.month === selectedDay.getMonth() && h.day === selectedDay.getDate()
    );
  }, [holidays, selectedDay]);

  const { scheduledItems, publishedItems, pinnedItems, subscribedItems, creatorStreamItems } = useMemo(() => {
    const scheduled = dayItems.filter((i) => i.type === "scheduled");
    const published = dayItems.filter((i) => i.type === "published");
    const pinned = dayItems.filter((i) => i.type === "pinned-event");
    const subscribed = dayItems.filter((i): i is CalendarItemSubscribed => i.type === "subscribed");
    const streams = dayItems.filter((i): i is CalendarItemCreatorStream => i.type === "creator-stream");
    return { scheduledItems: scheduled, publishedItems: published, pinnedItems: pinned, subscribedItems: subscribed, creatorStreamItems: streams };
  }, [dayItems]);

  const [shareHoliday, setShareHoliday] = useState<Holiday | null>(null);

  const hasContent = dayItems.length > 0 || dayHolidays.length > 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isFutureDay = selectedDay >= today;

  const openScheduleForDay = () => {
    window.dispatchEvent(new CustomEvent("open-compose-schedule", { detail: { date: selectedDay.toISOString() } }));
  };

  return (
    <>
    <Card className="glass-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-brand uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {selectedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            onClick={onClose}
            data-testid="button-close-day-detail"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        {!hasContent ? (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Nothing on this day.
            </p>
            {isFutureDay && (
              <Button
                size="sm"
                className="mt-3 h-8 px-4 text-xs bg-brand hover:bg-brand text-white"
                onClick={openScheduleForDay}
              >
                <Send className="w-3 h-3 mr-1.5" />
                Schedule a Post for {selectedDay.toLocaleDateString([], { month: "short", day: "numeric" })}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {isFutureDay && (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-xs border-brand dark:border-brand/30 text-brand hover:bg-brand dark:hover:bg-brand/10 hover:text-brand-strong"
                onClick={openScheduleForDay}
              >
                <CalendarPlus className="w-3 h-3 mr-1.5" />
                Schedule a Post
              </Button>
            )}

            {dayHolidays.length > 0 && (
              <div className="space-y-1.5">
                {dayHolidays.map((h) => (
                  <HolidayRow key={h.id} holiday={h} onShare={setShareHoliday} />
                ))}
              </div>
            )}

            {scheduledItems.length > 0 && (
              <CollapsibleSection
                icon={<Clock className="w-3 h-3 text-brand" />}
                label="Scheduled"
                count={scheduledItems.length}
                colorClass="text-brand"
              >
                {scheduledItems.map((item) => (
                  <ScheduledPostCard
                    key={item.id}
                    post={item.data as ScheduledPostWithDecrypted}
                    onCancel={onCancelScheduled}
                    onReschedule={onRescheduleScheduled}
                    onRetry={onRetryScheduled}
                  />
                ))}
              </CollapsibleSection>
            )}

            {publishedItems.length > 0 && (
              <CollapsibleSection
                icon={<FileText className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />}
                label="Published"
                count={publishedItems.length}
                colorClass="text-emerald-600 dark:text-emerald-400"
              >
                {publishedItems.map((item) =>
                  item.type === "published" ? <PublishedPostCard key={item.id} item={item} /> : null,
                )}
              </CollapsibleSection>
            )}

            {pinnedItems.length > 0 && (
              <CollapsibleSection
                icon={<Pin className="w-3 h-3 text-sky-600 dark:text-sky-400" />}
                label="Pinned Events"
                count={pinnedItems.length}
                colorClass="text-sky-600 dark:text-sky-400"
              >
                {pinnedItems.map((item) => {
                  if (item.type !== "pinned-event") return null;
                  const ce = item.calendarEvent;
                  return (
                    <EventCard
                      key={item.id}
                      ce={ce}
                      actions={
                        <>
                          {onShareEvent && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-gray-400 dark:text-gray-500 hover:text-brand"
                              onClick={() => onShareEvent(ce)}
                              title="Share to feed"
                              data-testid={`button-share-day-event-${ce.id.slice(0, 8)}`}
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {currentPubkey && ce.pubkey === currentPubkey ? (
                            <>
                              {onEditEvent && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-gray-400 dark:text-gray-500 hover:text-sky-500 dark:hover:text-sky-400"
                                  onClick={() => onEditEvent(ce)}
                                  title="Edit event"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {onDeleteEvent && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400"
                                  onClick={() => onDeleteEvent(ce)}
                                  title="Delete event"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
                              onClick={() => onUnpinEvent(ce.id)}
                              title="Unpin"
                            >
                              <PinOff className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </>
                      }
                    />
                  );
                })}
              </CollapsibleSection>
            )}

            {subscribedItems.length > 0 && (
              <CollapsibleSection
                icon={<Rss className="w-3 h-3 text-rose-600 dark:text-rose-400" />}
                label="Feed Events"
                count={subscribedItems.length}
                colorClass="text-rose-600 dark:text-rose-400"
              >
                {subscribedItems.map((item) => (
                  <FeedEventCard key={item.id} item={item} />
                ))}
              </CollapsibleSection>
            )}

            {creatorStreamItems.length > 0 && (
              <CollapsibleSection
                icon={<Radio className="w-3 h-3 text-brand" />}
                label="Creator Streams"
                count={creatorStreamItems.length}
                colorClass="text-brand"
              >
                {creatorStreamItems.map((item) => (
                  <CreatorStreamCard key={item.id} item={item} />
                ))}
              </CollapsibleSection>
            )}

          </div>
        )}
      </CardContent>
    </Card>

      {shareHoliday && (
        <ShareReminderDialog
          open={!!shareHoliday}
          onOpenChange={(v) => { if (!v) setShareHoliday(null); }}
          holiday={shareHoliday}
          selectedDay={selectedDay}
        />
      )}
    </>
  );
}
