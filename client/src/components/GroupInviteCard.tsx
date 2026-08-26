/**
 * Fixed-height "Group chat invite" card for invite links found in posts and
 * DMs — rendered INSTEAD of a generic link preview when a URL matches the
 * Concord invite shape (any client's host: armada.buzz, relayop.xyz, …).
 *
 * Height discipline: same shell as LinkPreviewCard (h-[100px], compact
 * h-[84px]) so swapping a link preview for this card causes ZERO layout shift
 * — that fixed-height contract is load-bearing for feed scroll stability. It
 * DOES fetch: the group name/icon/description live ENCRYPTED in the kind-33301
 * invite bundle at the link's naddr coordinate, so the card resolves + decrypts
 * the bundle (with the fragment token the recipient already holds) and swaps the
 * real group into the SAME fixed slots. The generic state IS the loading AND the
 * fallback state — on any fetch/decrypt failure it renders exactly as before, so
 * there is never a spinner, a broken image, or a layout shift.
 *
 * The host is shown as small muted text (honesty about where the link came
 * from), but "Join" goes to OUR internal /invite accept screen — never the
 * foreign origin — preserving the #fragment secret client-side. It never
 * auto-joins: the accept screen runs the existing explicit confirm/join flow.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Lock, Users } from "lucide-react";
import type { GroupInviteTarget } from "@/lib/concord/invite-detect";
import { persistentPoolSubscribe } from "@/lib/nostr";
import { KIND_INVITE_BUNDLE } from "@/lib/concord/concord-events";
import { resolveInviteBundle, bundleToDisplay, type InviteDisplay } from "@/lib/concord/invite-resolve";
import type { Event } from "nostr-tools";

export function GroupInviteCard({ invite, compact = false }: { invite: GroupInviteTarget; compact?: boolean }) {
  // Resolved group (name/icon/description). undefined = still generic (loading
  // or unresolvable) — the generic card below IS that state, no layout shift.
  const [display, setDisplay] = useState<InviteDisplay | undefined>(undefined);
  // Only reveal the real icon once it has actually decoded — a loading/broken
  // image must never flash in the fixed slot (the lock glyph stays behind it).
  const [iconOk, setIconOk] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Reset per-invite so a re-keyed card never shows the previous group's icon.
    setDisplay(undefined);
    setIconOk(false);
    setIconFailed(false);

    // Fetch the freshest 33301 bundle from the invite's bootstrap relays — same
    // subscribe-with-timeout shape the accept screen uses. Injected so the
    // resolver stays free of the I/O layer; cached by naddr so this runs once.
    const fetchEvent = (linkSigner: string, relays: string[]) =>
      new Promise<Event | null>((resolve) => {
        if (!relays.length) return resolve(null);
        let latest: Event | null = null;
        const sub = persistentPoolSubscribe(
          relays,
          { kinds: [KIND_INVITE_BUNDLE], authors: [linkSigner], "#d": [""] },
          { onevent: (e: Event) => { if (!latest || e.created_at > latest.created_at) latest = e; } },
        );
        setTimeout(() => { sub.close(); resolve(latest); }, 3500);
      });

    resolveInviteBundle(invite, fetchEvent)
      .then((bundle) => { if (!cancelled && bundle) setDisplay(bundleToDisplay(bundle)); })
      .catch(() => { /* stay generic — the fallback IS the failure state */ });

    return () => { cancelled = true; };
  }, [invite.naddr, invite.fragment]);

  const showIcon = !!display?.photo && !iconFailed;

  return (
    <Link
      href={invite.path}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      /* OPAQUE bg-card (not a translucent tint): this card renders inside DM
         message bubbles, which are a solid dark violet even in light mode — a
         see-through surface let the bubble bleed through and turned the
         light-mode foreground text dark-on-dark (unreadable). An opaque card
         guarantees contrast on ANY background, in both themes. Fixed height
         preserved (zero layout shift vs LinkPreviewCard). */
      className={`group/invite flex items-center gap-3 rounded-xl border border-border/60 bg-card p-2.5 overflow-hidden hover:border-primary/40 transition-colors cursor-pointer ${compact ? "h-[84px]" : "h-[100px]"}`}
      data-testid="media-group-invite"
    >
      {/* Same fixed square slot as the link card's thumbnail. Lock glyph is the
          base; the real group icon fades in over it only once decoded — so the
          slot never changes size and never flashes a broken image. */}
      <div className={`relative ${compact ? "w-16 h-16" : "w-20 h-20"} rounded-lg shrink-0 overflow-hidden bg-gradient-to-br from-brand/15 to-brand/10 ring-1 ring-primary/20 flex items-center justify-center`}>
        <Lock className={`${compact ? "w-5 h-5" : "w-6 h-6"} text-brand`} />
        {showIcon && (
          <img
            src={display!.photo}
            alt=""
            loading="lazy"
            onLoad={() => setIconOk(true)}
            onError={() => setIconFailed(true)}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${iconOk ? "opacity-100" : "opacity-0"}`}
            data-testid="img-invite-icon"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-brand uppercase tracking-wider">
          <Users className="w-3 h-3 shrink-0" />
          Group invite
        </div>
        <div className={`font-semibold text-foreground mt-0.5 ${compact ? "text-xs" : "text-sm"} line-clamp-1`} data-testid="text-invite-title">
          {display?.title ?? "Group chat invite"}
        </div>
        {/* Host honesty (where the link came from) as quiet muted text. */}
        <div className="text-[11px] text-muted-foreground truncate mt-0.5" data-testid="text-invite-subtitle">
          {display?.subtitle ?? invite.host ?? "Join this encrypted group in Relay Outpost"}
        </div>
      </div>

      <span
        className="shrink-0 inline-flex items-center rounded-full bg-primary text-primary-foreground text-xs font-semibold px-3.5 py-1.5 shadow-sm group-hover/invite:bg-primary/90 transition-colors"
        data-testid="button-invite-join"
      >
        Join
      </span>
    </Link>
  );
}
