import { useState } from "react";
import { Compass, X } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useIaCollapsed } from "@/lib/ia-prefs";
import {
  hasSeenIaMovedNotice,
  markIaMovedNoticeSeen,
  shouldShowIaMovedNotice,
} from "@/lib/ia-moved-notice";

/**
 * "Where did everything go?" — shown once, to people whose navigation collapsed
 * underneath them.
 *
 * The copy is a MAP, not an announcement. Someone reading this is looking for a
 * specific thing they can no longer see, so every line names a place they used
 * and where it is now. "We've simplified navigation!" would be true and useless.
 *
 * It names Communities and Calendar explicitly because those are the two that
 * moved somewhere non-obvious (into Chats, and into You). Feed and News merging
 * into Discover is the headline. Media isn't mentioned: it never was its own
 * page — it has always been a tab of search — so nothing about it changed.
 *
 * Self-hiding, so it can be mounted unconditionally: nothing renders unless
 * someone is signed in, their nav has actually collapsed, and they haven't
 * dismissed it. New accounts are marked seen at creation and never see it.
 */
export function IaMovedNotice({ className = "" }: { className?: string }) {
  const { pubkey } = useNostrAuth();
  const collapsed = useIaCollapsed();
  // Read once per mount: the value only changes via the dismiss below, and
  // re-reading storage on every render would gain nothing.
  const [seen, setSeen] = useState(() => hasSeenIaMovedNotice(pubkey));

  if (!shouldShowIaMovedNotice({ pubkey, collapsed, stored: seen ? "1" : null })) return null;

  const dismissNotice = () => {
    markIaMovedNoticeSeen(pubkey);
    setSeen(true);
  };

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-brand/20 bg-gradient-to-br from-brand/[0.06] to-brand/[0.03] px-4 py-3 ${className}`}
      data-testid="ia-moved-notice"
    >
      <Compass className="mt-0.5 h-4 w-4 shrink-0 text-brand/80" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground/85">Fewer places to look</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground/70">
          Your feed and news are both in <span className="text-foreground/75">Discover</span> now.
          Your communities moved into <span className="text-foreground/75">Chats</span>, and your
          calendar is under <span className="text-foreground/75">You</span>. Nothing was removed —
          you can switch back any time in Settings.
        </p>
      </div>
      <button
        type="button"
        onClick={dismissNotice}
        className="-mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Dismiss"
        data-testid="ia-moved-notice-dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
