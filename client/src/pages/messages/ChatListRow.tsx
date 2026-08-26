import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Nip05Badge } from "@/components/Nip05Badge";
import { ImpersonationChip } from "@/components/ImpersonationChip";
import { GroupAvatar } from "@/components/GroupAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BellOff, Lock, MoreVertical, Pencil, Trash2, UserCheck, UserX } from "lucide-react";
import { formatConversationPreview, formatMessageTime } from "./helpers";

/**
 * One conversation in the chat list. Discriminated union: a 1:1 DM or a Concord
 * group chat (which navigates to its community page instead of a DM thread).
 */
export type ChatListItem =
  | {
      kind: "dm";
      pubkey: string;
      lastMessage: string;
      lastTimestamp: number;
      unread: boolean;
    }
  | {
      kind: "group";
      communityId: string;
      /** The SHARED group name — identical for every member. */
      name: string;
      /** Custom group image; absent ⇒ facepile of members. */
      icon?: string;
      channelCount: number;
      /** Newest known activity, ms since epoch. */
      lastActivity: number;
      unread: boolean;
      /** Unread mentions of you — the only number a group row shows. */
      mentions?: number;
      /** Community-level mute: quiet row, no dot, no badge. */
      muted?: boolean;
      /** Tap target channel while unread (mention-bearing channels first). */
      firstUnreadChannelId?: string;
      /** Channel the teaser is from — a tap opens THAT channel (priority over
       *  firstUnreadChannelId), so you land on exactly what the row previewed. */
      teaserChannelId?: string;
      /** Member pubkeys (roster snapshot) — drives the facepile avatar. */
      members: string[];
      /** Resolved member display names (kept on the item so search stays in sync). */
      memberNames?: string[];
      /** Decrypted last-message teaser from the LOCAL cache ("Vitor: hi") — absent ⇒ generic encrypted line. */
      teaser?: string;
    };

/** The one timestamp style every row shares — baseline-anchored to the title. */
const ROW_TIME_CLASS = "text-[11px] text-muted-foreground/80 shrink-0 tabular-nums";

interface DmRowProps {
  item: Extract<ChatListItem, { kind: "dm" }>;
  name: string;
  /** The PROFILE-claimed name only (no npub fallback) — feeds the impersonation guard on request rows. */
  profileName?: string;
  picture?: string;
  nip05?: string;
  isSelected: boolean;
  /** True when this row is shown under the Requests tab (flips the promote/demote menu item). */
  isRequest: boolean;
  /** Privacy: replace the message preview with a generic line (Settings → Privacy). */
  hidePreviews?: boolean;
  /** Petname avatar override — your photo, or an emoji/color tile, instead of theirs. */
  avatarOverride?: { emoji?: string; color?: string; imageUrl?: string };
  onOpen: (pubkey: string) => void;
  onOpenProfile: (pubkey: string) => void;
  onPromote: (pubkey: string) => void;
  onDemote: (pubkey: string) => void;
  onRemove: (pubkey: string) => void;
  /** Opens the "Rename for you" dialog (petnames). */
  onNickname?: (pubkey: string) => void;
}

interface GroupRowProps {
  item: Extract<ChatListItem, { kind: "group" }>;
  /** Signed-in pubkey, so the facepile favours OTHER members when capped. */
  myPubkey?: string | null;
  /** Tap target: the group's community page (/outposts/c/:id) — with a
   *  channel id when the group is unread, to land on the first unread channel. */
  onOpenGroup: (communityId: string, channelId?: string) => void;
}

type ChatListRowProps = DmRowProps | GroupRowProps;

/** One row in the merged chat list — a DM or a group chat, per item.kind.
 *  (TS doesn't narrow a props union on the nested item.kind — hence the casts.) */
export function ChatListRow(props: ChatListRowProps) {
  if (props.item.kind === "group") {
    const { item, myPubkey, onOpenGroup } = props as GroupRowProps;
    return <GroupChatRow item={item} myPubkey={myPubkey} onOpenGroup={onOpenGroup} />;
  }
  return <DmChatRow {...(props as DmRowProps)} />;
}

/**
 * A group-chat row — ONE variant for every group, 2-person and 3+ alike: a
 * facepile GroupAvatar (or the custom group image), the SHARED group name
 * (identical for all members), a quiet lock + the locally-decrypted last
 * message ("🔒 Vitor: testing from amethyst") — or the generic "N room(s) ·
 * encrypted" line until a decrypted message is cached (or when previews are
 * hidden) — last-activity time, and the same unread dot as DM rows. The
 * facepile (vs a DM's single round avatar) is what makes a group visually
 * distinct from a 1:1 chat, even when it's just me + one other person. No row
 * menu (yet) — the trailing w-8+mr-1 spacer mirrors the DM row's ⋮ button so
 * timestamps land at the SAME right offset in every row of the mixed list.
 */
function GroupChatRow({
  item,
  myPubkey,
  onOpenGroup,
}: {
  item: Extract<ChatListItem, { kind: "group" }>;
  myPubkey?: string | null;
  onOpenGroup: (communityId: string, channelId?: string) => void;
}) {
  const mentions = item.muted ? 0 : (item.mentions ?? 0);
  const unread = item.unread && !item.muted; // sources filter muted already — belt & suspenders
  return (
    // Same edge marker as a DM row — see the note there. A muted group is
    // deliberately excluded: `unread` already accounts for it, so a silenced
    // group never gets a bar however busy it is.
    <div
      className={`group relative flex items-center border-b border-border/10 ${
        item.muted ? "opacity-60" : unread ? "bg-brand/[0.04]" : ""
      }`}
      data-testid={`group-chat-${item.communityId.slice(0, 8)}`}
    >
      {unread && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand"
          aria-hidden="true"
          data-testid={`group-unread-bar-${item.communityId.slice(0, 8)}`}
        />
      )}
      <button
        onClick={() => onOpenGroup(item.communityId, item.teaserChannelId ?? item.firstUnreadChannelId)}
        className="flex-1 flex items-center gap-3 pl-3 pr-3 py-3 hover-elevate text-left min-w-0"
        data-testid={`button-open-group-${item.communityId.slice(0, 8)}`}
      >
        <div className="relative shrink-0">
          <GroupAvatar members={item.members} picture={item.icon} name={item.name} myPubkey={myPubkey} size={40} />
          {unread && (
            <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand border-2 border-background z-10" data-testid={`group-unread-${item.communityId.slice(0, 8)}`} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          {/* Title line: name + timestamp share ONE baseline (never centered
              against the whole row) — identical anchoring to DM rows. */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1 min-w-0">
              <span className={`text-sm truncate ${unread ? "font-semibold" : "font-medium"}`}>{item.name}</span>
              {item.muted && (
                <BellOff className="w-3 h-3 shrink-0 self-center text-muted-foreground/50" aria-label="Muted" data-testid={`group-muted-${item.communityId.slice(0, 8)}`} />
              )}
            </div>
            {item.lastActivity > 0 && (
              <span className={ROW_TIME_CLASS}>
                {formatMessageTime(Math.floor(item.lastActivity / 1000))}
              </span>
            )}
          </div>
          <p className={`flex items-center gap-1 text-xs mt-0.5 min-w-0 ${unread ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>
            <Lock className="w-3 h-3 shrink-0" aria-label="End-to-end encrypted" />
            <span className="truncate flex-1" data-testid={`group-teaser-${item.communityId.slice(0, 8)}`}>
              {item.teaser ?? `${item.channelCount} room${item.channelCount !== 1 ? "s" : ""} · encrypted`}
            </span>
            {/* Calm rule: the only NUMBER a group row shows is mentions of you. */}
            {mentions > 0 && (
              <span
                className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white shrink-0"
                aria-label={`${mentions} mention${mentions === 1 ? "" : "s"}`}
                data-testid={`group-mentions-${item.communityId.slice(0, 8)}`}
              >
                {mentions > 9 ? "9+" : mentions}
              </span>
            )}
          </p>
        </div>
      </button>
      {/* Same-width gutter as the DM row's ⋮ menu (w-8 icon button + mr-1). */}
      <div className="w-8 mr-1 shrink-0" aria-hidden="true" />
    </div>
  );
}

/** A single DM row — avatar + unread dot, name + NIP-05 badge, time, preview line, and the ⋮ menu. */
function DmChatRow({
  item,
  name,
  profileName,
  picture,
  nip05,
  isSelected,
  isRequest,
  hidePreviews,
  avatarOverride,
  onOpen,
  onOpenProfile,
  onPromote,
  onDemote,
  onRemove,
  onNickname,
}: DmRowProps) {
  return (
    // Unread gets a left accent bar and a faint wash, not just a 10px dot.
    //
    // The order of this list is pure recency and stays that way — new activity
    // already lifts a row, and floating unread above read would rearrange the
    // list under your thumb as you read things, which every major messenger
    // avoids for the same reason. So the fix for "it just sits there with a dot"
    // is to make the state legible from across the row rather than to move it:
    // an edge marker reads in peripheral vision while scanning, a dot on a
    // 40px avatar does not.
    <div
      className={`group relative flex items-center border-b border-border/10 ${
        isSelected ? "bg-brand/10 md:bg-brand/10" : item.unread ? "bg-brand/[0.04]" : ""
      }`}
      data-testid={`conversation-${item.pubkey.slice(0, 8)}`}
    >
      {item.unread && (
        <span
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand"
          aria-hidden="true"
          data-testid={`conversation-unread-bar-${item.pubkey.slice(0, 8)}`}
        />
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenProfile(item.pubkey); }}
        className="relative shrink-0 ml-3 cursor-pointer"
        data-testid={`avatar-link-${item.pubkey.slice(0, 8)}`}
      >
        {avatarOverride?.imageUrl ? (
          // YOUR photo for them — processed at import (160px, metadata-free,
          // this device only; see lib/petname-images.ts).
          <img
            src={avatarOverride.imageUrl}
            alt=""
            className="w-10 h-10 rounded-full object-cover border border-border select-none"
            data-testid={`petname-photo-${item.pubkey.slice(0, 8)}`}
          />
        ) : avatarOverride && (avatarOverride.emoji || avatarOverride.color) ? (
          // Petname tile: YOUR icon for them, replacing the picture entirely —
          // a half-replaced avatar reads as a broken image, not a choice.
          <span
            className="w-10 h-10 rounded-full border border-border flex items-center justify-center text-lg select-none"
            style={{ backgroundColor: avatarOverride.color ?? "hsl(var(--muted))" }}
            data-testid={`petname-avatar-${item.pubkey.slice(0, 8)}`}
          >
            {avatarOverride.emoji ?? name.slice(0, 1).toUpperCase()}
          </span>
        ) : (
        <Avatar className="w-10 h-10 border border-border hover:ring-2 hover:ring-brand/40 transition-shadow">
          <AvatarImage src={picture} alt={name} />
          <AvatarFallback className="text-xs bg-muted text-muted-foreground">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        )}
        {item.unread && (
          <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand border-2 border-background" />
        )}
      </button>
      <button
        onClick={() => onOpen(item.pubkey)}
        className="flex-1 flex items-center gap-3 px-3 py-3 hover-elevate text-left min-w-0"
      >
        <div className="flex-1 min-w-0">
          {/* Title line: name + timestamp share ONE baseline (never centered
              against the whole row) — identical anchoring to group rows. */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0">
              <span className={`text-sm truncate ${item.unread ? "font-semibold" : "font-medium"}`}>{name}</span>
              <Nip05Badge nip05={nip05} pubkey={item.pubkey} showText={false} iconClassName="w-3 h-3" />
            </div>
            <span className={ROW_TIME_CLASS}>
              {formatMessageTime(item.lastTimestamp)}
            </span>
          </div>
          {/* Impersonation guard: only strangers land in Requests, so the
              lookalike check runs here and never on Primary rows. */}
          {isRequest && profileName && (
            <ImpersonationChip pubkey={item.pubkey} displayName={profileName} nip05={nip05} className="mt-0.5" />
          )}
          <p className={`text-xs truncate mt-0.5 ${item.unread ? "text-foreground/80 font-medium" : "text-muted-foreground"}`}>
            {hidePreviews ? "Message" : formatConversationPreview(item.lastMessage)}
          </p>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* This menu is the ONLY home of Move to Primary, Move to Requests and
              Remove conversation — the row's other two targets go to the profile
              and the thread. It was `opacity-0 group-hover:opacity-100` with no
              responsive prefix, so on a phone it was invisible at every width and
              a conversation could never be triaged or removed. The button stayed
              hit-testable, which is worse than absent: the only way to reach it
              was a blind tap in an unmarked gutter.
              `group-active:opacity-60` was not a touch path either — it shows
              while a finger is down and reverts on lift, and lifting on the row
              fires navigation instead. `focus:opacity-100` is covered by
              .reveal-on-hover's own :focus-within. */}
          <button
            className="reveal-on-hover touch-target p-2 mr-1 text-muted-foreground/50 cursor-pointer shrink-0"
            aria-label="Conversation options"
            title="Conversation options"
            data-testid={`button-conv-menu-${item.pubkey.slice(0, 8)}`}
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="glass-dropdown min-w-[160px]">
          {isRequest && (
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={() => onPromote(item.pubkey)}
              data-testid={`button-promote-conv-${item.pubkey.slice(0, 8)}`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              Move to Primary
            </DropdownMenuItem>
          )}
          {!isRequest && (
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              onClick={() => onDemote(item.pubkey)}
              data-testid={`button-demote-conv-${item.pubkey.slice(0, 8)}`}
            >
              <UserX className="w-3.5 h-3.5" />
              Move to Requests
            </DropdownMenuItem>
          )}
          {onNickname && (
            <DropdownMenuItem
              className="gap-2 cursor-pointer"
              // Deferred past the menu's own close — the same rule
              // SpaceOverflowMenu documents. Opening a dialog synchronously
              // from a dismissing dropdown left document.body with
              // pointer-events:none after the dialog closed: the app froze
              // solid after Save/Cancel (owner repro: rename → save without
              // changes → nothing clickable). setTimeout(0) lets the
              // dropdown's dismiss sequence finish before the dialog mounts.
              onClick={() => setTimeout(() => onNickname(item.pubkey), 0)}
              data-testid={`button-nickname-conv-${item.pubkey.slice(0, 8)}`}
            >
              <Pencil className="w-3.5 h-3.5" />
              Rename for you
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="gap-2 text-destructive cursor-pointer"
            onClick={() => onRemove(item.pubkey)}
            data-testid={`button-delete-conv-${item.pubkey.slice(0, 8)}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove conversation
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
