import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout } from "@/lib/signer-timeout";
import type { ISigner } from "applesauce-signers";
import type { Event } from "nostr-tools";
import {
  Star,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Pencil,
  Check,
  X,
  Link,
  Repeat,
  CalendarPlus,
  CalendarDays,
  MapPin,
  Clock,
  Users,
  Search,
  Bell,
  Loader2,
  Send,
  Globe,
  Lock,
  Video,
} from "lucide-react";
import {
  getBuiltInHolidays,
  getCustomHolidays,
  getHiddenHolidayIds,
  toggleHiddenHoliday,
  addCustomHoliday,
  updateCustomHoliday,
  deleteCustomHoliday,
  type CustomHoliday,
  type RecurrenceType,
} from "@/lib/calendar-holidays";
import { MONTH_NAMES } from "@/lib/calendar-utils";
import {
  KIND_DATE_CALENDAR_EVENT,
  KIND_TIME_CALENDAR_EVENT,
  pinEvent,
  parseCalendarEvent,
  savePrivateEvent,
  type CalendarEventData,
} from "@/lib/calendar-events";
import { publishEvent, getCachedProfile, searchCachedProfiles, fetchProfilesCached } from "@/lib/nostr";
import { searchUsers } from "@/lib/primal-cache";
import { createGiftWrap, getDMRelaysForContact, publishWithFallback } from "@/lib/dm";
import { fetchDMRelayList } from "@/lib/outbox";
import { createScheduledPost } from "@/lib/schedule";

interface HolidayManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pubkey: string;
  year: number;
  onChanged: () => void;
  signer: ISigner | null;
  follows: string[];
  editEvent?: CalendarEventData | null;
}

function getProfileDisplayName(pubkey: string): string {
  const profile = getCachedProfile(pubkey);
  if (!profile) return pubkey.slice(0, 8) + "...";
  try {
    const content = JSON.parse(profile.content);
    return content.display_name || content.name || pubkey.slice(0, 8) + "...";
  } catch {
    return pubkey.slice(0, 8) + "...";
  }
}

function getProfilePicture(pubkey: string): string | undefined {
  const profile = getCachedProfile(pubkey);
  if (!profile) return undefined;
  try {
    return JSON.parse(profile.content).picture;
  } catch {
    return undefined;
  }
}

type ReminderInterval = "10min" | "30min" | "1hr";
const REMINDER_OPTIONS: { value: ReminderInterval; label: string; minutes: number }[] = [
  { value: "10min", label: "10 minutes before", minutes: 10 },
  { value: "30min", label: "30 minutes before", minutes: 30 },
  { value: "1hr", label: "1 hour before", minutes: 60 },
];

export function HolidayManager({ open, onOpenChange, pubkey, year, onChanged, signer, follows, editEvent }: HolidayManagerProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"create" | "custom" | "builtin">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [formName, setFormName] = useState("");
  const [formMonth, setFormMonth] = useState(new Date().getMonth());
  const [formDay, setFormDay] = useState(new Date().getDate());
  const [formNote, setFormNote] = useState("");
  const [formEmoji, setFormEmoji] = useState("");
  const [formRecurrence, setFormRecurrence] = useState<RecurrenceType>("yearly");
  const [formUrl, setFormUrl] = useState("");
  const [formYear, setFormYear] = useState(year);

  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventEndDate, setEventEndDate] = useState("");
  const [eventStartTime, setEventStartTime] = useState("");
  const [eventEndTime, setEventEndTime] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [eventMeetingUrl, setEventMeetingUrl] = useState("");
  const [editingDTag, setEditingDTag] = useState<string | null>(null);
  const [participantSearch, setParticipantSearch] = useState("");
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [selectedReminders, setSelectedReminders] = useState<ReminderInterval[]>([]);
  const [eventPrivate, setEventPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [participantResults, setParticipantResults] = useState<{ pubkey: string; name: string; picture?: string; isFollow: boolean }[]>([]);
  const [searchingParticipants, setSearchingParticipants] = useState(false);
  const participantDebounceRef = useRef<ReturnType<typeof setTimeout>>();

  const builtInHolidays = useMemo(() => getBuiltInHolidays(year), [year]);
  const hiddenIds = useMemo(() => getHiddenHolidayIds(pubkey), [pubkey, refreshKey]);
  const customHolidays = useMemo(() => getCustomHolidays(pubkey), [pubkey, refreshKey]);

  const followsSet = useMemo(() => new Set(follows), [follows]);

  useEffect(() => {
    if (follows.length > 0) {
      fetchProfilesCached(follows.slice(0, 200));
    }
  }, [follows]);

  function eventToResult(ev: { pubkey: string; content: string }, isFollow: boolean) {
    try {
      const content = JSON.parse(ev.content);
      return {
        pubkey: ev.pubkey,
        name: content.display_name || content.name || ev.pubkey.slice(0, 8) + "...",
        picture: content.picture,
        isFollow,
      };
    } catch {
      return { pubkey: ev.pubkey, name: ev.pubkey.slice(0, 8) + "...", picture: undefined, isFollow };
    }
  }

  const handleParticipantSearch = useCallback((value: string) => {
    setParticipantSearch(value);
    const query = value.trim();

    if (!query) {
      setParticipantResults([]);
      setSearchingParticipants(false);
      return;
    }

    if (participantDebounceRef.current) clearTimeout(participantDebounceRef.current);

    const cached = searchCachedProfiles(query, 12);
    const excluded = new Set([...selectedParticipants, pubkey]);
    const seen = new Set<string>();
    const immediate: typeof participantResults = [];
    for (const ev of cached) {
      if (!excluded.has(ev.pubkey) && !seen.has(ev.pubkey)) {
        seen.add(ev.pubkey);
        immediate.push(eventToResult(ev, followsSet.has(ev.pubkey)));
      }
    }
    immediate.sort((a, b) => (a.isFollow === b.isFollow ? 0 : a.isFollow ? -1 : 1));
    setParticipantResults(immediate.slice(0, 8));

    participantDebounceRef.current = setTimeout(async () => {
      setSearchingParticipants(true);
      try {
        const remote = await searchUsers(query, 10);
        const merged: typeof participantResults = [];
        const mergedSeen = new Set<string>();
        for (const ev of [...cached, ...remote]) {
          if (!excluded.has(ev.pubkey) && !mergedSeen.has(ev.pubkey)) {
            mergedSeen.add(ev.pubkey);
            merged.push(eventToResult(ev, followsSet.has(ev.pubkey)));
          }
        }
        merged.sort((a, b) => (a.isFollow === b.isFollow ? 0 : a.isFollow ? -1 : 1));
        setParticipantResults(merged.slice(0, 8));
      } catch {}
      setSearchingParticipants(false);
    }, 300);
  }, [selectedParticipants, pubkey, followsSet]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    onChanged();
  }, [onChanged]);

  const resetForm = () => {
    setFormName("");
    setFormMonth(new Date().getMonth());
    setFormDay(new Date().getDate());
    setFormNote("");
    setFormEmoji("");
    setFormRecurrence("yearly");
    setFormUrl("");
    setFormYear(year);
    setShowAddForm(false);
    setEditingId(null);
  };

  const resetEventForm = () => {
    setEventTitle("");
    setEventDescription("");
    setEventDate("");
    setEventEndDate("");
    setEventStartTime("");
    setEventEndTime("");
    setEventLocation("");
    setEventMeetingUrl("");
    setEditingDTag(null);
    setParticipantSearch("");
    setSelectedParticipants([]);
    setSelectedReminders([]);
    setEventPrivate(false);
    setParticipantResults([]);
    setSearchingParticipants(false);
  };

  // Prefill the form when opened in edit mode. Reusing the original d-tag means
  // the republished event replaces the original (NIP-52 events are parametrized
  // replaceable), so this is a true edit rather than a duplicate.
  useEffect(() => {
    if (!open || !editEvent) return;
    const pad = (n: number) => String(n).padStart(2, "0");
    const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setTab("create");
    setEditingDTag(editEvent.dTag);
    setEventTitle(editEvent.title === "Untitled Event" ? "" : editEvent.title);
    setEventDescription(editEvent.description || "");
    setEventLocation(editEvent.location || "");
    setEventMeetingUrl(editEvent.references.find((r) => /^https?:\/\//i.test(r)) || "");
    setSelectedParticipants(editEvent.participants || []);
    if (editEvent.kind === KIND_TIME_CALENDAR_EVENT && editEvent.startTime) {
      const s = new Date(editEvent.startTime * 1000);
      setEventDate(toDateInput(s));
      setEventStartTime(toTimeInput(s));
      if (editEvent.endTime) {
        const e = new Date(editEvent.endTime * 1000);
        setEventEndTime(toTimeInput(e));
        const eDate = toDateInput(e);
        setEventEndDate(eDate !== toDateInput(s) ? eDate : "");
      } else {
        setEventEndTime("");
        setEventEndDate("");
      }
    } else {
      setEventDate(editEvent.startDate || "");
      setEventEndDate(editEvent.endDate && editEvent.endDate !== editEvent.startDate ? editEvent.endDate : "");
      setEventStartTime("");
      setEventEndTime("");
    }
  }, [open, editEvent]);

  const handleAdd = () => {
    if (!formName.trim()) return;
    try {
      addCustomHoliday(pubkey, {
        name: formName.trim(),
        month: formMonth,
        day: formDay,
        note: formNote.trim() || undefined,
        emoji: formEmoji.trim() || undefined,
        year: formRecurrence === "once" ? formYear : undefined,
        recurrence: formRecurrence,
        url: formUrl.trim() || undefined,
        weekday: formRecurrence === "weekly" ? new Date(formYear, formMonth, formDay).getDay() : undefined,
      });
      toast({ title: "Added", description: `${formName.trim()} added to your calendar.` });
      resetForm();
      refresh();
    } catch {
      toast({ title: "Error", description: "Failed to save. Please try again.", variant: "destructive" });
    }
  };

  const handleUpdate = () => {
    if (!editingId || !formName.trim()) return;
    try {
      updateCustomHoliday(pubkey, editingId, {
        name: formName.trim(),
        month: formMonth,
        day: formDay,
        note: formNote.trim() || undefined,
        emoji: formEmoji.trim() || undefined,
        year: formRecurrence === "once" ? formYear : undefined,
        recurrence: formRecurrence,
        url: formUrl.trim() || undefined,
        weekday: formRecurrence === "weekly" ? new Date(formYear, formMonth, formDay).getDay() : undefined,
      });
      toast({ title: "Updated", description: `${formName.trim()} updated.` });
      resetForm();
      refresh();
    } catch {
      toast({ title: "Error", description: "Failed to update. Please try again.", variant: "destructive" });
    }
  };

  const handleEdit = (holiday: CustomHoliday) => {
    setEditingId(holiday.id);
    setFormName(holiday.name);
    setFormMonth(holiday.month);
    setFormDay(holiday.day);
    setFormNote(holiday.note || "");
    setFormEmoji(holiday.emoji || "");
    setFormRecurrence(holiday.recurrence || (holiday.year ? "once" : "yearly"));
    setFormUrl(holiday.url || "");
    setFormYear(holiday.year || year);
    setShowAddForm(true);
    setTab("custom");
  };

  const handleDelete = (id: string) => {
    try {
      deleteCustomHoliday(pubkey, id);
      if (editingId === id) resetForm();
      toast({ title: "Removed", description: "Special day removed from your calendar." });
      refresh();
    } catch {
      toast({ title: "Error", description: "Failed to remove. Please try again.", variant: "destructive" });
    }
  };

  const handleToggleBuiltIn = (id: string) => {
    try {
      toggleHiddenHoliday(pubkey, id);
      refresh();
    } catch {
      toast({ title: "Error", description: "Failed to update. Please try again.", variant: "destructive" });
    }
  };

  const handleCreateEvent = async () => {
    if (!signer || !eventTitle.trim() || !eventDate) return;
    setCreating(true);

    try {
      const dTag = editingDTag || `${eventTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
      const isTimeBased = !!eventStartTime;
      const kind = isTimeBased ? KIND_TIME_CALENDAR_EVENT : KIND_DATE_CALENDAR_EVENT;
      // End date defaults to the start date; a later end date makes it multi-day.
      const endDateStr = eventEndDate && eventEndDate >= eventDate ? eventEndDate : eventDate;

      const tags: string[][] = [
        ["d", dTag],
        ["title", eventTitle.trim()],
      ];

      if (isTimeBased) {
        // Tag the IANA timezone so the time is unambiguous for viewers in any
        // region (NIP-52 start_tzid/end_tzid). Without it a 3pm meeting renders
        // at the wrong hour for everyone outside the creator's timezone.
        const tzid = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const startUnix = Math.floor(new Date(`${eventDate}T${eventStartTime}`).getTime() / 1000);
        tags.push(["start", String(startUnix)]);
        if (tzid) tags.push(["start_tzid", tzid]);
        if (eventEndTime) {
          const endUnix = Math.floor(new Date(`${endDateStr}T${eventEndTime}`).getTime() / 1000);
          if (endUnix <= startUnix) {
            toast({ title: "Check your times", description: "The end time must be after the start time.", variant: "destructive" });
            setCreating(false);
            return;
          }
          tags.push(["end", String(endUnix)]);
          if (tzid) tags.push(["end_tzid", tzid]);
        }
      } else {
        tags.push(["start", eventDate]);
        tags.push(["end", endDateStr]);
      }

      if (eventLocation.trim()) {
        tags.push(["location", eventLocation.trim()]);
      }

      const meetingUrl = eventMeetingUrl.trim();
      if (meetingUrl) {
        if (!/^https?:\/\/.+/i.test(meetingUrl)) {
          toast({ title: "Check the link", description: "The meeting or stream link must start with http:// or https://", variant: "destructive" });
          setCreating(false);
          return;
        }
        tags.push(["r", meetingUrl]);
      }

      for (const participant of selectedParticipants) {
        tags.push(["p", participant]);
      }

      const hashtags = eventDescription.trim().match(/#(\w+)/g);
      if (hashtags) {
        for (const tag of hashtags) {
          tags.push(["t", tag.slice(1).toLowerCase()]);
        }
      }

      const eventTemplate = {
        kind,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: eventDescription.trim(),
      };

      const signed = await signWithTimeout(signer, eventTemplate as Parameters<ISigner["signEvent"]>[0]);

      if (!eventPrivate) {
        await publishEvent(signed);
      }

      const signedEvent: Event = signed as unknown as Event;
      const parsed = parseCalendarEvent(signedEvent);
      if (parsed) {
        if (eventPrivate) {
          savePrivateEvent(parsed);
        }
        pinEvent(pubkey, parsed.id, parsed);
      }

      let invitesSent = 0;
      let reminderCount = 0;

      if (selectedParticipants.length > 0) {
        const eventDateDisplay = new Date(eventDate).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const timeDisplay = eventStartTime ? ` at ${eventStartTime}${eventEndTime ? ` - ${eventEndTime}` : ""}` : "";
        const locationDisplay = eventLocation.trim() ? `\nLocation: ${eventLocation.trim()}` : "";
        const descDisplay = eventDescription.trim() ? `\n\n${eventDescription.trim()}` : "";

        const privacyNote = eventPrivate ? "\n\n🔒 This is a private event — visible only to invited participants." : "";

        const startUnixForPayload = eventStartTime
          ? Math.floor(new Date(`${eventDate}T${eventStartTime}`).getTime() / 1000)
          : undefined;
        const endUnixForPayload = eventEndTime
          ? Math.floor(new Date(`${endDateStr}T${eventEndTime}`).getTime() / 1000)
          : undefined;

        const eventPayload = JSON.stringify({
          type: "calendar-invite",
          title: eventTitle.trim(),
          date: eventDate,
          endDate: endDateStr !== eventDate ? endDateStr : undefined,
          startTime: eventStartTime || undefined,
          endTime: eventEndTime || undefined,
          startUnix: startUnixForPayload,
          endUnix: endUnixForPayload,
          location: eventLocation.trim() || undefined,
          meetingUrl: meetingUrl || undefined,
          description: eventDescription.trim() || undefined,
          kind,
          dTag,
          creatorPubkey: pubkey,
          private: eventPrivate,
        });

        const linkDisplay = meetingUrl ? `\n🔗 ${meetingUrl}` : "";
        const inviteMessage = `📅 You're invited to: ${eventTitle.trim()}\n\nDate: ${eventDateDisplay}${timeDisplay}${locationDisplay}${linkDisplay}${descDisplay}${privacyNote}\n\n---OUTPOST_EVENT---\n${eventPayload}`;

        for (const participant of selectedParticipants) {
          try {
            await fetchDMRelayList(participant).catch(() => {});
            const dmRelays = getDMRelaysForContact(participant, pubkey);
            // createGiftWrap returns { wrap, rumorId } — publish the WRAP
            // event itself (passing the whole result object crashed in
            // eventStore.add and no invite ever went out).
            const wrapped = await createGiftWrap(signer, pubkey, participant, inviteMessage);
            if (wrapped) {
              await publishWithFallback(dmRelays, wrapped.wrap);
              invitesSent++;
            }
          } catch (err) {
            console.warn(`Failed to send invite to ${participant.slice(0, 8)}:`, err);
          }
        }
      }

      if (selectedReminders.length > 0 && isTimeBased) {
        const eventStartMs = new Date(`${eventDate}T${eventStartTime}`).getTime();
        const reminderRecipients = [pubkey, ...selectedParticipants.filter((p) => p !== pubkey)];

        for (const reminderKey of selectedReminders) {
          const option = REMINDER_OPTIONS.find((o) => o.value === reminderKey);
          if (!option) continue;

          const reminderMs = eventStartMs - option.minutes * 60 * 1000;
          if (reminderMs <= Date.now()) continue;

          const reminderMessage = `⏰ Reminder: "${eventTitle.trim()}" starts in ${option.label.replace(" before", "")}!${eventLocation.trim() ? `\nLocation: ${eventLocation.trim()}` : ""}`;

          for (const recipient of reminderRecipients) {
            try {
              await fetchDMRelayList(recipient).catch(() => {});
              const dmRelays = getDMRelaysForContact(recipient, pubkey);
              const wrapped = await createGiftWrap(signer, pubkey, recipient, reminderMessage);
              if (wrapped) {
                await createScheduledPost(
                  wrapped.wrap,
                  dmRelays,
                  new Date(reminderMs),
                  pubkey,
                  `Reminder: ${eventTitle.trim().slice(0, 40)}`,
                );
                reminderCount++;
              }
            } catch (err) {
              console.warn(`Failed to schedule reminder for ${recipient.slice(0, 8)}:`, err);
            }
          }
        }
      }

      try {
        const eventDateDisplay = new Date(eventDate).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const timeLine = eventStartTime ? ` at ${eventStartTime}${eventEndTime ? ` - ${eventEndTime}` : ""}` : " (all day)";
        const locationLine = eventLocation.trim() ? `\n📍 ${eventLocation.trim()}` : "";
        const participantLine = invitesSent > 0 ? `\n👥 ${invitesSent} invite${invitesSent !== 1 ? "s" : ""} sent` : "";
        const reminderLine = reminderCount > 0
          ? `\n⏰ ${selectedReminders.map((r) => REMINDER_OPTIONS.find((o) => o.value === r)?.label.replace(" before", "")).filter(Boolean).join(", ")} before`
          : "";
        const privacyLine = eventPrivate ? "\n🔒 Private — not discoverable, shared via DM only" : "";

        const confirmationMessage = `✅ Event created: "${eventTitle.trim()}"\n📅 ${eventDateDisplay}${timeLine}${locationLine}${participantLine}${reminderLine}${privacyLine}`;

        await fetchDMRelayList(pubkey).catch(() => {});
        const dmRelays = getDMRelaysForContact(pubkey, pubkey);
        const wrapped = await createGiftWrap(signer, pubkey, pubkey, confirmationMessage);
        if (wrapped) {
          await publishWithFallback(dmRelays, wrapped.wrap);
        }
      } catch (err) {
        console.warn("Failed to send creator confirmation DM:", err);
      }

      let description = eventPrivate
        ? `"${eventTitle.trim()}" added to your calendar (private).`
        : `"${eventTitle.trim()}" published to your calendar.`;
      if (invitesSent > 0) description += ` ${invitesSent} invite(s) sent.`;
      if (reminderCount > 0) description += ` ${reminderCount} reminder(s) scheduled.`;

      toast({ title: editingDTag ? "Event Updated" : "Event Created", description });
      const wasEditing = !!editingDTag;
      resetEventForm();
      onChanged();
      refresh();
      if (wasEditing) onOpenChange(false);
    } catch (err) {
      console.error("Failed to create event:", err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to create event. Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const effectiveYear = formRecurrence === "once" ? formYear : year;
  const daysInMonth = new Date(effectiveYear, formMonth + 1, 0).getDate();

  useEffect(() => {
    if (formDay > daysInMonth) setFormDay(daysInMonth);
  }, [daysInMonth, formDay]);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { resetForm(); resetEventForm(); } }}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-brand uppercase tracking-wider">
            <CalendarPlus className="w-4 h-4 text-sky-400" />
            {editingDTag ? "Edit Event" : "Create Event"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 border-b border-border/30 pb-2">
          <button
            onClick={() => setTab("create")}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              tab === "create" ? "bg-sky-500/10 text-sky-400" : "text-muted-foreground/60 hover:text-foreground/80"
            }`}
          >
            Create Event
          </button>
          <button
            onClick={() => setTab("custom")}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              tab === "custom" ? "bg-amber-500/10 text-amber-800 dark:text-amber-400" : "text-muted-foreground/60 hover:text-foreground/80"
            }`}
          >
            My Reminders ({customHolidays.length})
          </button>
          <button
            onClick={() => setTab("builtin")}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              tab === "builtin" ? "bg-amber-500/10 text-amber-800 dark:text-amber-400" : "text-muted-foreground/60 hover:text-foreground/80"
            }`}
          >
            Holidays ({builtInHolidays.length - hiddenIds.length}/{builtInHolidays.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
          {tab === "create" && (
            <div className="space-y-3">
              {!signer ? (
                <div className="text-center py-8">
                  <CalendarPlus className="w-8 h-8 text-muted-foreground/15 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/40">Sign in to create events</p>
                </div>
              ) : (
                <div className="border border-sky-500/20 rounded-lg p-3 bg-sky-500/5 space-y-2.5">
                  <Input
                    placeholder="Event title"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                    className="h-8 text-sm"
                    autoFocus
                  />

                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sky-400/60 pointer-events-none" />
                      <input
                        type="date"
                        value={eventDate}
                        onChange={(e) => {
                          setEventDate(e.target.value);
                          if (eventEndDate && eventEndDate < e.target.value) setEventEndDate("");
                        }}
                        aria-label="Start date"
                        className="w-full h-9 text-sm rounded-md border border-input bg-background pl-8 pr-3 appearance-none [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500/50 transition-colors"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground/40 flex-shrink-0">to</span>
                    <div className="relative flex-1">
                      <CalendarDays className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/30 pointer-events-none" />
                      <input
                        type="date"
                        value={eventEndDate}
                        min={eventDate || undefined}
                        onChange={(e) => setEventEndDate(e.target.value)}
                        aria-label="End date (optional, for multi-day events)"
                        className="w-full h-9 text-sm rounded-md border border-input bg-background pl-8 pr-3 appearance-none [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500/50 transition-colors"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/40 -mt-1 pl-1">
                    Set an end date for multi-day events
                  </p>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sky-400/60 pointer-events-none" />
                        <input
                          type="time"
                          value={eventStartTime}
                          onChange={(e) => setEventStartTime(e.target.value)}
                          className="w-full h-9 text-sm rounded-md border border-input bg-background pl-8 pr-3 appearance-none [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500/50 transition-colors"
                        />
                      </div>
                      <span className="text-xs text-muted-foreground/40 flex-shrink-0">to</span>
                      <div className="relative flex-1">
                        <Clock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/30 pointer-events-none" />
                        <input
                          type="time"
                          value={eventEndTime}
                          onChange={(e) => setEventEndTime(e.target.value)}
                          className="w-full h-9 text-sm rounded-md border border-input bg-background pl-8 pr-3 appearance-none [color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500/50 transition-colors"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground/40 pl-1">
                      Leave times empty for an all-day event
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                    <Input
                      placeholder="Location (optional)"
                      value={eventLocation}
                      onChange={(e) => setEventLocation(e.target.value)}
                      className="flex-1 h-8 text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Video className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                      <Input
                        type="url"
                        inputMode="url"
                        placeholder="Meeting or stream link (optional)"
                        value={eventMeetingUrl}
                        onChange={(e) => setEventMeetingUrl(e.target.value)}
                        className="flex-1 h-8 text-xs"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground/30 pl-6">
                      Add a video call (Meet, Zoom, Jitsi…) or live stream (zap.stream, Twitch…) link
                    </p>
                  </div>

                  <Textarea
                    placeholder="Description (optional)"
                    value={eventDescription}
                    onChange={(e) => setEventDescription(e.target.value)}
                    className="min-h-[50px] text-xs resize-none"
                  />

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      {eventPrivate ? (
                        <Lock className="w-3.5 h-3.5 text-amber-800/70 dark:text-amber-400/70" />
                      ) : (
                        <Globe className="w-3.5 h-3.5 text-muted-foreground/40" />
                      )}
                      <span className="text-xs text-muted-foreground/60">Visibility</span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setEventPrivate(false)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-md border transition-colors ${
                          !eventPrivate
                            ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
                            : "border-border/30 text-muted-foreground/50 hover:text-foreground/70"
                        }`}
                      >
                        <Globe className="w-3 h-3" />
                        Public
                      </button>
                      <button
                        onClick={() => setEventPrivate(true)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] rounded-md border transition-colors ${
                          eventPrivate
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400"
                            : "border-border/30 text-muted-foreground/50 hover:text-foreground/70"
                        }`}
                      >
                        <Lock className="w-3 h-3" />
                        Private
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground/30">
                      {eventPrivate
                        ? "Only you and invited participants will see this event"
                        : "Discoverable by anyone searching for events"}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-muted-foreground/40" />
                      <span className="text-xs text-muted-foreground/60">Participants</span>
                      {selectedParticipants.length > 0 && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                          {selectedParticipants.length}
                        </Badge>
                      )}
                    </div>

                    {selectedParticipants.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedParticipants.map((pk) => (
                          <div
                            key={pk}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 text-[10px]"
                          >
                            {getProfilePicture(pk) && (
                              <img src={getProfilePicture(pk)} className="w-3 h-3 rounded-full" alt={`${getProfileDisplayName(pk)}'s avatar`} />
                            )}
                            <span className="max-w-[80px] truncate">{getProfileDisplayName(pk)}</span>
                            <button
                              onClick={() => setSelectedParticipants((prev) => prev.filter((p) => p !== pk))}
                              className="hover:text-red-700 dark:hover:text-red-400 transition-colors"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/40" />
                      <Input
                        placeholder="Search by name or npub..."
                        value={participantSearch}
                        onChange={(e) => handleParticipantSearch(e.target.value)}
                        className="h-7 text-[11px] pl-7"
                      />
                      {searchingParticipants && (
                        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-sky-400 animate-spin" />
                      )}
                    </div>

                    {participantResults.length > 0 && (
                      <div className="max-h-[120px] overflow-y-auto border border-border/20 rounded-md">
                        {participantResults.map((p) => (
                          <button
                            key={p.pubkey}
                            onClick={() => {
                              setSelectedParticipants((prev) => [...prev, p.pubkey]);
                              handleParticipantSearch("");
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-accent/30 transition-colors"
                          >
                            {p.picture ? (
                              <img src={p.picture} className="w-4 h-4 rounded-full flex-shrink-0" alt={`${p.name}'s avatar`} />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-sky-500/20 flex-shrink-0" />
                            )}
                            <span className="text-[11px] text-foreground/80 truncate flex-1">{p.name}</span>
                            {p.isFollow && (
                              <span className="text-[9px] text-sky-400/60 flex-shrink-0">following</span>
                            )}
                          </button>
                        ))}
                        <div className="px-2 py-1 text-[9px] text-muted-foreground/30 text-center">
                          {searchingParticipants ? "Searching..." : "Select a contact"}
                        </div>
                      </div>
                    )}
                    {participantSearch.trim() && participantResults.length === 0 && !searchingParticipants && (
                      <p className="text-[10px] text-muted-foreground/40 pl-1">No results found</p>
                    )}
                  </div>

                  {eventStartTime && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Bell className="w-3.5 h-3.5 text-muted-foreground/40" />
                        <span className="text-xs text-muted-foreground/60">Reminders</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {REMINDER_OPTIONS.map((opt) => {
                          const active = selectedReminders.includes(opt.value);
                          return (
                            <button
                              key={opt.value}
                              onClick={() => {
                                setSelectedReminders((prev) =>
                                  active ? prev.filter((r) => r !== opt.value) : [...prev, opt.value]
                                );
                              }}
                              className={`px-2 py-1 text-[10px] rounded-md border transition-colors ${
                                active
                                  ? "border-sky-500/40 bg-sky-500/10 text-sky-400"
                                  : "border-border/30 text-muted-foreground/50 hover:text-foreground/70"
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-muted-foreground/30">
                        {selectedParticipants.length > 0
                          ? "Sends a DM reminder to you and each participant"
                          : "Sends you a DM reminder before the event"}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-sky-600 hover:bg-sky-700"
                      onClick={handleCreateEvent}
                      disabled={!eventTitle.trim() || !eventDate || creating}
                    >
                      {creating ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3 mr-1" />
                      )}
                      {creating ? (editingDTag ? "Saving..." : "Creating...") : (editingDTag ? "Save Changes" : "Create Event")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "custom" && (
            <>
              {!showAddForm && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs border-dashed border-amber-500/30 text-amber-800 dark:text-amber-400 hover:bg-amber-500/10"
                  onClick={() => { resetForm(); setShowAddForm(true); }}
                >
                  <Plus className="w-3 h-3 mr-1.5" />
                  Add Date Reminder
                </Button>
              )}

              {showAddForm && (
                <div className="border border-amber-500/20 rounded-lg p-3 bg-amber-500/5 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Emoji"
                      value={formEmoji}
                      onChange={(e) => setFormEmoji(e.target.value)}
                      className="w-14 h-8 text-center text-sm"
                      maxLength={4}
                    />
                    <Input
                      placeholder="Name (e.g. Birthday, Anniversary)"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      className="flex-1 h-8 text-sm"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={formMonth}
                      onChange={(e) => {
                        setFormMonth(Number(e.target.value));
                        setFormDay(1);
                      }}
                      className="flex-1 h-8 text-xs rounded-md border border-input bg-background px-2"
                    >
                      {MONTH_NAMES.map((m, i) => (
                        <option key={i} value={i}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={formDay}
                      onChange={(e) => setFormDay(Number(e.target.value))}
                      className="w-16 h-8 text-xs rounded-md border border-input bg-background px-2"
                    >
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Repeat className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                    <select
                      value={formRecurrence}
                      onChange={(e) => setFormRecurrence(e.target.value as RecurrenceType)}
                      className="flex-1 h-8 text-xs rounded-md border border-input bg-background px-2"
                    >
                      <option value="once">One-time only</option>
                      <option value="weekly">Every week</option>
                      <option value="monthly">Every month</option>
                      <option value="yearly">Every year</option>
                    </select>
                    {formRecurrence === "once" && (
                      <select
                        value={formYear}
                        onChange={(e) => setFormYear(Number(e.target.value))}
                        className="w-20 h-8 text-xs rounded-md border border-input bg-background px-2"
                      >
                        {Array.from({ length: 11 }, (_, i) => year - 5 + i).map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Link className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                    <Input
                      placeholder="URL or meeting link (optional)"
                      value={formUrl}
                      onChange={(e) => setFormUrl(e.target.value)}
                      className="flex-1 h-8 text-xs"
                    />
                  </div>
                  <Textarea
                    placeholder="Add a note (optional)"
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    className="min-h-[60px] text-xs resize-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={resetForm}
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                      onClick={editingId ? handleUpdate : handleAdd}
                      disabled={!formName.trim()}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      {editingId ? "Update" : "Add"}
                    </Button>
                  </div>
                </div>
              )}

              {customHolidays.length === 0 && !showAddForm ? (
                <div className="text-center py-8">
                  <Star className="w-8 h-8 text-muted-foreground/15 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground/40">No date reminders yet</p>
                  <p className="text-[10px] text-muted-foreground/30 mt-1">
                    Add birthdays, anniversaries, or any date that matters to you.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {customHolidays.map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/30 group transition-colors"
                    >
                      <span className="text-base w-6 text-center flex-shrink-0">{h.emoji || "📌"}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground/80 truncate">{h.name}</p>
                        <p className="text-[10px] text-muted-foreground/50">
                          {MONTH_NAMES[h.month]} {h.day}
                          {" · "}
                          {(h.recurrence === "weekly") ? "Weekly" :
                           (h.recurrence === "monthly") ? "Monthly" :
                           (h.recurrence === "once" || h.year) ? `${h.year || year} only` : "Yearly"}
                          {h.note ? ` · ${h.note}` : ""}
                        </p>
                        {h.url && (
                          <a
                            href={h.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-amber-500 hover:text-amber-800 dark:hover:text-amber-400 flex items-center gap-0.5 mt-0.5 truncate"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Link className="w-2.5 h-2.5 flex-shrink-0" />
                            {h.url.replace(/^https?:\/\//, "").slice(0, 40)}
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 reveal-on-hover">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-amber-800 dark:hover:text-amber-400"
                          onClick={() => handleEdit(h)}
                          aria-label={`Edit ${h.name}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-red-700 dark:hover:text-red-400"
                          onClick={() => handleDelete(h.id)}
                          aria-label={`Delete ${h.name}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "builtin" && (
            <div className="space-y-1">
              <p className="text-[10px] text-muted-foreground/40 px-1 pb-1">
                Toggle holidays on or off. Hidden holidays won't appear on your calendar.
              </p>
              {builtInHolidays.map((h) => {
                const isHidden = hiddenIds.includes(h.id);
                return (
                  <button
                    key={h.id}
                    onClick={() => handleToggleBuiltIn(h.id)}
                    aria-label={isHidden ? `Show ${h.name}` : `Hide ${h.name}`}
                    className={`w-full flex items-center gap-2 p-2 rounded-md transition-colors text-left ${
                      isHidden ? "opacity-40 hover:opacity-60" : "hover:bg-accent/30"
                    }`}
                  >
                    <span className="text-base w-6 text-center flex-shrink-0">{h.emoji || "📅"}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${isHidden ? "text-muted-foreground/60 line-through" : "text-foreground/80"}`}>
                        {h.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground/50">
                        {MONTH_NAMES[h.month]} {h.day}
                      </p>
                    </div>
                    {isHidden ? (
                      <EyeOff className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
                    ) : (
                      <Eye className="w-3.5 h-3.5 text-amber-800/60 dark:text-amber-400/60 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
