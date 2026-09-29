import { useState } from "react";
import { Compass } from "lucide-react";
import { useLocation } from "wouter";
import { CompactNotice, NoticeAction } from "@/components/CompactNotice";
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
  const [, setLocation] = useLocation();

  if (!shouldShowIaMovedNotice({ pubkey, collapsed, stored: seen ? "1" : null })) return null;

  const dismissNotice = () => {
    markIaMovedNoticeSeen(pubkey);
    setSeen(true);
  };

  // One line (owner, 2026-09-29: the paragraph was too big): the map itself,
  // and the way back.
  return (
    <CompactNotice
      icon={Compass}
      body={<>Feed &amp; news → <b className="font-medium text-foreground/80">Discover</b> · Communities → <b className="font-medium text-foreground/80">Chats</b> · Calendar → <b className="font-medium text-foreground/80">You</b></>}
      actions={<NoticeAction onClick={() => setLocation("/settings?section=feed")} testId="ia-moved-notice-switch-back">Switch back</NoticeAction>}
      onDismiss={dismissNotice}
      className={className}
      testId="ia-moved-notice"
    />
  );
}
