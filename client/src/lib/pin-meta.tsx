import type { PinnableTab, PinnedFeed } from "@/lib/pinned-feeds";
import { TimelineIcon } from "@/components/icons/TimelineIcon";
import { WavesIcon } from "@/components/icons/WavesIcon";
import { ChannelsIcon } from "@/components/icons/CommsIcon";
import { HorizonIcon } from "@/components/icons/HorizonIcon";

// Icon + label for each pinnable tab. Shared by the sidebar tree and the
// Outposts page so a pin renders identically in both places.
export const TAB_ICON: Record<PinnableTab, (p: { className?: string }) => JSX.Element> = {
  feed: TimelineIcon,
  topics: WavesIcon,
  channels: ChannelsIcon,
  horizon: HorizonIcon,
};

export const TAB_LABEL: Record<PinnableTab, string> = {
  feed: "Posts",
  topics: "Discussions",
  channels: "Chat",
  horizon: "Articles",
};

/**
 * The user-visible name for a pin row. Pins always render nested under their
 * parent relay (sidebar tree + Outposts card), so the relay name is redundant
 * here — we show just the view/channel name ("Waves", "Horizon", a channel's
 * own name). Channels already store a bare `channelLabel`; feeds historically
 * stored "RelayName · View", so we strip that legacy prefix at display time.
 */
export function pinDisplayLabel(pin: PinnedFeed): string {
  if (pin.channelLabel) return pin.channelLabel;
  const label = pin.label?.trim();
  if (label) {
    const legacy = label.match(/ · (Timeline|Posts|Waves|Discussions|Horizon|Articles|Channels|Chat)$/);
    if (legacy) return legacy[1];
    return label; // already bare, or a custom rename
  }
  return TAB_LABEL[pin.tab];
}
