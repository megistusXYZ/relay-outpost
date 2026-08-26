import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

/**
 * Shared presentational layer for the Media hub's list-style surfaces (News,
 * Articles, Audio). Each of those feeds maps its own event/item shape into the
 * normalized `MediaItemModel` and renders it through `MediaRow` / `MediaHero`,
 * so they share ONE visual language and can't drift. The markup here mirrors the
 * News page (glass-card rows + rounded-2xl hero) which is the reference look.
 */

export interface MediaByline {
  name: string;
  /** Avatar (person) or favicon (source) URL. */
  avatar?: string;
  /** Render as a source — mono/uppercase text + square favicon — rather than a person. */
  mono?: boolean;
}

export interface MediaItemModel {
  id: string;
  title: string;
  summary?: string;
  /** Thumbnail (row) / hero image. */
  image?: string;
  byline?: MediaByline;
  timeAgo?: string;
  /** Inline meta chips rendered after the byline row (read time, duration, categories). */
  meta?: ReactNode;
  /** When true the item reads as "already seen": no unread dot, dimmed. */
  read?: boolean;
  /** Whole-card click (navigate / open). Actions inside stop propagation. */
  onClick?: () => void;
  /** Trailing action controls (bookmark / share / play / more). */
  actions?: ReactNode;
}

function BylineRow({ item }: { item: MediaItemModel }) {
  const b = item.byline;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {b && (b.mono ? (
        <>
          {b.avatar && <img src={b.avatar} alt="" className="w-4 h-4 rounded-sm object-cover shrink-0" loading="lazy" />}
          <span className="text-[11px] text-muted-foreground font-mono uppercase tracking-wider truncate max-w-[140px]">{b.name}</span>
        </>
      ) : (
        <>
          <Avatar className="w-4 h-4 border border-border/50 shrink-0">
            <AvatarImage src={b.avatar} alt="" />
            <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">{b.name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">{b.name}</span>
        </>
      ))}
      {item.timeAgo && (
        <>
          {b && <span className="text-muted-foreground/40 text-[11px]">·</span>}
          <span className="text-[11px] text-muted-foreground/80 font-mono">{item.timeAgo}</span>
        </>
      )}
    </div>
  );
}

/** Flush glass-card list row: thumbnail · title (unread dot) · summary · byline · meta · actions. */
export function MediaRow({ item, placeholder }: { item: MediaItemModel; placeholder?: ReactNode }) {
  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("a") || target.closest("button")) return;
    item.onClick?.();
  };
  return (
    <Card
      className={`group glass-card hover-elevate cursor-pointer overflow-hidden transition-opacity p-3 sm:p-4 ${item.read ? "opacity-60" : ""}`}
      onClick={handleClick}
      data-read={item.read ? "true" : "false"}
      data-testid={`media-row-${item.id}`}
    >
      <div className="flex gap-3">
        {(item.image || placeholder) && (
          <div className="rounded-md overflow-hidden shrink-0 bg-muted/30 w-20 h-16 sm:w-24 sm:h-18 flex items-center justify-center">
            {item.image ? (
              <img
                src={item.image}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : placeholder}
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-1.5">
          <h3 className={`text-sm leading-snug flex items-start gap-1.5 line-clamp-2 ${item.read ? "font-medium text-muted-foreground" : "font-bold text-foreground"}`}>
            {!item.read && <span className="mt-1 w-[7px] h-[7px] rounded-full bg-primary shrink-0" aria-label="Unread" />}
            <span className="min-w-0">{item.title || "Untitled"}</span>
          </h3>
          {item.summary && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{item.summary}</p>
          )}
          <BylineRow item={item} />
          {item.meta && <div className="flex items-center gap-1 flex-wrap">{item.meta}</div>}
        </div>
        {item.actions && (
          <div className="flex items-center gap-0.5 shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
            {item.actions}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Full-bleed top-story hero: 16:9 image + gradient + badge, title/byline/actions below. */
export function MediaHero({ item, badge, placeholder }: { item: MediaItemModel; badge?: ReactNode; placeholder?: ReactNode }) {
  const b = item.byline;
  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-border/40 bg-card/40 hover:border-primary/40 transition-colors cursor-pointer"
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a") || target.closest("button")) return;
        item.onClick?.();
      }}
      data-testid={`media-hero-${item.id}`}
    >
      {(item.image || placeholder) && (
        <div className={`relative w-full aspect-[16/9] overflow-hidden ${item.image ? "bg-muted/30" : "bg-gradient-to-br from-brand/10 to-brand/5 flex items-center justify-center"}`}>
          {item.image ? (
            <>
              <img
                src={item.image}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent pointer-events-none" />
            </>
          ) : placeholder}
          {badge && (
            <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-primary/90 text-primary-foreground text-[10px] font-brand uppercase tracking-widest px-2.5 py-1 shadow-sm">
              {badge}
            </span>
          )}
        </div>
      )}
      <div className="p-4 sm:p-5">
        {(b || item.timeAgo) && (
          <div className="flex items-center gap-2 mb-2 text-[11px] text-muted-foreground/80 min-w-0">
            {b?.avatar && (b.mono ? (
              <img src={b.avatar} alt="" className="w-4 h-4 rounded-sm object-cover shrink-0" loading="lazy" />
            ) : (
              <Avatar className="w-4 h-4 shrink-0">
                <AvatarImage src={b.avatar} alt="" />
                <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">{b.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            ))}
            {b && <span className={`truncate ${b.mono ? "font-mono uppercase tracking-wider" : ""}`}>{b.name}</span>}
            {item.timeAgo && <span className="shrink-0">· {item.timeAgo}</span>}
          </div>
        )}
        <h2 className="text-lg sm:text-xl font-semibold leading-snug text-foreground line-clamp-3" data-testid={`media-hero-title-${item.id}`}>
          {item.title || "Untitled"}
        </h2>
        {item.summary && <p className="mt-2 text-sm text-muted-foreground/85 line-clamp-2">{item.summary}</p>}
        {item.actions && <div className="mt-3 flex items-center gap-1">{item.actions}</div>}
      </div>
    </article>
  );
}
