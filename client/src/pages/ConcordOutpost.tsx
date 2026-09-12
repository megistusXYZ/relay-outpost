/**
 * A relay-less Concord group chat (encrypted community). Slice 2: Chat + About.
 * Identity portals into the global top bar like the community/profile
 * pages; every load starts on Chat.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useGoBack } from "@/hooks/use-go-back";
import { ChevronDown, MessageSquare, Info, Copy, Check, Link2, Lock, Hash, Plus, Users, Settings2 } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";
import { PageTabs } from "@/components/PageTabs";
import { useToast } from "@/hooks/use-toast";
import { getCommunity, type StoredCommunity } from "@/lib/concord/concord-keys";
import { recordRecentDestination } from "@/lib/recent-destinations";
import { isConcordEnabled } from "@/lib/concord/concord-prefs";
import { ConcordChat } from "@/components/concord/ConcordChat";
import { GroupAvatar } from "@/components/GroupAvatar";
import { ManageCountBadge } from "@/components/concord/ManageCountBadge";
import { canInviteToCommunity, rosterPubkeys } from "@/lib/concord/concord-invite-gate";
import { ConcordMembers } from "@/components/concord/ConcordMembers";
import { ConcordInviteDialog } from "@/components/concord/ConcordInviteDialog";
import { ConcordCreateChannelDialog } from "@/components/concord/ConcordCreateChannelDialog";
import { useConcordGovernance, COMMUNITY_UPDATED_EVENT } from "@/components/concord/useConcordGovernance";
import { isStaff } from "@/lib/concord/concord-events";
import { ConcordAdminDrawer } from "@/components/concord/ConcordAdminDrawer";
import { concordCapabilities, hasAnyCapability } from "@/lib/space-admin";
import { liveChannels } from "@/lib/concord/concord-live-channels";
import { hasPermission, PERM } from "@/lib/concord/concord-events";
import { Pencil, Trash2, LogOut } from "lucide-react";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { useHeaderIdentitySlot } from "@/hooks/use-header-identity-slot";
import { ConcordDangerDialog } from "@/components/concord/ConcordDangerDialog";
import { useChatLayout } from "@/hooks/use-chat-layout";
import { ChatPaneSection } from "@/components/concord/ChatPaneSection";
import { PaneResizeHandle } from "@/components/ui/pane-resize-handle";
import { SpaceOverflowMenu } from "@/components/space/SpaceOverflowMenu";
import { fitPanes, resizePane, resetPane, showPane, togglePane, toggleSection, PANE_LIMITS } from "@/lib/chat-layout";

/** The desktop row's own chrome: its side padding (2 × 16) and the gap before Members + About. */
const PANES_CHROME = 32 + 12;

export default function ConcordOutpost({ communityId }: { communityId: string }) {
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const goBack = useGoBack();
  const { toast } = useToast();
  const [community, setCommunity] = useState<StoredCommunity | null | undefined>(undefined);
  const [tab, setTab] = useState<"chat" | "members" | "about">("chat");
  const [adminOpen, setAdminOpen] = useState(false);
  // ?channel= deep-link (Chats-list rows open the first UNREAD channel).
  // Captured once on mount — the ?invite=1 effect below strips the search.
  const [initialChannelId] = useState<string | undefined>(() => {
    try { return new URLSearchParams(window.location.search).get("channel") ?? undefined; } catch { return undefined; }
  });
  const isMobile = useIsMobile();
  // Desktop: rooms | chat | Members + About, each side resizable and foldable,
  // each section closable; the phone's Group sheet shares the sections' state.
  // One layout per device, for every group (lib/chat-layout).
  const { layout, update } = useChatLayout();
  const [panesEl, setPanesEl] = useState<HTMLDivElement | null>(null);
  const [panesWidth, setPanesWidth] = useState(0);
  useEffect(() => {
    if (!panesEl || typeof ResizeObserver === "undefined") return;
    const measure = () => setPanesWidth(Math.max(0, panesEl.clientWidth - PANES_CHROME));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panesEl);
    return () => ro.disconnect();
  }, [panesEl]);
  // Phone: the group's name in the top bar opens the Group sheet.
  const [groupSheetNonce, setGroupSheetNonce] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // (No editOpen here: the edit dialog is the admin drawer's. This page held a
  //  second mount whose open flag nothing ever set — dead since it was added.)
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [danger, setDanger] = useState<null | "dissolve" | "leave">(null);
  // The top bar's identity slot is tracked LIVE: on desktop the header bar
  // (and the slot with it) unmounts while the sidebar is expanded, so a
  // one-shot lookup would leave the group chat with no identity there.
  // When the slot is absent the same strip renders inline above the tabs.
  const slotEl = useHeaderIdentitySlot();
  // Mobile keyboard: size the fixed chat overlay to the visual viewport so the
  // composer rides the on-screen keyboard (same mechanics as the DM thread).
  const kb = useKeyboardViewport(tab === "chat" && !!community);
  const isOwner = !!community && pubkey === community.owner;
  // Owner + admins (CREATE_INVITE) manage invite links; members forward them —
  // unless the owner opened invites to everyone (allowMemberInvites policy).
  const { state: govState, roster: govRoster, myMember, events: govEvents, auditLog: govAuditLog, deleted, linkJoins: govLinkJoins, compaction: govCompaction } = useConcordGovernance(community);
  // A group its owner deleted takes nobody new.
  const canInvite = !deleted && canInviteToCommunity({ community, pubkey, myMember, govMetadata: govState.metadata });
  // Same gate as ConcordChat's rail button — the About tab hosts the only
  // "New channel" entry point visible while the group has a single channel.
  const canManageChannels = isOwner || (!!myMember && hasPermission(myMember, PERM.MANAGE_CHANNELS));

  // Hide the mobile bottom nav while the full-screen chat is up (same event
  // contract as the DM thread); restore it on tab switch or unmount.
  useEffect(() => {
    const chatUp = tab === "chat" && !!community;
    window.dispatchEvent(new Event(chatUp ? "dm-thread-open" : "dm-thread-close"));
    return () => { window.dispatchEvent(new Event("dm-thread-close")); };
  }, [tab, community]);
  useEffect(() => {
    if (!pubkey) return;
    getCommunity(pubkey, communityId).then(setCommunity);
  }, [pubkey, communityId]);
  // A rekey changed the stored record (epoch hop, channel-key delivery, or our
  // own removal) — re-read it; a null read renders the "no keys" screen.
  useEffect(() => {
    if (!pubkey) return;
    const onUpdated = (e: Event) => {
      if ((e as CustomEvent).detail === communityId) getCommunity(pubkey, communityId).then(setCommunity);
    };
    window.addEventListener(COMMUNITY_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(COMMUNITY_UPDATED_EVENT, onUpdated);
  }, [pubkey, communityId]);
  // Post-create nudge: open the invite dialog when arriving via ?invite=1 (owner).
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("invite") === "1" && isOwner) {
        setInviteOpen(true);
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch {}
  }, [isOwner]);

  // The SHARED group name shown to every member. Live folded metadata wins
  // over the stale local record (same "folded wins" rule as `about` below) so
  // an owner's rename propagates to existing members; the record covers the
  // gap before the fold arrives. Never viewer-specific — a group presents as a
  // GROUP, never as one of its members.
  const displayName = (govState.metadata?.name?.trim() || community?.name) ?? "";
  // "Jump back in" MRU (Stories menu): record this community visit locally.
  // Re-runs when the resolved name arrives so the stored label stays fresh;
  // the ledger dedupes by id, so it's still one row per community.
  useEffect(() => {
    if (!pubkey) return;
    recordRecentDestination(pubkey, {
      type: "community",
      id: communityId,
      path: `/outposts/c/${communityId}`,
      label: displayName || undefined,
    });
  }, [pubkey, communityId, displayName]);
  // Group description for the About tab. Once the live governance fold has
  // metadata it's authoritative (owner edits arrive as vsk-0 editions and a
  // member's stored record never rewrites) — including an owner CLEARING the
  // description, so an empty live value must not fall back to the snapshot.
  const aboutText = (govState.metadata ? govState.metadata.about ?? "" : community?.about ?? "").trim();

  // Facepile member pubkeys for the group avatar. The live fold wins once it
  // has seen a join (≥2 members — a fresh fold is just the owner, seated
  // without a rumor); the persisted snapshot covers the gap while it loads.
  const rosterPks = useMemo(
    () => (community ? rosterPubkeys(community.community_id, govRoster) : []),
    [community, govRoster],
  );

  // Same live list the chat builds, from the same function — the admin drawer
  // must not see a different set of channels depending on which door opened it.
  const drawerChannels = useMemo(
    () => (community ? liveChannels(community, govState) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [community?.channels, community?.root_epoch, govState.channels],
  );


  if (!isConcordEnabled()) {
    return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-sm text-muted-foreground/60">Group chats aren't enabled.</div>;
  }
  if (community === undefined) {
    return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-sm text-muted-foreground/50">Opening…</div>;
  }
  if (community === null) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-3">
        <Lock className="w-10 h-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground/70">You don't have the keys for this group chat on this device.</p>
        <p className="text-[11px] text-muted-foreground/40">Sign in on the device that created it, or accept an invite.</p>
        <button onClick={() => goBack("/messages")} className="text-xs text-brand hover:underline">Back to chats</button>
      </div>
    );
  }

  // Condensed identity row (avatar · name · lock · Invite · ⌄) — portals into
  // the top bar's slot when it exists, renders inline above the tabs when the
  // bar is unmounted (desktop, sidebar expanded). Shared JSX so the two can't
  // drift.
  const identityStrip = (
    <div className="flex w-full items-center gap-2 min-w-0 pr-1">
      <button onClick={isMobile ? () => setGroupSheetNonce((n) => n + 1) : () => setExpanded((v) => !v)} className="flex items-center gap-2 min-w-0 flex-1 text-left" data-testid="concord-identity-name">
        <GroupAvatar members={rosterPks} picture={community.icon} image={community.iconImage} name={displayName} myPubkey={pubkey} size={28} className="shrink-0" />
        <span className="text-sm font-bold truncate">{displayName}</span>
        <span className="shrink-0 inline-flex" title="End-to-end encrypted" aria-label="End-to-end encrypted"><Lock className="w-3 h-3 text-muted-foreground/50" /></span>
      </button>
      {canInvite && (
        <button onClick={() => setInviteOpen(true)} className="flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground/60 hover:text-brand hover:bg-brand/10 shrink-0" title="Invite" data-testid="button-concord-invite">
          <Link2 className="w-4 h-4" />
        </button>
      )}
      <button onClick={isMobile ? () => setGroupSheetNonce((n) => n + 1) : () => setExpanded((v) => !v)} aria-label="Group details" className="flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 shrink-0">
        <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
    </div>
  );

  // About, shared by the desktop side and the phone's Group sheet (so the two
  // can't drift). Stacked, not a row: beside a photo in a 280px side, the
  // description wrapped a word per line, the encryption note ran to five, and
  // Manage was a chip squeezed against them. Who the group is, then what you
  // can do in it.
  // One door replaces four scattered ones, and it follows the capability
  // model, so an admin holding MANAGE_METADATA can rename the space they help run.
  const canManage = hasAnyCapability(concordCapabilities(myMember));
  const aboutInner = (
    <>
      <div className="flex items-center gap-3">
        <GroupAvatar members={rosterPks} picture={community.icon} image={community.iconImage} name={displayName} myPubkey={pubkey} size={44} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug break-words line-clamp-2">{displayName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/70" title="End-to-end encrypted group chat on Nostr — no relay required.">
            <Lock className="w-3 h-3 shrink-0" aria-hidden="true" /> End-to-end encrypted
          </p>
        </div>
      </div>
      {/* The group's own description; live folded metadata wins over the local
          snapshot so members see the owner's edits (their stored record never
          rewrites on remote editions). */}
      {aboutText ? (
        <p className="text-sm leading-relaxed text-foreground/85 whitespace-pre-wrap break-words" data-testid="concord-about-description">{aboutText}</p>
      ) : null}
      {/* What you can do here, side by side. Manage leads for admins: one clear
          door, with what's waiting on it, not a chip beside the description. */}
      {(canManage || canInvite) && (
        <div className={`grid gap-2 ${canManage && canInvite ? "grid-cols-2" : "grid-cols-1"}`}>
          {canManage && (
            <button onClick={() => setAdminOpen(true)} className="flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors" data-testid="button-manage-outpost">
              <Settings2 className="w-3.5 h-3.5" /> Manage
              <ManageCountBadge communityId={community.community_id} />
            </button>
          )}
          {canInvite && (
            <button onClick={() => setInviteOpen(true)} className="flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-lg border border-brand/25 dark:border-brand/20 bg-brand/5 dark:bg-white/[0.03] px-3 text-xs font-medium text-brand hover:bg-brand/10 transition-colors" data-testid="button-about-invite">
              <Link2 className="w-3.5 h-3.5" /> Invite
            </button>
          )}
        </div>
      )}
      {/* The group's id and its relays are for the curious and for support, not
          for reading: behind a disclosure, not in the way. */}
      <details className="group/details text-[11px] text-muted-foreground/60" data-testid="concord-about-details">
        <summary className="cursor-pointer select-none py-2 md:py-0 font-medium text-foreground/70 uppercase tracking-wider text-[10px] list-none flex items-center gap-1">
          <ChevronDown className="w-3 h-3 transition-transform group-open/details:rotate-180" aria-hidden="true" /> Details
        </summary>
        <div className="mt-2 space-y-3">
      <div className="space-y-1.5 text-[11px] text-muted-foreground/60">
        <p className="font-medium text-foreground/70 uppercase tracking-wider text-[10px]">Group id</p>
        <button
          onClick={() => { navigator.clipboard?.writeText(community.community_id); setCopied(true); toast({ title: "Copied" }); setTimeout(() => setCopied(false), 1500); }}
          className="flex items-center gap-1.5 font-mono text-[10px] break-all text-left hover:text-foreground/80"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
          {community.community_id}
        </button>
      </div>
      <div className="space-y-1 text-[11px] text-muted-foreground/60">
        <p className="font-medium text-foreground/70 uppercase tracking-wider text-[10px]">Relays</p>
        {community.relays.map((r) => <p key={r} className="font-mono text-[10px]">{r.replace(/^wss?:\/\//, "")}</p>)}
      </div>
        </div>
      </details>

      {/* No rooms list here: rooms have their own section, beside the chat on
          desktop and at the top of the phone's Group sheet. */}

      {/* Ending the space is authority and lives in Manage. LEAVING is not —
          it is the most member-level action there is, and burying it behind an
          admin drawer would hide it from everyone who actually needs it. */}
      <div className="border-t border-border/30 pt-2">
        <button onClick={() => setDanger("leave")} className="flex min-h-11 md:min-h-8 items-center gap-1.5 text-xs text-destructive/80 hover:text-destructive transition-colors" data-testid="button-leave-outpost">
          <LogOut className="w-3.5 h-3.5" /> {isOwner ? "Step back from group chat" : "Leave group chat"}
        </button>
      </div>
    </>
  );

  // Members + About: the desktop's right side, and below Rooms in the phone's
  // Group sheet. Same sections, same open state.
  const infoSections = (where: "pane" | "sheet") => (
    <>
      <ChatPaneSection
        title="Members" count={rosterPks.length}
        open={layout.sections.members} onToggle={() => update((l) => toggleSection(l, "members"))}
        fill={where === "pane"} testId={`concord-${where === "pane" ? "section" : "sheet"}-members`}
      >
        <div className={where === "pane" ? "px-3.5 pb-4" : "px-1 pb-3"}>
          <ConcordMembers community={community} onCommunityChange={setCommunity} inSection />
        </div>
      </ChatPaneSection>
      <ChatPaneSection
        title="About"
        open={layout.sections.about} onToggle={() => update((l) => toggleSection(l, "about"))}
        fill={where === "pane"} testId={`concord-${where === "pane" ? "section" : "sheet"}-about`}
      >
        <div className={`${where === "pane" ? "px-3.5 pb-4" : "px-1 pb-3"} space-y-3.5`} data-testid="concord-about">
          {aboutInner}
        </div>
      </ChatPaneSection>
    </>
  );

  // Desktop: the group's name above the rooms list opens the same menu as ⋯.
  const groupHeader = (
    <div className="flex h-12 shrink-0 items-center border-b border-border/20 px-1.5">
      <SpaceOverflowMenu
        triggerClassName="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-muted/30 transition-colors"
        triggerIconClassName="w-4 h-4"
        triggerTestId="concord-group-menu"
        triggerLabel={`${displayName} options`}
        triggerContent={
          <>
            <GroupAvatar members={rosterPks} picture={community.icon} image={community.iconImage} name={displayName} myPubkey={pubkey} size={24} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{displayName}</span>
            <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
          </>
        }
        onManage={hasAnyCapability(concordCapabilities(myMember)) ? () => setAdminOpen(true) : undefined}
        onInvite={canInvite ? () => setInviteOpen(true) : undefined}
        onLeave={() => setDanger("leave")}
        petnameSubject={{ kind: "group", id: community.community_id, realName: community.name }}
        isOwner={isOwner}
        muteContext={{ communityId: community.community_id }}
      />
    </div>
  );

  // What each side actually gets in this window (a one-room group has no rooms side).
  const oneRoom = drawerChannels.length <= 1;
  const fit = fitPanes(oneRoom ? { ...layout, collapsed: { ...layout.collapsed, rooms: true } } : layout, panesWidth || Number.POSITIVE_INFINITY);

  return (
    <div className="flex flex-col h-[calc(100svh-4.25rem-7rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-5rem)]" data-testid="page-concord-outpost">
      {/* Identity in the top bar */}
      {slotEl && createPortal(identityStrip, slotEl)}
      <ConcordInviteDialog
        open={inviteOpen} onOpenChange={setInviteOpen} community={community} memberPubkeys={rosterPks} linkJoins={govLinkJoins}
        govState={govState} myMember={myMember} roster={govRoster} compaction={govCompaction} onCommunityChange={setCommunity}
      />
      {/* Same component the chat mounts — the About tab needs its own door, but
          not its own copy of what is behind it. */}
      <ConcordAdminDrawer
        open={adminOpen}
        onOpenChange={setAdminOpen}
        community={community}
        onCommunityChange={setCommunity}
        isOwner={isOwner}
        myMember={myMember}
        govState={govState}
        auditLog={govAuditLog}
        events={govEvents}
        // The LIVE list, not the record. Passing `community.channels` here hid
        // every public channel a co-admin created — the drawer built to manage
        // channels was the one surface that could not see half of them.
        channels={drawerChannels}
        onDissolve={() => setDanger("dissolve")}
        onChannelCreated={() => setTab("chat")}
      />
      {/* About-tab "New channel" — on create, land in Chat where the new rail shows. */}
      <ConcordCreateChannelDialog open={createChannelOpen} onOpenChange={setCreateChannelOpen} community={community} onCommunityChange={setCommunity} onCreated={() => setTab("chat")} />

      {/* Non-scrolling header zone: banner + tabs. On desktop the tabs are gone
          (chat is a persistent 3-pane), so this zone only renders when it has
          real content — the expanded banner or the sidebar-expanded identity
          fallback — never an empty padded strip above the panes. */}
      {(expanded || !slotEl) && (
      <div className="shrink-0 w-full max-w-2xl mx-auto px-3 sm:px-4 pt-4 space-y-4">
      {/* Inline fallback strip: on desktop with the sidebar expanded the top
          bar (and its identity slot) is unmounted, so the same condensed
          identity renders here instead, above the tabs. */}
      {!slotEl && (
        <div className="flex items-center h-12 px-2 rounded-xl border border-border/30" data-testid="container-concord-strip">
          {identityStrip}
        </div>
      )}
      {/* Expanded banner block */}
      {expanded && (
        <div className="rounded-xl border border-border/30 p-4 flex items-start gap-3">
          <GroupAvatar members={rosterPks} picture={community.icon} image={community.iconImage} name={displayName} myPubkey={pubkey} size={56} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">{displayName}</p>
            <p className="text-[11px] text-muted-foreground/50 flex items-center gap-1"><Lock className="w-3 h-3 shrink-0" aria-hidden="true" /> {community.channels.length} channel{community.channels.length !== 1 ? "s" : ""} · encrypted</p>
          </div>
        </div>
      )}

      {/* No tabs on phones: the chat fills the screen, and Rooms, Members and
          About live in the Group sheet (the group's name, or 👥). */}

      </div>
      )}{/* /header zone */}

      {!isMobile ? (
        /* Desktop: [rooms | chat | Members + About]. The rooms side lives in
           ConcordChat (it owns the room list's unread and mention state); both
           sides take their width from the layout, drag to resize, fold away
           past their narrowest, and give way in a narrow window (fitPanes). */
        <div ref={setPanesEl} className="flex flex-1 min-h-0 px-4 pb-4" data-testid="concord-panes">
          <ConcordChat community={community} onCommunityChange={setCommunity}
            initialChannelId={initialChannelId}
            onInvite={canInvite ? () => setInviteOpen(true) : undefined}
            // Two acts, two props. The ternary used to live here because
            // ConcordChat aliased dissolve to onLeave; each receiver already
            // gates itself (chat withholds Leave from an owner, the drawer's
            // danger section is owner-only), so say which is which.
            onLeave={() => setDanger("leave")}
            onDissolve={() => setDanger("dissolve")}
            // 👥: hides the side, or shows it, folding the rooms list if the
            // window has no room for both.
            membersCollapsed={fit.info === 0}
            onToggleMembers={() => update((l) => (fit.info === 0 ? showPane(l, "info", panesWidth || Number.POSITIVE_INFINITY) : togglePane(l, "info")))}
            layout={layout}
            onLayoutChange={update}
            roomsWidth={fit.rooms}
            roomsCollapsed={fit.rooms === 0}
            onToggleRooms={() => update((l) => (fit.rooms === 0 ? showPane(l, "rooms", panesWidth || Number.POSITIVE_INFINITY) : togglePane(l, "rooms")))}
            groupHeader={groupHeader}
            roomsHandle={
              <PaneResizeHandle
                paneSide="left" width={fit.rooms} min={PANE_LIMITS.rooms.min} max={PANE_LIMITS.rooms.max}
                label="Resize the rooms list"
                onResize={(w, drag) => update((l) => resizePane(l, "rooms", w, drag))}
                onReset={() => update((l) => resetPane(l, "rooms"))}
                testId="concord-resize-rooms"
              />
            } />
          {fit.info > 0 && (
            <>
              <div className="flex w-3 shrink-0 justify-center">
                <PaneResizeHandle
                  paneSide="right" width={fit.info} min={PANE_LIMITS.info.min} max={PANE_LIMITS.info.max}
                  label="Resize members and about"
                  onResize={(w, drag) => update((l) => resizePane(l, "info", w, drag))}
                  onReset={() => update((l) => resetPane(l, "info"))}
                  testId="concord-resize-info"
                />
              </div>
              <aside style={{ width: fit.info }} className="glass-card flex flex-col shrink-0 gap-1 rounded-xl border border-brand/15 dark:border-brand/10 overflow-hidden py-1.5" data-testid="concord-members-panel">
                {infoSections("pane")}
              </aside>
            </>
          )}
        </div>
      ) : (
        // Mobile: immersive full-screen, like the DM thread (the bottom nav hides
        // via dm-thread-open). Desktop: inline pane filling the remaining height.
        // The overlay sits inside <main>'s z-0 stacking context, so it can never
        // paint above the fixed z-50 top bar — start the content below it instead
        // (the bar supplies back-to-hub + identity + invite, like the DM thread).
        <div
          className="flex flex-col min-h-0 fixed inset-0 z-[55] bg-background pt-[calc(4.25rem+env(safe-area-inset-top,0px))] md:static md:inset-auto md:z-auto md:bg-transparent md:pt-0 md:flex-1 md:px-4 md:pb-4 md:!h-auto md:!bottom-0"
          style={kb.height ? { height: `${kb.height}px`, top: `${kb.offsetTop}px`, bottom: "auto" } : undefined}
        >
          <ConcordChat community={community} onCommunityChange={setCommunity} viewportNudge={kb.height}
            initialChannelId={initialChannelId}
            onInvite={canInvite ? () => setInviteOpen(true) : undefined}
            onLeave={() => setDanger("leave")}
            onDissolve={() => setDanger("dissolve")}
            layout={layout}
            onLayoutChange={update}
            groupSheetExtras={infoSections("sheet")}
            openGroupSheet={groupSheetNonce} />
        </div>
      )}

      <ConcordDangerDialog
        mode={danger}
        onOpenChange={setDanger}
        community={community}
        pubkey={pubkey}
        otherStaff={govRoster.filter((m) => m.pubkey !== community.owner && isStaff(m)).length}
        onDone={() => setLocation("/messages")}
      />
    </div>
  );
}
