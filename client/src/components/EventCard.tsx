import { useEffect, useMemo } from "react";
import { use$ } from "applesauce-react/hooks";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getProfileContent } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Linkify } from "@/components/Linkify";
import { CalendarDays, Clock, MapPin, Radio, Video, ExternalLink } from "lucide-react";
import {
  getCalendarEventDate,
  getCalendarEventEndDate,
  getMeetingLink,
  safeString,
  type CalendarEventData,
} from "@/lib/calendar-events";
import { EventActionBar } from "@/components/EventActionBar";

// One event card for every surface: the Search → Events list, the calendar's
// pinned-events sections, and events embedded in feed posts (shared via
// nostr:naddr). Two variants:
//   - "list": full-width row card with description, host, hashtags, meeting
//     link, and an `actions` slot (pin/share/unpin/edit/delete supplied by the
//     caller).
//   - "embed": compact fixed-structure card for inside posts. Layout is
//     reserved (fixed thumbnail box, single-line rows) so resolving the host
//     profile or loading the image never shifts the feed.

export function formatEventWhen(ce: CalendarEventData): string {
  const start = getCalendarEventDate(ce);
  if (!start) return "No date";
  const end = getCalendarEventEndDate(ce);
  const dateStr = start.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  if (ce.startTime) {
    const timeStr = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (end && ce.endTime) {
      const endTimeStr = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `${dateStr} · ${timeStr} – ${endTimeStr}`;
    }
    return `${dateStr} · ${timeStr}`;
  }
  if (end && ce.endDate && ce.endDate !== ce.startDate) {
    const endDateStr = end.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${dateStr} – ${endDateStr}`;
  }
  return dateStr;
}

function useEventHost(pubkey: string): { name: string; avatar?: string } {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => {
    if (!profile) fetchProfilesCached([pubkey]);
  }, [profile, pubkey]);
  return useMemo(() => {
    if (profile) {
      const c = getProfileContent(profile);
      // Coerce defensively: a malformed profile can carry an object where a
      // name/picture string is expected, which would crash the text node.
      return {
        name: safeString(c?.display_name) || safeString(c?.name) || pubkey.slice(0, 8) + "...",
        avatar: safeString(c?.picture),
      };
    }
    return { name: pubkey.slice(0, 8) + "...", avatar: undefined };
  }, [profile, pubkey]);
}

// Fixed-size thumbnail box. The box itself always renders when an image tag is
// present — a broken URL hides the <img> but keeps the box, so the card never
// reflows after mount (reserved-box pattern from the feed scroll-stability work).
function EventThumb({ src, sizeClass }: { src: string; sizeClass: string }) {
  return (
    <div className={`${sizeClass} rounded-lg overflow-hidden bg-muted/40 dark:bg-white/[0.04] shrink-0`}>
      <img
        src={src}
        alt=""
        className="w-full h-full object-cover"
        loading="lazy"
        decoding="async"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    </div>
  );
}

export function MeetingLinkChip({ ce, suppressIfInText }: { ce: CalendarEventData; suppressIfInText?: string }) {
  const meeting = getMeetingLink(ce);
  if (!meeting) return null;
  // A plain link that's already visible inline in the shown description is
  // redundant — suppress it. Match protocol-insensitively (content often writes
  // a bare "domain/path" while the r-tag carries "https://…"). Structured
  // video/stream links keep their distinct "Join"/"Watch" CTA regardless.
  if (meeting.kind === "link" && suppressIfInText) {
    const bare = meeting.url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (suppressIfInText.includes(meeting.url) || (bare && suppressIfInText.includes(bare))) return null;
  }
  const MIcon = meeting.kind === "stream" ? Radio : meeting.kind === "video" ? Video : ExternalLink;
  return (
    <a
      href={meeting.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
        meeting.kind === "stream"
          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 hover:bg-rose-500/25"
          : "bg-sky-500/15 text-sky-600 dark:text-sky-400 hover:bg-sky-500/25"
      }`}
      data-testid="event-meeting-link"
    >
      <MIcon className="w-3 h-3" />
      {meeting.label}
    </a>
  );
}

export interface EventCardProps {
  ce: CalendarEventData;
  variant?: "list" | "embed";
  /** Dim the card (past events). */
  dimmed?: boolean;
  /** Right-side owner/action cluster (edit/delete/unpin) for the calendar
   *  DayDetail. Browsing surfaces (Search events, feed embed) leave this unset
   *  and rely on the single bottom action row instead. */
  actions?: React.ReactNode;
  /** Tap handler for the embed variant (opens the event surface). */
  onOpen?: () => void;
  /** Share-to-feed handler. When set, a compact Share icon appears in the
   *  bottom action row. When unset, the icon is hidden. */
  onShare?: (ce: CalendarEventData) => void;
  className?: string;
}

export function EventCard({ ce, variant = "list", dimmed = false, actions, onOpen, onShare, className = "" }: EventCardProps) {
  const host = useEventHost(ce.pubkey);

  if (variant === "embed") {
    return (
      <div
        className={`mt-2 rounded-lg border border-border/30 bg-background/20 overflow-hidden hover-elevate transition-colors ${onOpen ? "cursor-pointer" : ""} ${className}`}
        onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
        data-testid={`event-embed-card-${ce.id.slice(0, 8)}`}
      >
        <div className="p-3">
          {/* Fixed-height header row: label left, host right. The host name is a
              single truncated line, so profile resolution can't change height. */}
          <div className="flex items-center gap-1.5 mb-2 h-4">
            <CalendarDays className="w-3.5 h-3.5 text-brand/70 shrink-0" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">Event</span>
            <span className="ml-auto flex items-center gap-1.5 min-w-0">
              <Avatar className="w-4 h-4 shrink-0">
                {host.avatar && <AvatarImage src={host.avatar} alt={host.name} />}
                <AvatarFallback className="text-[7px] bg-muted">{host.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-[11px] font-medium text-muted-foreground/80 truncate max-w-[140px]">{host.name}</span>
            </span>
          </div>
          <div className="flex items-start gap-3">
            {ce.image && <EventThumb src={ce.image} sizeClass="w-16 h-16" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-snug line-clamp-2">{ce.title}</p>
              <p className="mt-1 text-xs text-muted-foreground/80 flex items-center gap-1.5">
                <Clock className="w-3 h-3 shrink-0" />
                <span className="truncate">{formatEventWhen(ce)}</span>
              </p>
              {ce.location && (
                <p className="mt-0.5 text-xs text-muted-foreground/70 flex items-center gap-1.5 min-w-0">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{ce.location}</span>
                </p>
              )}
            </div>
          </div>
          <EventActionBar ce={ce} variant="embed" onShare={onShare ? () => onShare(ce) : undefined} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group glass-card rounded-xl border p-3 sm:p-3.5 transition-colors ${dimmed ? "opacity-50" : ""} ${className}`}
      data-testid={`card-event-${ce.id.slice(0, 8)}`}
    >
      <div className="flex items-start gap-3">
        {ce.image && <EventThumb src={ce.image} sizeClass="w-16 h-16 sm:w-20 sm:h-20" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/90 mb-1 leading-snug line-clamp-2">{ce.title}</p>
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-1 sm:gap-2 text-[11px] text-muted-foreground/60 mb-1.5">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3 shrink-0" />
              {formatEventWhen(ce)}
            </span>
            {ce.location && (
              <span className="flex items-center gap-1 min-w-0">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate"><Linkify text={ce.location} /></span>
              </span>
            )}
          </div>
          {ce.description && (
            <p className="text-xs text-foreground/60 line-clamp-2 mb-2 leading-relaxed">
              <Linkify text={ce.description.slice(0, 180)} />
            </p>
          )}
          <MeetingLinkChip ce={ce} suppressIfInText={ce.description ? ce.description.slice(0, 180) : ""} />
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <Avatar className="w-4 h-4 border border-border/30">
                {host.avatar && <AvatarImage src={host.avatar} alt={host.name} />}
                <AvatarFallback className="text-[6px] bg-muted">{host.name.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="truncate max-w-[140px]">{host.name}</span>
            </span>
          </div>
        </div>
        {actions && <div className="flex flex-col items-center gap-0.5 shrink-0">{actions}</div>}
      </div>
      <EventActionBar ce={ce} variant="list" onShare={onShare ? () => onShare(ce) : undefined} />
    </div>
  );
}

// Same footprint as the corresponding EventCard variant so swapping skeleton →
// card doesn't reflow the page.
export function EventCardSkeleton({ variant = "list" }: { variant?: "list" | "embed" }) {
  if (variant === "embed") {
    return (
      <div className="mt-2 rounded-lg border border-border/30 bg-background/20 p-3" data-testid="event-embed-skeleton">
        <div className="animate-pulse">
          <div className="flex items-center gap-1.5 mb-2 h-4">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/40">Event</span>
            <div className="ml-auto h-3 w-20 rounded bg-muted/40" />
          </div>
          <div className="flex items-start gap-3">
            <div className="w-16 h-16 rounded-lg bg-muted/40 shrink-0" />
            <div className="flex-1 min-w-0 space-y-2 py-0.5">
              <div className="h-4 w-3/4 rounded bg-muted/40" />
              <div className="h-3 w-1/2 rounded bg-muted/30" />
              <div className="h-3 w-2/3 rounded bg-muted/30" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="glass-card rounded-xl border p-3 sm:p-3.5" data-testid="event-card-skeleton">
      <div className="flex items-start gap-3 animate-pulse">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-muted/40 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2 py-0.5">
          <div className="h-4 w-2/3 rounded bg-muted/40" />
          <div className="h-3 w-1/2 rounded bg-muted/30" />
          <div className="h-3 w-3/4 rounded bg-muted/30" />
          <div className="h-3 w-1/3 rounded bg-muted/30" />
        </div>
      </div>
    </div>
  );
}
