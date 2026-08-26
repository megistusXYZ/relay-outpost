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
import { canInviteToCommunity, rosterPubkeys } from "@/lib/concord/concord-invite-gate";
import { ConcordMembers } from "@/components/concord/ConcordMembers";
import { ConcordInviteDialog } from "@/components/concord/ConcordInviteDialog";
import { ConcordCreateChannelDialog } from "@/components/concord/ConcordCreateChannelDialog";
import { useConcordGovernance, COMMUNITY_UPDATED_EVENT } from "@/components/concord/useConcordGovernance";
import { ConcordAdminDrawer } from "@/components/concord/ConcordAdminDrawer";
import { concordCapabilities, hasAnyCapability } from "@/lib/space-admin";
import { liveChannels } from "@/lib/concord/concord-live-channels";
import { hasPermission, PERM } from "@/lib/concord/concord-events";
import { Pencil, Trash2, LogOut } from "lucide-react";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { useHeaderIdentitySlot } from "@/hooks/use-header-identity-slot";
import { ConcordDangerDialog } from "@/components/concord/ConcordDangerDialog";

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
  // Desktop 3-pane: the Members panel is persistent-but-collapsible (👥 in the
  // chat header). About is a collapsible section at the top of that panel.
  const [membersCollapsed, setMembersCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("ro_chat_members_collapsed") === "1"; } catch { return false; }
  });
  const toggleMembersPanel = () => setMembersCollapsed((v) => {
    const next = !v;
    try { localStorage.setItem("ro_chat_members_collapsed", next ? "1" : "0"); } catch {}
    return next;
  });
  const [aboutSectionOpen, setAboutSectionOpen] = useState(false);
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
  const { state: govState, roster: govRoster, myMember, events: govEvents, auditLog: govAuditLog } = useConcordGovernance(community);
  const canInvite = canInviteToCommunity({ community, pubkey, myMember, govMetadata: govState.metadata });
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
      <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
        <GroupAvatar members={rosterPks} picture={community.icon} name={displayName} myPubkey={pubkey} size={28} className="shrink-0" />
        <span className="text-sm font-bold truncate">{displayName}</span>
        <span className="shrink-0 inline-flex" title="End-to-end encrypted" aria-label="End-to-end encrypted"><Lock className="w-3 h-3 text-muted-foreground/50" /></span>
      </button>
      {canInvite && (
        <button onClick={() => setInviteOpen(true)} className="flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground/60 hover:text-brand hover:bg-brand/10 shrink-0" title="Invite" data-testid="button-concord-invite">
          <Link2 className="w-4 h-4" />
        </button>
      )}
      <button onClick={() => setExpanded((v) => !v)} className="flex items-center justify-center w-8 h-8 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/40 shrink-0">
        <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
    </div>
  );

  // About content, shared by the mobile "About" tab and the desktop Members
  // panel's collapsible About section (so the two can't drift).
  const aboutInner = (
    <>
      <div className="flex items-start gap-3">
        <GroupAvatar members={rosterPks} picture={community.icon} name={displayName} myPubkey={pubkey} size={48} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{displayName}</p>
          {/* The group's own description leads; live folded metadata wins over
              the local snapshot so members see the owner's edits (their
              stored record never rewrites on remote editions). */}
          {aboutText ? (
            <p className="text-sm text-foreground/80 mt-1 whitespace-pre-wrap break-words" data-testid="concord-about-description">{aboutText}</p>
          ) : null}
          <p className="text-[11px] text-muted-foreground/50 mt-2 flex items-start gap-1.5"><Lock className="w-3 h-3 mt-0.5 text-muted-foreground/50 shrink-0" aria-hidden="true" /> <span>End-to-end encrypted group chat on Nostr — no relay required.</span></p>
        </div>
        {/* One door replaces four scattered ones. Note this WIDENS reach on
            purpose: the old pencil was owner-only, while the drawer follows the
            capability model, so an admin holding MANAGE_METADATA can finally
            rename the space they help run. */}
        {hasAnyCapability(concordCapabilities(myMember)) && (
          <button onClick={() => setAdminOpen(true)} className="shrink-0 flex items-center gap-1 px-3 py-2 md:px-2.5 md:py-1.5 rounded-lg border border-border/40 text-xs font-medium hover:bg-muted/30 transition-colors" data-testid="button-manage-outpost">
            <Settings2 className="w-3 h-3" /> Manage
          </button>
        )}
      </div>
      <div className="space-y-1.5 text-[11px] text-muted-foreground/60">
        <p className="font-medium text-foreground/70 uppercase tracking-wider text-[10px]">Community id</p>
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

      <div className="space-y-1.5" data-testid="concord-about-channels">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium text-foreground/70 uppercase tracking-wider text-[10px]">Rooms</p>

        </div>
        <div className="space-y-1">
          {community.channels.map((ch) => (
            <p key={ch.id} className="flex items-center gap-1.5 text-xs text-foreground/75 min-w-0">
              {ch.isPrivate ? <Lock className="w-3 h-3 shrink-0 text-muted-foreground/50" /> : <Hash className="w-3 h-3 shrink-0 text-muted-foreground/50" />}
              <span className="truncate">{ch.name}</span>
            </p>
          ))}
        </div>
      </div>

      {/* Ending the space is authority and lives in Manage now. LEAVING is not —
          it is the most member-level action there is, and burying it behind an
          admin drawer would hide it from everyone who actually needs it. */}
      {!isOwner && (
        <div className="pt-3 border-t border-destructive/15">
          <p className="font-medium text-destructive/70 uppercase tracking-wider text-[10px] mb-2">Danger zone</p>
          <button onClick={() => setDanger("leave")} className="flex items-center gap-1.5 py-2 md:py-0 text-xs text-destructive hover:underline" data-testid="button-leave-outpost">
            <LogOut className="w-3.5 h-3.5" /> Leave group chat
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col h-[calc(100svh-4.25rem-7rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] md:h-[calc(100dvh-5rem)]" data-testid="page-concord-outpost">
      {/* Identity in the top bar */}
      {slotEl && createPortal(identityStrip, slotEl)}
      <ConcordInviteDialog open={inviteOpen} onOpenChange={setInviteOpen} community={community} memberPubkeys={rosterPks} />
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
      {(isMobile || expanded || !slotEl) && (
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
          <GroupAvatar members={rosterPks} picture={community.icon} name={displayName} myPubkey={pubkey} size={56} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">{displayName}</p>
            <p className="text-[11px] text-muted-foreground/50 flex items-center gap-1"><Lock className="w-3 h-3 shrink-0" aria-hidden="true" /> {community.channels.length} channel{community.channels.length !== 1 ? "s" : ""} · encrypted</p>
          </div>
        </div>
      )}

      {/* Tab pills — mobile only. Desktop replaces them with the 3-pane layout
          (channels | messages | persistent Members panel). */}
      {isMobile && (
      <PageTabs
        ariaLabel="Group chat sections"
        active={tab}
        onChange={(key) => setTab(key as typeof tab)}
        tabs={([["chat", "Chat", MessageSquare], ["members", "Members", Users], ["about", "About", Info]] as const).map(([key, label, Icon]) => ({
          key,
          label,
          icon: Icon,
          testId: `concord-tab-${key}`,
        }))}
      />
      )}

      </div>
      )}{/* /header zone */}

      {!isMobile ? (
        /* Desktop 3-pane: [channels | messages | Members panel]. Channels come
           from ConcordChat (multi-channel only). The Members panel is persistent
           but collapsible (👥 in the chat header → toggleMembersPanel), with
           About as a collapsible section pinned to its top. */
        <div className="flex flex-1 min-h-0 px-4 pb-4 gap-3">
          <ConcordChat community={community} onCommunityChange={setCommunity}
            initialChannelId={initialChannelId}
            onInvite={canInvite ? () => setInviteOpen(true) : undefined}
            // Two acts, two props. The ternary used to live here because
            // ConcordChat aliased dissolve to onLeave; each receiver already
            // gates itself (chat withholds Leave from an owner, the drawer's
            // danger section is owner-only), so say which is which.
            onLeave={() => setDanger("leave")}
            onDissolve={() => setDanger("dissolve")}
            membersCollapsed={membersCollapsed}
            onToggleMembers={toggleMembersPanel} />
          {!membersCollapsed && (
            <aside className="glass-card flex flex-col w-[280px] shrink-0 rounded-xl border border-brand/15 dark:border-brand/10 overflow-hidden" data-testid="concord-members-panel">
              {/* About — collapsible section pinned to the top */}
              <div className="shrink-0 border-b border-brand/10">
                <button
                  onClick={() => setAboutSectionOpen((v) => !v)}
                  className="flex w-full items-center gap-2 px-3.5 py-3 text-left hover:bg-muted/20 transition-colors"
                  aria-expanded={aboutSectionOpen}
                  data-testid="concord-panel-about-toggle"
                >
                  <Info className="w-4 h-4 text-brand/70 shrink-0" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/70 flex-1">About</span>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground/50 transition-transform ${aboutSectionOpen ? "rotate-180" : ""}`} />
                </button>
                {aboutSectionOpen && (
                  <div className="px-3.5 pb-4 pt-0.5 space-y-4" data-testid="concord-about">
                    {canInvite && (
                      <button onClick={() => setInviteOpen(true)} className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-brand/20 dark:border-brand/15 bg-brand/5 dark:bg-white/[0.03] text-xs font-medium text-brand hover:bg-brand/10 transition-colors" data-testid="button-about-invite">
                        <Link2 className="w-3.5 h-3.5" /> Invite people
                      </button>
                    )}
                    {aboutInner}
                  </div>
                )}
              </div>
              {/* Members — primary content of the panel */}
              <div className="flex items-center gap-2 px-3.5 py-3 shrink-0">
                <Users className="w-4 h-4 text-brand/70 shrink-0" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/70">Members</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-4">
                <ConcordMembers community={community} onCommunityChange={setCommunity} />
              </div>
            </aside>
          )}
        </div>
      ) : tab === "chat" ? (
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
            onOverview={() => setTab("members")}
            onInvite={canInvite ? () => setInviteOpen(true) : undefined}
            onLeave={() => setDanger("leave")}
            onDissolve={() => setDanger("dissolve")} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-2xl mx-auto px-3 sm:px-4 pt-3 pb-24">
        {tab === "members" ? (
          <ConcordMembers community={community} onCommunityChange={setCommunity} />
        ) : (
        <div className="rounded-xl border border-border/30 p-4 space-y-4" data-testid="concord-about">
          {aboutInner}
        </div>
        )}
        </div>
      )}

      <ConcordDangerDialog
        mode={danger}
        onOpenChange={setDanger}
        community={community}
        pubkey={pubkey}
        onDone={() => setLocation("/messages")}
      />
    </div>
  );
}
