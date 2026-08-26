import { useState } from "react";
import { MoreHorizontal, Users, Settings, Link2, LogOut, Trash2, Bell, BellOff, Pencil, ShieldCheck } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setChannelMuted, setCommunityMuted, useCommunityMuted, useMutedChannels } from "@/lib/concord/concord-mute";
import { PetnameDialog } from "@/components/PetnameDialog";
import type { PetnameKind } from "@/lib/petnames";

/**
 * The ⋯ menu for a space — "me in this space".
 *
 * Moved verbatim out of ConcordChat, where it was module-private, so the NIP-29
 * room header can use the SAME menu rather than growing a twin. Two copies of a
 * menu is how one of them quietly acquires an item the other lacks; this repo
 * has paid for that several times over.
 *
 * The organizing rule this menu now has to hold up: **⋯ is "me in this space",
 * the Manage drawer is "this space"**. Everything here is something an ordinary
 * member does — see who's here, invite someone, mute, leave. Authority lives
 * behind Manage. `onManage` is the single exception, and it is the door, not the
 * authority itself: the host only passes it when the viewer actually holds
 * something.
 *
 * Three details are load-bearing and must not be "tidied":
 *  - `defer` — dialog-opening items run on a setTimeout(0) past the menu's own
 *    close, or the dropdown's dismiss sequence swallows the dialog that just
 *    opened. Same pattern as MediaInteractionBar / TrustReviewsPanel.
 *  - `min-h-[44px] md:min-h-0` — the touch-target floor on phones, dropped on
 *    pointer devices where it would look padded.
 *  - the early `return null` — with nothing to offer, the trigger does not
 *    render at all. Items are absent, never disabled. This is hasAnyCapability()
 *    expressed in markup, and it predates the drawer.
 */
export function SpaceOverflowMenu({
  triggerClassName,
  triggerIconClassName,
  triggerTestId,
  onManage,
  onSettings,
  onMembers,
  onInvite,
  onLeave,
  petnameSubject,
  isOwner,
  muteContext,
  attention,
}: {
  triggerClassName: string;
  triggerIconClassName: string;
  triggerTestId: string;
  /** Opens the admin drawer. Passed ONLY when the viewer holds some capability. */
  onManage?: () => void;
  onSettings?: () => void;
  onMembers?: () => void;
  onInvite?: () => void;
  onLeave?: () => void;
  /**
   * Petname subject: renders "Rename for you" and self-hosts the dialog, so
   * every host gets the feature with one prop instead of three wirings.
   * "Me in this space" is exactly what a private nickname is.
   */
  petnameSubject?: { kind: PetnameKind; id: string; realName: string };
  isOwner: boolean;
  /** Mute targets: the community, plus the active channel in multi-channel groups. */
  muteContext?: { communityId: string; channelId?: string; channelName?: string };
  /**
   * Count of things waiting on the viewer (NIP-29 join requests). Rendered as a
   * dot ON THE TRIGGER, because a count that only exists inside a closed
   * dropdown is a count nobody sees. Undefined on Concord — an honest difference
   * (there is no admission queue), not a missing feature.
   */
  attention?: number;
}) {
  // Hooks must run unconditionally — the early return comes after.
  const communityMuted = useCommunityMuted(muteContext?.communityId ?? "");
  const mutedChannels = useMutedChannels(muteContext?.communityId ?? "");
  const [petnameOpen, setPetnameOpen] = useState(false);
  if (!onManage && !onSettings && !onMembers && !onInvite && !onLeave && !muteContext && !petnameSubject) return null;
  const channelMuted = !!muteContext?.channelId && mutedChannels.has(muteContext.channelId);
  const itemClass = "gap-2 cursor-pointer min-h-[44px] md:min-h-0 md:py-1.5";
  const defer = (cb: () => void) => () => setTimeout(cb, 0);
  const showAttention = !!attention && attention > 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`relative ${triggerClassName}`} title="More options" aria-label="More options" data-testid={triggerTestId}>
          <MoreHorizontal className={triggerIconClassName} />
          {showAttention && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-[9px] font-semibold leading-4 text-black"
              aria-label={`${attention} waiting`}
              data-testid="menu-attention-count"
            >
              {attention! > 9 ? "9+" : attention}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      {/* z-[80]: above the mobile chat overlay (z-[55]), below dialogs — same
          layer as the mobile channel sheet. */}
      <DropdownMenuContent align="end" className="glass-dropdown min-w-[200px] z-[80]">
        {/* FIRST, and visually separated by its icon: the one item that is about
            the space rather than about you. */}
        {onManage && (
          <DropdownMenuItem className={itemClass} onSelect={defer(onManage)} data-testid="menu-space-manage">
            <ShieldCheck className="w-3.5 h-3.5 text-brand" />
            Manage
            {showAttention && (
              <span className="ml-auto text-[10px] font-semibold text-amber-500">{attention}</span>
            )}
          </DropdownMenuItem>
        )}
        {onSettings && (
          <DropdownMenuItem className={itemClass} onSelect={defer(onSettings)} data-testid="menu-channel-settings">
            <Settings className="w-3.5 h-3.5" />
            Channel settings
          </DropdownMenuItem>
        )}
        {onMembers && (
          <DropdownMenuItem className={itemClass} onSelect={defer(onMembers)} data-testid="menu-group-members">
            <Users className="w-3.5 h-3.5" />
            Members
          </DropdownMenuItem>
        )}
        {onInvite && (
          <DropdownMenuItem className={itemClass} onSelect={defer(onInvite)} data-testid="menu-group-invite">
            <Link2 className="w-3.5 h-3.5" />
            Invite
          </DropdownMenuItem>
        )}
        {/* Mute — quiet, local-device, reversible. Channel first (narrower
            scope), then the whole group. No confirm dialogs: it's calm both ways. */}
        {muteContext?.channelId && (
          <DropdownMenuItem
            className={itemClass}
            onSelect={() => setChannelMuted(muteContext.communityId, muteContext.channelId!, !channelMuted)}
            data-testid="menu-mute-channel"
          >
            {channelMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            {channelMuted ? "Unmute" : "Mute"} #{muteContext.channelName ?? "channel"}
          </DropdownMenuItem>
        )}
        {muteContext && (
          <DropdownMenuItem
            className={itemClass}
            onSelect={() => setCommunityMuted(muteContext.communityId, !communityMuted)}
            data-testid="menu-mute-group"
          >
            {communityMuted ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            {communityMuted ? "Unmute group chat" : "Mute group chat"}
          </DropdownMenuItem>
        )}
        {petnameSubject && (
          <DropdownMenuItem className={itemClass} onSelect={defer(() => setPetnameOpen(true))} data-testid="menu-rename-for-you">
            <Pencil className="w-3.5 h-3.5" />
            Rename for you
          </DropdownMenuItem>
        )}
        {onLeave && (
          <DropdownMenuItem className={`${itemClass} text-destructive`} onSelect={defer(onLeave)} data-testid="menu-group-leave">
            {isOwner ? <Trash2 className="w-3.5 h-3.5" /> : <LogOut className="w-3.5 h-3.5" />}
            {isOwner ? "Delete group chat" : "Leave group chat"}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
      {petnameSubject && (
        <PetnameDialog
          open={petnameOpen}
          onOpenChange={setPetnameOpen}
          kind={petnameSubject.kind}
          id={petnameSubject.id}
          realName={petnameSubject.realName}
        />
      )}
    </DropdownMenu>
  );
}
