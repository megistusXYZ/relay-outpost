// Shared per-item row renderers for the Calendar page: one card component per
// calendar item type, used by BOTH the agenda list (the page hero) and the
// DayDetail panel (off-window day view from the month sheet). Extracted from
// DayDetail so the two surfaces can't drift.
import { use$ } from "applesauce-react/hooks";
import { Link } from "wouter";
import { eventStore } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, getAvatarUrl, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, BarChart3, MapPin, Clock, ExternalLink, Image, Music, Link2, Film, Send, Radio } from "lucide-react";
import { nip19 } from "nostr-tools";
import type { CalendarItemPublished, CalendarItemSubscribed, CalendarItemCreatorStream } from "@/lib/calendar-events";
import type { Holiday } from "@/lib/calendar-holidays";
import { getKindLabel } from "@/lib/schedule";
import { Linkify, URL_REGEX } from "@/components/Linkify";

const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?.*)?$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a|aac|opus)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i;
const NOSTR_REF = /nostr:[a-z0-9]+/g;

export function getContentPreview(content: string): { text: string; hasImages: boolean; hasAudio: boolean; hasVideo: boolean; hasLinks: boolean } {
  const urls = content.match(URL_REGEX) || [];
  let hasImages = false;
  let hasAudio = false;
  let hasVideo = false;
  let hasLinks = false;

  for (const url of urls) {
    if (IMAGE_EXT.test(url) || url.includes("klipy.com") || url.includes("giphy.com") || url.includes("tenor.com")) hasImages = true;
    else if (AUDIO_EXT.test(url) || url.includes("audio.nostr.build") || url.includes("wavlake.com")) hasAudio = true;
    else if (VIDEO_EXT.test(url)) hasVideo = true;
    else hasLinks = true;
  }

  const cleaned = content
    .replace(URL_REGEX, "")
    .replace(NOSTR_REF, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  return { text: cleaned, hasImages, hasAudio, hasVideo, hasLinks };
}

export function getPublishedPostUrl(item: CalendarItemPublished): string {
  if (item.kind === 30023) {
    const dTag = item.event.tags.find((t) => t[0] === "d")?.[1] || "";
    const naddr = nip19.naddrEncode({
      identifier: dTag,
      pubkey: item.pubkey,
      kind: 30023,
    });
    return `/articles/${naddr}`;
  }
  return `/thread/${nip19.noteEncode(item.event.id)}`;
}

export function PublishedPostCard({ item }: { item: CalendarItemPublished }) {
  const preview = getContentPreview(item.content);
  return (
    <Link
      href={getPublishedPostUrl(item)}
      className="block glass-card border rounded-lg p-3 transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {item.kind === 1068 ? (
            <BarChart3 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          ) : (
            <FileText className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-[9px] uppercase tracking-wider text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600">
              {getKindLabel(item.kind)}
            </Badge>
          </div>
          {preview.text ? (
            <p className="text-sm text-gray-800 dark:text-gray-200 line-clamp-2 leading-relaxed">
              {preview.text}
            </p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              Media post
            </p>
          )}
          {(preview.hasImages || preview.hasAudio || preview.hasVideo || preview.hasLinks) && (
            <div className="flex items-center gap-2 mt-1.5">
              {preview.hasImages && (
                <span className="inline-flex items-center gap-1 text-[9px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] rounded px-1.5 py-0.5">
                  <Image className="w-3 h-3" /> Image
                </span>
              )}
              {preview.hasAudio && (
                <span className="inline-flex items-center gap-1 text-[9px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] rounded px-1.5 py-0.5">
                  <Music className="w-3 h-3" /> Audio
                </span>
              )}
              {preview.hasVideo && (
                <span className="inline-flex items-center gap-1 text-[9px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] rounded px-1.5 py-0.5">
                  <Film className="w-3 h-3" /> Video
                </span>
              )}
              {preview.hasLinks && !preview.hasImages && !preview.hasAudio && !preview.hasVideo && (
                <span className="inline-flex items-center gap-1 text-[9px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] rounded px-1.5 py-0.5">
                  <Link2 className="w-3 h-3" /> Link
                </span>
              )}
            </div>
          )}
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {item.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="text-[10px] text-brand group-hover:text-brand-strong flex items-center gap-1 transition-colors">
              View <ExternalLink className="w-3 h-3" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function CreatorStreamCard({ item }: { item: CalendarItemCreatorStream }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, item.creatorPubkey), [item.creatorPubkey]);
  const displayName = profile ? getDisplayName(profile) : shortenNpub(formatNpub(item.creatorPubkey));
  const avatarUrl = profile ? getAvatarUrl(profile) : undefined;

  let streamHref = "/live";
  try {
    const naddr = nip19.naddrEncode({
      kind: 30311,
      pubkey: item.creatorPubkey,
      identifier: item.dTag,
    });
    streamHref = `/live/${naddr}`;
  } catch {}

  return (
    <Link
      href={streamHref}
      className="block glass-card border rounded-lg p-3 transition-all group"
    >
      <div className="flex items-start gap-3">
        <Radio className="w-4 h-4 text-brand flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-[9px] uppercase tracking-wider bg-brand dark:bg-brand/10 text-brand border-brand dark:border-brand/20">
              {item.status === "live" ? "Live Stream" : "Planned Stream"}
            </Badge>
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">{item.title}</p>
          {item.summary && (
            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-1.5">{item.summary.slice(0, 200)}</p>
          )}
          <div className="flex items-center gap-2 mb-1.5">
            <Avatar className="w-5 h-5 border border-brand/30 dark:border-brand/20">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback className="text-[8px] bg-brand/60 dark:bg-brand/50 text-brand">{displayName?.charAt(0)?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="text-xs text-gray-600 dark:text-gray-400">{displayName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
            {item.starts && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(item.starts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                {item.ends && ` – ${new Date(item.ends * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
              </span>
            )}
          </div>
          {item.hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {item.hashtags.slice(0, 5).map((tag) => (
                <Badge key={tag} variant="outline" className="text-[8px] px-1.5 py-0 text-brand border-brand">
                  #{tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export function FeedEventCard({ item }: { item: CalendarItemSubscribed }) {
  // Date-only ICS entries surface as midnight-to-midnight (DTEND is often the
  // exclusive next-day midnight) — render "All day" instead of the meaningless
  // "12:00 AM – 12:00 AM".
  const atMidnight = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0;
  const isAllDay = atMidnight(item.date) && (!item.dtend || atMidnight(item.dtend));
  return (
    <div className="glass-card border rounded-lg p-3">
      <div className="flex items-start gap-3">
        <span className="text-base flex-shrink-0 mt-0.5">{item.feedEmoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-[9px] uppercase tracking-wider bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20">
              {item.feedName}
            </Badge>
          </div>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">{item.summary}</p>
          {item.description && (
            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 mb-1.5"><Linkify text={item.description.slice(0, 200)} /></p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {isAllDay ? (
                "All day"
              ) : (
                <>
                  {item.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  {item.dtend && item.dtend.getTime() !== item.date.getTime() && ` – ${item.dtend.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                </>
              )}
            </span>
            {item.location && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                <Linkify text={item.location} />
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HolidayRow({ holiday, onShare }: { holiday: Holiday; onShare?: (h: Holiday) => void }) {
  return (
    <div className="flex items-start gap-2.5 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
      <span className="text-base flex-shrink-0 mt-0.5">{holiday.emoji || (holiday.isBuiltIn ? "📅" : "📌")}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{holiday.name}</p>
        {holiday.note && (
          <p className="text-xs text-amber-600/70 dark:text-amber-400/60 mt-0.5 line-clamp-2">{holiday.note}</p>
        )}
        {holiday.url && (
          <a
            href={holiday.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 flex items-center gap-1 mt-1 truncate"
          >
            <Link2 className="w-2.5 h-2.5 flex-shrink-0" />
            {holiday.url.replace(/^https?:\/\//, "").slice(0, 50)}
          </a>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <Badge variant="outline" className="text-[8px] uppercase tracking-wider bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-500/30">
          {holiday.isBuiltIn ? "Holiday" : "Reminder"}
        </Badge>
        {!holiday.isBuiltIn && holiday.recurrence && holiday.recurrence !== "once" && (
          <span className="text-[8px] text-amber-500/60 dark:text-amber-400/50 uppercase tracking-wider">
            {holiday.recurrence}
          </span>
        )}
        {!holiday.isBuiltIn && onShare && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-amber-500/50 hover:text-amber-800 dark:hover:text-amber-400"
            onClick={() => onShare(holiday)}
            title="Share via DM"
          >
            <Send className="w-2.5 h-2.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
