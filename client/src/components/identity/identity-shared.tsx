/**
 * The identity layout's shared visual signature — extracted from
 * IdentityProfileLayout so the outpost (place) hero can wear the same skin as
 * the profile (person) without parameterizing person-specific concerns
 * (nip05, petnames, WoT chips stay in the callers). Class strings are copied
 * verbatim: this extraction is pixel-parity by construction.
 */
import type { ReactNode } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

/** A MySpace-bones section: a quiet title bar + a bordered body. */
export function IdentitySection({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  // Elevation, not decoration: a soft shadow floats cards off the page in light
  // mode; a slightly brighter hairline separates them from the black in dark. No
  // glows — the Apple/Google "pop" is depth, not neon.
  return (
    <section className={`rounded-xl border border-border/60 dark:border-white/[0.07] bg-card overflow-hidden shadow-sm shadow-black/[0.04] dark:shadow-none ${className ?? ""}`}>
      {title && (
        <div className="px-3 py-1.5 bg-muted/60 dark:bg-transparent dark:bg-gradient-to-r dark:from-primary/[0.10] dark:to-primary/[0.03] border-b border-border/50">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-brand/90">{title}</h2>
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

/**
 * The banner band: full-bleed cover, gradient scrim, one-shot fallback swap
 * (reassigning a fallback that also 404s would loop), optional top-right
 * control, and an optional `live` overlay (the profile's broadcast) that the
 * top-right control stays above.
 */
export function IdentityBanner({ src, fallbackSrc, blurBackdropSrc, topRight, live, className, variant = "card" }: {
  src?: string;
  /** `card`: a rounded band inside the page (desktop, outposts). `hero`: the
   *  phone's cover — edge to edge from the very top of the screen, tall enough
   *  to run under the transparent top bar (safe area included). */
  variant?: "card" | "hero";
  fallbackSrc?: string;
  /** Real-images-only fallback: when there is no banner, a blurred blow-up of
   *  the subject's own avatar fills the band — always THEIR imagery, never a
   *  stock illustration. Absent both, the brand gradient underlay carries it. */
  blurBackdropSrc?: string;
  topRight?: ReactNode;
  live?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br from-brand/25 via-primary/10 to-transparent ${
        variant === "hero"
          ? "h-[calc(13.5rem+env(safe-area-inset-top,0px))] rounded-none border-0"
          : "h-36 md:h-44 rounded-2xl border border-border/50"
      } ${className ?? ""}`}
      data-testid="identity-cover"
    >
      {!src && blurBackdropSrc && (
        <img
          src={blurBackdropSrc}
          alt=""
          aria-hidden
          className="w-full h-full object-cover scale-125 blur-2xl saturate-150 opacity-70"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      )}
      {src && (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            const img = e.currentTarget;
            if (fallbackSrc && img.src !== fallbackSrc) img.src = fallbackSrc;
            else img.style.display = "none";
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
      {/* The hero runs under the top bar: a soft dark scrim across its top
          keeps the bar's controls readable over a bright picture. */}
      {variant === "hero" && <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/45 via-black/15 to-transparent" aria-hidden="true" />}
      {live}
      {topRight && <div className="absolute top-2 right-2 z-20">{topRight}</div>}
    </div>
  );
}

/**
 * The identity card head: avatar lifted over the banner (the classic profile
 * idiom), title, and caption rows below. `lift` off when the cover's bottom
 * edge is in use (the profile's live overlay) and the avatar would cover it.
 */
export function IdentityHead({ avatarUrl, title, lift = true, inlineBadge, children }: {
  avatarUrl?: string;
  title: string;
  lift?: boolean;
  /** Drawn beside the name on its line (a verified glyph), not under it. */
  inlineBadge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`flex flex-col items-center text-center ${lift ? "-mt-14" : "pt-1"}`} data-testid="identity-head">
      <Avatar className="w-24 h-24 border-4 border-card shadow-lg">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={title} />}
        <AvatarFallback className="text-2xl bg-brand/10 text-brand font-semibold">{title.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <h1 className="mt-2 text-lg font-bold leading-tight break-words inline-flex items-center gap-1 max-w-full">
        <span className="min-w-0">{title}</span>
        {inlineBadge}
      </h1>
      {children}
    </div>
  );
}
