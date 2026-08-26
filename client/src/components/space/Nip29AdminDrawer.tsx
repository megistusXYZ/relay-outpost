/**
 * The NIP-29 admin door — the relay-hosted twin of ConcordAdminDrawer.
 *
 * Deliberately a DIRECTORY, not a reimplementation. Every panel it points at
 * already exists in CommsTab (join requests, members, add-member, settings,
 * delete confirm) and every one of them stacks at z-[210], above this drawer's
 * z-[200]. So each section shows the state and hands off. That keeps the promise
 * the drawer was built on: it adds zero governance calls, and there is exactly
 * one implementation of each action rather than one per surface.
 *
 * The one thing it does add is `history`, because a NIP-29 moderation log had no
 * renderer anywhere outside the Relay Ops console.
 *
 * NIP-29 authority is one bit: you are in the kind-39001 admin list or you are
 * not. nip29Capabilities reports that honestly, so a moderator sees every
 * section at once and a non-moderator sees none — there is no partial-authority
 * case to design for on this backend, unlike Concord.
 */
import { useCallback } from "react";
import { DoorOpen, History as HistoryIcon, Settings2, Trash2, UserPlus, Users } from "lucide-react";
import { SpaceAdminDrawer } from "./SpaceAdminDrawer";
import { SpaceAdminSection } from "./SpaceAdminSection";
import type { SpaceAdminSectionDef } from "./space-admin-sections";
import type { SpaceCapabilities } from "@/lib/space-admin";
import { Nip29ModerationLog } from "./Nip29ModerationLog";
import type { DoorState, ReadState } from "@/lib/nip29-door";

export function Nip29AdminDrawer({
  open,
  onOpenChange,
  caps,
  ready,
  relayUrl,
  groupId,
  groupName,
  groupPicture,
  join,
  read,
  isRestricted,
  pendingCount,
  memberCount,
  about,
  onOpenRequests,
  onOpenMembers,
  onAddMember,
  onOpenSettings,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caps: SpaceCapabilities;
  /**
   * The admin list came back — NOT "the admin list is non-empty".
   *
   * fetchGroupAdmins starts from [] and swallows its error, so loading, empty
   * and failed are the same value. Without a separate flag the drawer would
   * tell a real moderator "You don't run this room." while the fetch was still
   * in flight.
   */
  ready: boolean;
  relayUrl: string;
  groupId: string;
  groupName: string;
  groupPicture?: string;
  /**
   * The two doors, ALREADY DERIVED by the host (lib/nip29-door.ts) rather than
   * re-decided here. One derivation means the switches in the settings panel
   * and this summary can never describe the same room differently — and the
   * derivation is subtle enough now (NIP-29 defaults, unresolved metadata,
   * self-contradicting relays) that two copies would certainly drift.
   */
  join: DoorState;
  read: ReadState;
  isRestricted: boolean;
  pendingCount: number;
  memberCount: number;
  about?: string;
  onOpenRequests: () => void;
  onOpenMembers: () => void;
  onAddMember: () => void;
  onOpenSettings: () => void;
  onDelete: () => void;
}) {
  const renderSection = useCallback((section: SpaceAdminSectionDef) => {
    switch (section.id) {
      case "requests":
        return (
          <SpaceAdminSection can={caps.manageMembers} title={section.label} icon={Users}>
            {join === "open" ? (
              // `join`, not `!isClosed` — the seventh door site, missed when the
              // other six were converted. On a room opened with the settings
              // panel's own switch, newlay REMOVES `closed` and adds no positive
              // `open`, so `isClosed` is false and this claimed "nobody waits"
              // while the room header rendered a pending count beside it.
              //
              // visibleSections gates on capability and backend, neither of which
              // can express "this particular room is open". Without saying so, a
              // moderator gets a Waiting-to-join section backed by a list that is
              // never populated — an empty queue that means "nothing to do" and
              // an open door look identical.
              <p className="text-[11px] text-muted-foreground/60">
                Anyone can join this room, so nobody waits for approval.
              </p>
            ) : pendingCount === 0 ? (
              <p className="text-[11px] text-muted-foreground/60">Nobody is waiting.</p>
            ) : (
              <button onClick={onOpenRequests} className="text-[11px] text-primary hover:underline" data-testid="nip29-admin-requests">
                Review {pendingCount} waiting
              </button>
            )}
          </SpaceAdminSection>
        );
      case "people":
        return (
          <SpaceAdminSection can={caps.manageMembers} title={section.label} icon={Users}>
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground/60">
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={onOpenMembers} className="text-[11px] text-primary hover:underline" data-testid="nip29-admin-members">
                  Manage members
                </button>
                <button onClick={onAddMember} className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" data-testid="nip29-admin-add-member">
                  <UserPlus className="w-3 h-3" /> Add someone
                </button>
              </div>
            </div>
          </SpaceAdminSection>
        );
      case "history":
        return (
          <SpaceAdminSection can={caps.viewAuditLog} title={section.label} icon={HistoryIcon}>
            <Nip29ModerationLog relayUrl={relayUrl} groupId={groupId} />
          </SpaceAdminSection>
        );
      case "access":
        // States the door and HANDS OFF, like every other section here — the
        // drawer stays a directory and adds no governance call of its own. The
        // switches live in CommsTab's settings panel, which is the one place a
        // kind-9002 is written.
        //
        // TWO AXES, never collapsed: public/private is who may READ,
        // open/closed is who may JOIN.
        //
        // Both come from `joinDoor`/`readDoor` rather than being re-derived
        // here, because the derivation stopped being obvious. `!isClosed` still
        // conflates "the relay said anyone may walk in" with "we never got
        // metadata" — but newlay expresses an open room by REMOVING `closed`
        // and emits no positive `open`, so requiring one would report every
        // opened room as unreadable. The distinction that survives both is
        // whether we HOLD the metadata; see lib/nip29-door.ts.
        return (
          <SpaceAdminSection can={caps.editMetadata} title={section.label} icon={DoorOpen}>
            <div className="space-y-2">
              <p className="text-xs text-foreground/80">
                {read === "public"
                  ? "Anyone can read what's posted here."
                  : read === "private"
                  ? "Only members can read what's posted here."
                  : "We couldn't tell who can read this room."}
              </p>
              <p className="text-xs text-foreground/80">
                {join === "open"
                  ? "Anyone can join without asking."
                  : join === "closed"
                  ? "People ask to join, and a moderator lets them in."
                  : "We couldn't tell how people join this room."}
              </p>
              {isRestricted && (
                <p className="text-[11px] text-muted-foreground/60">
                  Only this relay's own members can post.
                </p>
              )}
              {join === "unknown" || read === "unknown" ? (
                <p className="text-[11px] text-muted-foreground/60">
                  Until we can read the current settings, they can't be changed from here.
                </p>
              ) : (
                <button onClick={onOpenSettings} className="text-[11px] text-primary hover:underline" data-testid="nip29-admin-edit-access">
                  Change who can get in
                </button>
              )}
            </div>
          </SpaceAdminSection>
        );
      case "details":
        return (
          <SpaceAdminSection can={caps.editMetadata} title={section.label} icon={Settings2}>
            <div className="space-y-2">
              <p className="text-xs text-foreground/80 truncate">{groupName}</p>
              {about && <p className="text-[11px] text-muted-foreground/60 line-clamp-2">{about}</p>}
              <button onClick={onOpenSettings} className="text-[11px] text-primary hover:underline" data-testid="nip29-admin-edit-details">
                Edit name, image &amp; description
              </button>
            </div>
          </SpaceAdminSection>
        );
      case "danger":
        return (
          <SpaceAdminSection can={caps.dissolve} title={section.label} icon={Trash2}>
            <div className="space-y-2">
              {/* Said plainly because it is true and easy to get wrong: on a relay
                  the deletion is a REQUEST (kind 9008). The relay decides. */}
              <p className="text-[11px] text-muted-foreground/60">
                Asks the relay to delete this room for everyone. If the relay declines, it stays.
              </p>
              <button onClick={onDelete} className="text-[11px] text-destructive hover:underline" data-testid="nip29-admin-delete">
                Delete this room
              </button>
            </div>
          </SpaceAdminSection>
        );
      default:
        return null;
    }
  }, [caps, join, read, isRestricted, pendingCount, memberCount, about, groupName, relayUrl, groupId,
      onOpenRequests, onOpenMembers, onAddMember, onOpenSettings, onDelete]);

  return (
    <SpaceAdminDrawer
      open={open}
      onOpenChange={onOpenChange}
      backend="nip29"
      caps={caps}
      ready={ready}
      spaceName={groupName}
      spaceAvatar={groupPicture}
      // One bit, reported as one bit. Concord can say "you're an admin, here is
      // your limit"; NIP-29 genuinely cannot, and pretending otherwise would be
      // the kind of confident-sounding lie this drawer exists to remove.
      standingLine="You're a moderator on this relay — it grants every admin the same powers."
      renderSection={renderSection}
    />
  );
}
