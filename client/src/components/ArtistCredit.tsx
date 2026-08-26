import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Music2 } from "lucide-react";
import { ZapDialog } from "@/components/ZapDialog";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import {
  resolveArtistLink,
  resolveArtistZapTarget,
  type ArtistCreditData,
} from "@/lib/artist-credit";

interface ArtistCreditProps {
  track: ArtistCreditData;
}

/**
 * A subtle, professional artist-credit + support treatment for the in-post
 * audio/music card. Credits the artist (linked to their Nostr profile, else
 * their Wavlake page) and offers a low-key "Support" control that opens the
 * app's existing zap confirmation targeting the artist. It never moves money
 * on its own — the user chooses the amount and confirms in the dialog.
 */
export function ArtistCredit({ track }: ArtistCreditProps) {
  const [showZap, setShowZap] = useState(false);

  const artistName = track.artist?.trim();
  const link = useMemo(() => resolveArtistLink(track), [track]);
  const zapTarget = useMemo(() => resolveArtistZapTarget(track), [track]);
  const showWavlakeSource = track.source === "wavlake";

  if (!artistName && !link && !zapTarget) return null;

  const displayName = artistName || "the artist";

  const nameNode = link ? (
    link.external ? (
      <a
        href={link.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-brand hover:text-brand-strong hover:underline transition-colors truncate"
        data-testid="artist-credit-link"
      >
        {displayName}
      </a>
    ) : (
      <Link
        href={link.href}
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-brand hover:text-brand-strong hover:underline transition-colors truncate cursor-pointer"
        data-testid="artist-credit-link"
      >
        {displayName}
      </Link>
    )
  ) : (
    <span className="font-medium text-foreground/80 truncate">{displayName}</span>
  );

  return (
    <>
      <div className="flex items-center gap-2 min-w-0" data-testid="artist-credit">
        <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground/80">
          {track.artistAvatarUrl ? (
            <img
              src={track.artistAvatarUrl}
              alt=""
              className="w-4 h-4 rounded-full object-cover shrink-0 bg-muted/40"
              loading="lazy"
            />
          ) : (
            <Music2 className="w-3 h-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          )}
          <span className="shrink-0">by</span>
          {nameNode}
          {showWavlakeSource && (
            <>
              <span className="text-muted-foreground/40 shrink-0" aria-hidden="true">
                ·
              </span>
              {track.wavlakeUrl ? (
                <a
                  href={track.wavlakeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-muted-foreground/70 hover:text-brand hover:underline transition-colors"
                  data-testid="artist-credit-source"
                >
                  on Wavlake
                </a>
              ) : (
                <span className="shrink-0 text-muted-foreground/60">on Wavlake</span>
              )}
            </>
          )}
        </div>

        {zapTarget && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowZap(true);
            }}
            className="ml-auto shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1.5 rounded-full text-[11px] font-medium text-amber-700 dark:text-amber-300/90 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 hover:border-amber-500/40 transition-colors cursor-pointer"
            title={`Support ${displayName}`}
            data-testid="button-support-artist"
          >
            <BtcZapIcon className="w-3.5 h-3.5" />
            <span>Support</span>
          </button>
        )}
      </div>

      {zapTarget && (
        <ZapDialog
          open={showZap}
          onOpenChange={setShowZap}
          pubkey={zapTarget.pubkey}
          recipientName={zapTarget.name}
        />
      )}
    </>
  );
}
