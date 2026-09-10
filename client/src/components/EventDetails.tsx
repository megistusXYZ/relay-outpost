import { Clock, MapPin } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Linkify } from "@/components/Linkify";
import type { CalendarEventData } from "@/lib/calendar-events";

/**
 * Everything about a calendar event, readable in full — the card's excerpt
 * (two lines, cut at 180 characters) is only the teaser. Presentational: the
 * caller formats `when` and resolves the host, so this renders without a store.
 */
export function EventDetails({ ce, when, host }: {
  ce: CalendarEventData;
  when: string;
  host: { name: string; avatar?: string };
}) {
  const description = ce.description.trim();
  return (
    <div className="space-y-4" data-testid={`event-details-${ce.id.slice(0, 8)}`}>
      {ce.image && (
        <div className="-mx-5 -mt-5 bg-muted/40">
          <img src={ce.image} alt="" className="w-full aspect-[16/9] object-cover" loading="lazy" decoding="async" />
        </div>
      )}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold leading-snug tracking-tight">{ce.title}</h2>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Clock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{when}</span>
        </p>
        {ce.location && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground min-w-0">
            <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="min-w-0 break-words"><Linkify text={ce.location} /></span>
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Avatar className="w-5 h-5 border border-border/30">
            {host.avatar && <AvatarImage src={host.avatar} alt="" />}
            <AvatarFallback className="text-[8px] bg-muted">{host.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span>Hosted by <span className="font-medium text-foreground/85">{host.name}</span></span>
        </div>
      </div>
      {description && (
        <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap break-words" data-testid="event-details-description">
          <Linkify text={description} />
        </p>
      )}
      {ce.hashtags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ce.hashtags.map((tag) => (
            <span key={tag} className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">{`#${tag}`}</span>
          ))}
        </div>
      )}
    </div>
  );
}
