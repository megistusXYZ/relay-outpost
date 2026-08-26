/**
 * The Concord admin door, as one component both surfaces mount.
 *
 * The chat and the outpost page are separate surfaces and each needs its own
 * way in, but the CONTENTS must not be written twice. That was the mistake the
 * moderation log nearly shipped with — two renderers of the same thing, free to
 * disagree about what happened. So the sections, their gates, and the dialogs
 * they open live here once, and a host supplies only `community`, the change
 * callback, and the dissolve hand-off.
 *
 * It owns the dialogs it opens (edit metadata, create channel) rather than
 * borrowing the host's, because those dialogs perform NO permission checks of
 * their own — they have always relied on their trigger being hidden. Keeping
 * them behind this component's capability gates means there is exactly one
 * answer to "who may open this", instead of one answer per host.
 */
import { useCallback, useMemo, useState } from "react";
import { DoorOpen, Hash, History as HistoryIcon, Lock, Settings2, Trash2, Users } from "lucide-react";
import { SpaceAdminDrawer } from "@/components/space/SpaceAdminDrawer";
import { SpaceAdminSection } from "@/components/space/SpaceAdminSection";
import type { SpaceAdminSectionDef } from "@/components/space/space-admin-sections";
import { concordCapabilities } from "@/lib/space-admin";
import type { StoredCommunity, StoredChannel } from "@/lib/concord/concord-keys";
import { VSK, type Member, type AuditEntry, type FoldedState } from "@/lib/concord/concord-events";
import { membersMayInvite } from "@/lib/concord/concord-invite-gate";
import type { MembershipEvent } from "./useConcordGovernance";
import { ConcordMembers } from "./ConcordMembers";
import { ConcordActivityLog } from "./ConcordActivityLog";
import { ConcordEditOutpostDialog } from "./ConcordEditOutpostDialog";
import { ConcordCreateChannelDialog } from "./ConcordCreateChannelDialog";
import { ConcordChannelSettingsDialog } from "./ConcordChannelSettingsDialog";

export function ConcordAdminDrawer({
  open,
  onOpenChange,
  community,
  onCommunityChange,
  isOwner,
  myMember,
  govState,
  auditLog,
  events,
  channels,
  onDissolve,
  onChannelCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  community: StoredCommunity;
  onCommunityChange: (c: StoredCommunity) => void;
  isOwner: boolean;
  /** From useConcordGovernance — undefined until the fold resolves this viewer. */
  myMember?: Member;
  govState: FoldedState;
  auditLog: AuditEntry[];
  events: MembershipEvent[];
  /** The LIVE channel list (folded names + public channels the local record lacks). */
  channels: StoredChannel[];
  /** The host's existing dissolve confirm — never a second wording for it. */
  onDissolve?: () => void;
  onChannelCreated?: (channelId: string) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsChannel, setSettingsChannel] = useState<StoredChannel | undefined>();
  const caps = useMemo(() => concordCapabilities(myMember), [myMember]);
  // Same precedence the invite gate enforces — fold over record — so the
  // sentence in the Access section is the rule, not a second reading of it.
  const invitesOpenToMembers = membersMayInvite(community, govState.metadata);
  const bannedCount = govState.banlist.size;

  /**
   * Has authority RESOLVED — not "is there a roster".
   *
   * computeRoster seats the owner unconditionally, with no join rumor, so a
   * roster is non-empty on the very first render before any relay data. Gating
   * on that told a genuine admin "You don't run this room." for as long as the
   * fold took. The owner is knowable synchronously; everyone else waits for
   * their member record.
   */
  const ready = isOwner || !!myMember;
  const standingLine = isOwner
    ? "You're the owner. Everything here is yours to change."
    : "You're an admin here — you can do what your role allows.";

  const renderSection = useCallback((section: SpaceAdminSectionDef) => {
    switch (section.id) {
      case "people":
        // Re-derives authority from the fold itself, so it is safe anywhere —
        // the one dialog in this drawer that does. Its activity block is
        // suppressed because `history` renders the same log as its own section.
        return (
          <SpaceAdminSection can={caps.manageMembers} title={section.label} icon={Users}>
            <ConcordMembers community={community} onCommunityChange={onCommunityChange} showActivity={false} />
          </SpaceAdminSection>
        );
      case "history":
        return (
          <SpaceAdminSection can={caps.viewAuditLog} title={section.label} icon={HistoryIcon}>
            <ConcordActivityLog auditLog={auditLog} events={events} banned={[...govState.banlist]} />
          </SpaceAdminSection>
        );
      case "channels":
        return (
          <SpaceAdminSection
            can={caps.manageChannels}
            title={section.label}
            icon={Hash}
            action={
              <button onClick={() => setCreateOpen(true)} className="text-[11px] text-primary hover:underline" data-testid="space-admin-new-channel">
                New room
              </button>
            }
          >
            <div className="space-y-0.5">
              {/* Each row opens THAT channel's settings. The ⋯ menu could only
                  ever reach the channel you were standing in, which is why
                  renaming any other one meant switching to it first. */}
              {channels.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSettingsChannel(c)}
                  className="w-full flex items-center gap-2 text-xs text-muted-foreground/80 px-0.5 py-2 md:py-1.5 rounded-md hover:bg-muted/20 text-left transition-colors"
                  data-testid={`space-admin-channel-${c.id.slice(0, 8)}`}
                >
                  <Hash className="w-3 h-3 shrink-0 text-muted-foreground/50" />
                  <span className="truncate text-foreground/80">{c.name}</span>
                  {c.isPrivate && <Lock className="w-3 h-3 shrink-0 text-muted-foreground/40" />}
                  <Settings2 className="w-3 h-3 ml-auto shrink-0 text-muted-foreground/40" />
                </button>
              ))}
            </div>
          </SpaceAdminSection>
        );
      case "access":
        // Concord's ONLY access control, and until now it was invisible: the
        // switch lives inside the edit dialog, under a section headed "Name &
        // description". The policy was real, reachable and unnamed.
        //
        // No new mechanism — it reads the fold this drawer already holds and
        // opens the dialog that already writes it. The sentence comes from
        // `membersMayInvite`, the same function the invite gate enforces with,
        // so the screen cannot drift from the rule.
        return (
          <SpaceAdminSection can={caps.editMetadata} title={section.label} icon={DoorOpen}>
            <div className="space-y-2">
              <p className="text-xs text-foreground/80">
                {invitesOpenToMembers ? "Any member can invite people." : "Only admins can invite people."}
              </p>
              <p className="text-[11px] text-muted-foreground/60">
                This group is invite-only either way — there is no public join link.
              </p>
              {bannedCount > 0 && (
                // Read-only ON PURPOSE. The fold UNIONS every banlist edition it
                // admits (concord-events.ts) precisely because the protocol has
                // no unban; a button here would appear to work and be undone by
                // the next ban anyone publishes. Stating the count is honest,
                // offering a reversal is not.
                <p className="text-[11px] text-muted-foreground/60">
                  {bannedCount} {bannedCount === 1 ? "person is" : "people are"} banned. Bans can't be undone yet.
                </p>
              )}
              <button onClick={() => setEditOpen(true)} className="text-[11px] text-primary hover:underline" data-testid="space-admin-edit-access">
                Change who can invite
              </button>
            </div>
          </SpaceAdminSection>
        );
      case "details":
        return (
          <SpaceAdminSection can={caps.editMetadata} title={section.label} icon={Settings2}>
            <div className="space-y-2">
              <p className="text-xs text-foreground/80 truncate">{community.name}</p>
              {community.about && <p className="text-[11px] text-muted-foreground/60 line-clamp-2">{community.about}</p>}
              <button onClick={() => setEditOpen(true)} className="text-[11px] text-primary hover:underline" data-testid="space-admin-edit-details">
                Edit name, image &amp; description
              </button>
            </div>
          </SpaceAdminSection>
        );
      case "danger":
        // Owner-only (caps.dissolve), and it hands off to the host's existing
        // confirm rather than minting a second one — two confirms would be two
        // chances to word the irreversible thing differently.
        return (
          <SpaceAdminSection can={caps.dissolve && !!onDissolve} title={section.label} icon={Trash2}>
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground/60">
                Ends this group chat for everyone. Nobody can undo it, including you.
              </p>
              <button onClick={onDissolve} className="text-[11px] text-destructive hover:underline" data-testid="space-admin-dissolve">
                Delete this group chat
              </button>
            </div>
          </SpaceAdminSection>
        );
      default:
        return null;
    }
  }, [caps, community, onCommunityChange, auditLog, events, govState.banlist, channels, onDissolve, invitesOpenToMembers, bannedCount]);

  return (
    <>
      <SpaceAdminDrawer
        open={open}
        onOpenChange={onOpenChange}
        backend="concord"
        caps={caps}
        ready={ready}
        spaceName={community.name}
        spaceAvatar={community.icon}
        standingLine={standingLine}
        renderSection={renderSection}
      />
      <ConcordEditOutpostDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        community={community}
        onCommunityChange={onCommunityChange}
        // The drawer has held the fold all along and was handing the dialog
        // only the stored record — which, for anyone who did not create this
        // community, is a join-time snapshot nothing ever refreshes.
        govMetadata={govState.metadata}
        foldHead={govState.heads.get(`${VSK.METADATA}:${community.community_id}`)}
      />
      <ConcordChannelSettingsDialog
        open={!!settingsChannel}
        onOpenChange={(v) => { if (!v) setSettingsChannel(undefined); }}
        community={community}
        channel={settingsChannel}
        onCommunityChange={onCommunityChange}
        // Same reason the community details dialog needs the fold: a channel's
        // chain cursor is per-device, and for one this device did not create
        // there is no cursor at all.
        govChannel={settingsChannel ? govState.channels.get(settingsChannel.id) : undefined}
        foldHead={settingsChannel ? govState.heads.get(`${VSK.CHANNEL}:${settingsChannel.id}`) : undefined}
        // The rows above are the LIVE list.
        channelCount={channels.length}
      />
      <ConcordCreateChannelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        community={community}
        onCommunityChange={onCommunityChange}
        onCreated={(id) => { onChannelCreated?.(id); onOpenChange(false); }}
      />
    </>
  );
}
