import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { fetchNip11, supportsNip, type Nip11Document } from "@/lib/nip11";
import { probeRelayManagement } from "@/lib/nip86";
import { loadTeamRumors } from "@/lib/relay-team";
import { foldTeam } from "@/lib/team-records";
import { decideOwnership } from "@/lib/relay-ownership";
import { useOperatedRelays, setLastUsedRelay } from "@/lib/operated-relays";
import { RelaysWelcome } from "@/components/relays/RelaysWelcome";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AlertTriangle, ShieldCheck, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Megaphone, Plus, Terminal, Users, UsersRound, ScrollText, Inbox, Cable, IdCard, BarChart3, MessagesSquare, Code2, Award } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTechnicalDetails, setTechnicalDetails } from "@/lib/technical-details";
import { MagicStarIcon } from "@/components/icons/MagicStarIcon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ErrorScreen } from "@/components/ErrorScreen";
import { TabId, getTabFromHash } from "./relay-ops/shared";
import { SetupChecklist, setSetupFlag, useSetupChecklist } from "./relay-ops/SetupChecklist";
import { SECTIONS, COMMUNITY_SCREENS, ADVANCED_SCREENS, sectionOf, listOf, consoleTitle, type ConsoleScreen } from "./relay-ops/console-nav";
import { useFeedbackInbox } from "@/hooks/use-feedback-inbox";
import { OverviewTab } from "./relay-ops/OverviewTab";
import { ContentTab } from "./relay-ops/ContentTab";
import { PeopleTab } from "./relay-ops/PeopleTab";
import { AccessControlTab } from "./relay-ops/AccessControlTab";
import { FeaturedTab } from "./relay-ops/FeaturedTab";
import { KindGateCard } from "./relay-ops/KindGateCard";
import { MemberInboxSettings } from "./relay-ops/MemberInboxSettings";
import { ConnectionPanel } from "./relay-ops/ConnectionPanel";
import { AnnounceTab } from "./relay-ops/AnnounceTab";
import { CommunityTab } from "./relay-ops/CommunityTab";
import { InboxTab } from "./relay-ops/InboxTab";
import { TeamScreen, LogScreen } from "./relay-ops/TeamScreens";
import { CommunityBadges } from "./relay-ops/CommunityBadges";
import { useRelayTeam } from "@/hooks/use-relay-team";
import { useRelaysNeedYou } from "@/contexts/NeedsYouContext";

const SCREEN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  community: Users,
  access: ShieldCheck,
  // The same star as the community page's Featured tab (owner, 2026-10-04: not a sparkle).
  featured: MagicStarIcon,
  contact: Inbox,
  team: UsersRound,
  log: ScrollText,
  connection: Cable,
  card: IdCard,
  scans: BarChart3,
  groups: MessagesSquare,
  badges: Award,
};

/**
 * "Show technical details" (owner, 2026-10-04): off by default, remembered
 * on this device. On, every screen also shows kind numbers, keys and method
 * names next to the plain words.
 */
function TechnicalDetailsRow() {
  const on = useTechnicalDetails();
  return (
    <label className="w-full flex items-center gap-3 min-h-[60px] px-4 py-2.5 cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" data-testid="ops-technical-details">
      <span className="w-6 inline-flex items-center justify-center shrink-0 text-muted-foreground"><Code2 className="w-5 h-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">Show technical details</span>
        <span className="block text-[12px] text-muted-foreground leading-snug">Kind numbers, keys and method names, on every screen</span>
      </span>
      <Switch checked={on} onCheckedChange={setTechnicalDetails} aria-label="Show technical details" data-testid="ops-technical-details-switch" />
    </label>
  );
}

/** A list of screens (Community, Advanced): one row each, hairlines between. */
function ScreenList({ screens, onOpen, extra, testId }: { screens: ReadonlyArray<ConsoleScreen>; onOpen: (tab: TabId) => void; extra?: React.ReactNode; testId: string }) {
  return (
    <div className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06] overflow-hidden" data-testid={testId}>
      {screens.map(row => {
        const Icon = SCREEN_ICONS[row.tab];
        return (
          <button
            key={row.tab}
            onClick={() => onOpen(row.tab)}
            className="w-full flex items-center gap-3 min-h-[60px] px-4 py-2.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
            data-testid={`ops-settings-row-${row.tab}`}
          >
            <span className="w-6 inline-flex items-center justify-center shrink-0 text-muted-foreground">{Icon && <Icon className="w-5 h-5" aria-hidden="true" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug">{row.label}</span>
              <span className="block text-[12px] text-muted-foreground leading-snug">{row.hint}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" aria-hidden="true" />
          </button>
        );
      })}
      {extra}
    </div>
  );
}

// Inline fallback for a single tab that throws during render. Scoped so ONE bad
// tab can't take down the whole console — the header + tab switcher stay usable,
// so the operator can switch to a working tab instead of hitting the app-wide
// "This page didn't load" screen.
function TabErrorFallback({ error }: { error: Error | null }) {
  return (
    <ErrorScreen
      layout="section"
      kind="broken"
      title="This section didn't load"
      body="The rest of Relay Control is fine. Switch to another tab above, or reload to try this one again."
      primary={{ label: "Reload", onClick: () => window.location.reload() }}
      detail={error?.message}
      testId="relay-ops-tab-error"
    />
  );
}

export default function RelayOpsCenter({ relayUrl: propRelayUrl }: { relayUrl?: string } = {}) {
  const { pubkey, signer } = useNostrAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTabRaw] = useState<TabId>(getTabFromHash);
  const [selectedRelay, setSelectedRelay] = useState<string>(propRelayUrl || "");
  const [nip11, setNip11] = useState<Nip11Document | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "authorized" | "team" | "denied" | "no-pubkey">("loading");
  // Owner, moderator, or on the team (view and notes) — said in the header (owner, 2026-10-04).
  const [role, setRole] = useState<"Owner" | "Moderator" | "Team" | null>(null);

  // The relays you run, live — connecting another updates the switcher.
  const adminRelays = useOperatedRelays();

  // Arriving at another relay's console (the switcher, a link) moves the page there.
  useEffect(() => {
    if (propRelayUrl) setSelectedRelay(propRelayUrl);
  }, [propRelayUrl]);

  // A relay the user actually operates (flagged admin in their own outpost list).
  // Used to gate the "relay publishes no operator pubkey" fallback: we only skip
  // operator verification for a relay the user already claimed as theirs — never
  // for an arbitrary relay reached via a crafted /relay-ops-center/<url> link.
  const isOwnedRelay = useMemo(() => {
    const norm = (u: string) => u.replace(/\/+$/, "").toLowerCase();
    return adminRelays.some(r => norm(r.url) === norm(selectedRelay));
  }, [adminRelays, selectedRelay]);

  useEffect(() => {
    if (adminRelays.length > 0 && !selectedRelay) {
      setSelectedRelay(adminRelays[0].url);
    }
  }, [adminRelays, selectedRelay]);

  // People's "See their posts" opens Content already searching for them.
  const [contentSeed, setContentSeed] = useState("");
  // Who can post's counts open People on that list.
  const [peopleFilter, setPeopleFilter] = useState<"allowed" | "banned" | undefined>(undefined);
  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabRaw(tab);
    try { window.history.replaceState(window.history.state, "", `#${tab}`); } catch {}
  }, []);

  // The row scrolls on a phone; the active section is always brought into view
  // (a link straight to #feedback, say, must not land on a row showing Overview).
  const navRef = useRef<HTMLDivElement | null>(null);
  const section = sectionOf(activeTab);
  useEffect(() => {
    // The row only exists once access is verified — so this runs again then.
    const el = navRef.current?.querySelector<HTMLElement>(`[data-testid="ops-section-${section}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section, authStatus]);

  useEffect(() => {
    const onHash = () => setActiveTabRaw(getTabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const verifyRequestRef = useRef(0);

  // One shared inbox for BOTH the tab badge (count) and the Feedback tab (list),
  // so they can't diverge. This ingests the SAME streams the tab shows — #p-only
  // public issues (no repo needed) AND private NIP-17 tickets — which the old
  // #a-only badge missed entirely. Enabled whenever the console is usable (the
  // same states that render the tab + badge: authorized, or a relay that
  // publishes no operator pubkey where we fall back to the signed-in admin).
  const feedbackEnabled = authStatus === "authorized" || authStatus === "team" || (authStatus === "no-pubkey" && isOwnedRelay);
  const inbox = useFeedbackInbox(selectedRelay, signer, pubkey, feedbackEnabled);
  const feedbackUnread = inbox.unreadCount;
  // The relay's team: shared notes and log, encrypted to the team, on the relay.
  const team = useRelayTeam(selectedRelay, nip11, feedbackEnabled);
  const setup = useSetupChecklist(selectedRelay, nip11, team, pubkey ?? null);
  // Everything waiting on this relay: feedback plus reports and join requests.
  const relaysNeedYou = useRelaysNeedYou();
  const inboxCount = feedbackUnread + relaysNeedYou.forRelay(selectedRelay);

  useEffect(() => {
    if (!selectedRelay) return;
    const requestId = ++verifyRequestRef.current;
    setAuthStatus("loading");
    // The same rule as connecting a relay (lib/relay-ownership.ts): yours if
    // its public info names you, or it accepts your signed management request.
    // That request is only sent to relays already in your list — a crafted
    // /relay-ops-center/<url> link gets the public-info check alone.
    Promise.all([
      fetchNip11(selectedRelay).catch(() => null),
      isOwnedRelay && pubkey ? probeRelayManagement(selectedRelay) : Promise.resolve(null),
    ]).then(([doc, probe]) => {
      if (requestId !== verifyRequestRef.current) return;
      setNip11(doc);
      if (!pubkey) { setAuthStatus("denied"); return; }
      const ownership = decideOwnership({
        pubkey,
        nip11: doc,
        caps: probe?.caps ?? { listed: null },
        managementReached: probe ? probe.reached : !!doc,
      });
      if (ownership.kind === "runs-it") {
        setRole(doc?.pubkey && doc.pubkey.toLowerCase() === pubkey.toLowerCase() ? "Owner" : "Moderator");
        setAuthStatus("authorized");
        return;
      }
      // Not the owner or a moderator — but maybe on the team: the owner's own
      // roster (encrypted to the team, kept on the relay) lists you. Then you
      // may look and write notes; the relay still decides what you can change.
      const owner = doc?.pubkey && /^[0-9a-f]{64}$/i.test(doc.pubkey) ? doc.pubkey.toLowerCase() : null;
      if (owner && (ownership.kind === "not-yours") && (signer as { nip44?: unknown } | null)?.nip44) {
        loadTeamRumors(selectedRelay, signer, pubkey.toLowerCase()).then((r) => {
          if (requestId !== verifyRequestRef.current) return;
          const onTeam = foldTeam(r.rumors, { owner, me: pubkey.toLowerCase(), relayUrl: selectedRelay }).members.includes(pubkey.toLowerCase());
          setRole(onTeam ? "Team" : null);
          setAuthStatus(onTeam ? "team" : "denied");
        }).catch(() => { if (requestId === verifyRequestRef.current) setAuthStatus("denied"); });
        return;
      }
      setRole(null);
      setAuthStatus(ownership.kind === "cannot-tell" ? "no-pubkey" : "denied");
    });
  }, [selectedRelay, pubkey, isOwnedRelay, signer]);

  // Relays opens on the relay you managed last — but only one you may manage,
  // so the Relays tab can never land you on a door that won't open.
  useEffect(() => {
    if (selectedRelay && (authStatus === "authorized" || (authStatus === "no-pubkey" && isOwnedRelay))) {
      setLastUsedRelay(selectedRelay);
    }
  }, [selectedRelay, authStatus, isOwnedRelay]);

  if (adminRelays.length === 0 && !propRelayUrl) {
    return <RelaysWelcome />;
  }

  const renderAuthGate = () => {
    if (authStatus === "loading") {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 px-4">
          <RelayOutpostInlineLoader className="w-8 h-8" />
          <p className="text-sm text-muted-foreground/60">Checking who runs it…</p>
        </div>
      );
    }

    // A relay that publishes no operator pubkey can't prove who runs it. We only
    // skip verification for a relay the user already flagged as their own admin
    // relay; for anything else (e.g. a crafted /relay-ops-center/<url> link) this
    // is treated as denied, so the console never renders — and its auto-scan
    // never signs a NIP-42 challenge — for a relay the user doesn't operate.
    if (authStatus === "denied" || (authStatus === "no-pubkey" && !isOwnedRelay)) {
      const unreachable = authStatus !== "no-pubkey" && nip11 === null;
      return (
        <ErrorScreen
          layout="section"
          kind={unreachable ? "unreachable" : "denied"}
          title={
            authStatus === "no-pubkey"
              ? "This relay doesn't say who runs it"
              : unreachable
              ? "We couldn't check who runs this relay"
              : "You don't run this relay"
          }
          body={
            authStatus === "no-pubkey"
              ? "It doesn't name an owner and doesn't accept management requests, so we can't confirm it's yours."
              : unreachable
              ? "We couldn't reach it to check. Make sure it's online, then try again."
              : "It doesn't list your key as its owner or a moderator. Only the people who run it can manage it here."
          }
          primary={{ label: "Your relays", onClick: () => navigate("/my-relays") }}
          secondary={{ label: "Check this relay again", onClick: () => navigate(`/my-relays/connect?url=${encodeURIComponent(selectedRelay)}`) }}
          testId="relay-ops-access-denied"
        />
      );
    }

    return null;
  };

  const authGate = renderAuthGate();

  const host = selectedRelay.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  const relayLabel = adminRelays.find(r => r.url === selectedRelay)?.label;
  const relayName = nip11?.name?.trim() || relayLabel || host;
  // A screen inside Community or Advanced: its back row names the list.
  const backTo = listOf(activeTab);

  return (
    <div className="max-w-5xl lg:max-w-[1400px] mx-auto px-3 sm:px-4 pt-3 pb-6 sm:pt-5 space-y-4">
      {/* The head: which relay this is, that you run it, and one way back to
          its community. No card — the page is the surface. */}
      <div className="flex items-center gap-3" data-testid="ops-head">
        <Avatar className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl shrink-0 border border-black/[0.06] dark:border-white/[0.08]">
          {nip11?.icon && <AvatarImage src={nip11.icon} alt="" className="object-cover" />}
          <AvatarFallback className="rounded-xl bg-brand/10 text-brand font-semibold text-base">{relayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {/* The name is the switcher: your other relays, and connecting another. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="group inline-flex max-w-full items-center gap-1 rounded-md -mx-1 px-1 min-h-[32px] text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`${relayName} — switch relay`}
                data-testid="ops-relay-switcher"
              >
                <h1 className="text-lg sm:text-xl font-semibold leading-tight truncate" data-testid="ops-head-name">{relayName}</h1>
                <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]" data-testid="ops-relay-switcher-menu">
              {adminRelays.map(r => {
                const current = r.url.replace(/\/+$/, "").toLowerCase() === selectedRelay.replace(/\/+$/, "").toLowerCase();
                const label = r.label || r.url.replace(/^wss?:\/\//, "");
                return (
                  <DropdownMenuItem
                    key={r.url}
                    onSelect={() => navigate(`/relay-ops-center/${encodeURIComponent(r.url)}#overview`, { replace: true })}
                    className="min-h-[44px] gap-2.5"
                    data-testid="ops-relay-switcher-item"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{label}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{r.url.replace(/^wss?:\/\//, "")}</span>
                    </span>
                    {relaysNeedYou.forRelay(r.url) > 0 && (
                      <span className="shrink-0 text-[13px] font-medium tabular-nums text-brand" aria-label={`${relaysNeedYou.forRelay(r.url)} waiting`} data-testid="ops-relay-switcher-count">
                        {relaysNeedYou.forRelay(r.url)}
                      </span>
                    )}
                    {current && <Check className="w-4 h-4 text-brand shrink-0" aria-label="Current relay" />}
                  </DropdownMenuItem>
                );
              })}
              {adminRelays.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => navigate("/my-relays/add")} className="min-h-[44px] gap-2.5" data-testid="ops-relay-switcher-connect">
                <Plus className="w-4 h-4 text-brand" aria-hidden="true" />
                <span className="text-sm">Add a relay</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => navigate(`/my-relays/console?relay=${encodeURIComponent(selectedRelay)}`)} className="min-h-[44px] gap-2.5" data-testid="ops-relay-switcher-console">
                <Terminal className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm">Console for this relay</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground min-w-0">
            <span className="truncate">{host}</span>
            {!authGate && (
              <>
                <span className="text-muted-foreground/50 shrink-0" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 shrink-0 text-brand font-medium" data-testid="ops-operator-mark">
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />{role ?? "Owner"}
                </span>
              </>
            )}
          </p>
        </div>
        {/* A round arrow on phones (the name and host need the width), the
            full pill where there is room. */}
        <Button
          variant="outline"
          className="h-11 w-11 p-0 sm:h-9 sm:w-auto sm:px-3.5 rounded-full shrink-0 text-[13px]"
          onClick={() => navigate(`/outposts/${encodeURIComponent(selectedRelay)}`)}
          aria-label="Open community"
          title="Open community"
          data-testid="button-open-community"
        >
          <span className="sr-only sm:not-sr-only">Open community</span>
          <ArrowUpRight className="w-4 h-4 sm:w-3.5 sm:h-3.5 sm:ml-1 sm:opacity-70" aria-hidden="true" />
        </Button>
      </div>

      {authStatus === "team" && (
        <p className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-[13px] text-muted-foreground" data-testid="ops-team-access-note">
          You're on the team: you can see everything here and add notes about members. Removing posts and banning need a moderator — the owner can make you one at your host.
        </p>
      )}

      {authStatus === "no-pubkey" && isOwnedRelay && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-400/30 dark:border-amber-400/20">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-800/70 dark:text-amber-400/70 shrink-0" />
          <p className="text-[11px] text-amber-700 dark:text-amber-300/70">
            This relay does not publish an operator pubkey. Verification skipped — some features may not work if you are not the actual operator.
          </p>
        </div>
      )}

      {authGate || (
        <div className="md:grid md:grid-cols-[176px_minmax(0,1fr)] md:gap-6 md:items-start space-y-4 md:space-y-0">
          {/* The sections. A phone: one row that scrolls sideways, never
              wraps. A desktop: a column on the left, so the section's own
              list and detail get the width (three panes, like Mail). */}
          <div
            ref={navRef}
            role="tablist"
            aria-label="Sections"
            className="flex items-stretch gap-1 overflow-x-auto scrollbar-hide scroll-px-3 -mx-3 px-3 sm:mx-0 sm:px-0 border-b border-black/[0.08] dark:border-white/[0.08] md:flex-col md:overflow-visible md:border-b-0 md:sticky md:top-4"
            data-testid="ops-nav"
          >
            {SECTIONS.map(s => {
              const isActive = section === s.id;
              const showFeedbackBadge = s.id === "feedback" && inboxCount > 0;
              return (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => { setContentSeed(""); setPeopleFilter(undefined); setActiveTab(s.id); }}
                  className={`relative shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium whitespace-nowrap transition-colors md:justify-between md:rounded-lg md:w-full ${
                    isActive ? "text-foreground md:bg-brand/[0.09]" : "text-muted-foreground hover:text-foreground md:hover:bg-black/[0.03] dark:md:hover:bg-white/[0.04]"
                  }`}
                  data-testid={`ops-section-${s.id}`}
                >
                  {s.label}
                  {showFeedbackBadge && (
                    <span
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[11px] leading-none font-semibold"
                      data-testid="badge-tab-feedback-unread"
                    >
                      {inboxCount > 9 ? "9+" : inboxCount}
                    </span>
                  )}
                  {isActive && <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-brand md:hidden" aria-hidden="true" />}
                </button>
              );
            })}
            {/* Hidden but not finished: one quiet way back (owner, 2026-10-04). */}
            {setup.isOwner && setup.hidden && !setup.complete && (
              <button
                type="button"
                onClick={() => { setSetupFlag("hidden", selectedRelay, false); setActiveTab("overview"); }}
                className="shrink-0 inline-flex items-center min-h-[44px] px-3 text-[13px] text-brand whitespace-nowrap md:mt-2"
                data-testid="ops-setup-resume"
              >
                Finish setting up · {setup.done} of {setup.items.length}
              </button>
            )}
          </div>

          {selectedRelay && (
            <div>
              {backTo && (
                <div className="flex items-center gap-1 mb-3 -ml-2">
                  <button
                    onClick={() => setActiveTab(backTo.tab)}
                    className="inline-flex items-center gap-0.5 min-h-[44px] pl-1.5 pr-2.5 rounded-full text-sm text-brand hover:bg-brand/[0.06] transition-colors"
                    data-testid="ops-settings-back"
                  >
                    <ChevronLeft className="w-5 h-5" aria-hidden="true" />{backTo.label}
                  </button>
                  <span className="text-muted-foreground/40" aria-hidden="true">/</span>
                  <h2 className="text-sm font-semibold ml-1.5">{consoleTitle(activeTab)}</h2>
                </div>
              )}
              {/* Per-tab boundary: a crash in one tab shows an inline fallback
                  instead of replacing the whole console. Keyed by activeTab so
                  switching tabs remounts a fresh boundary (React error boundaries
                  don't auto-reset), letting the operator recover by tab-switching. */}
              <ErrorBoundary key={activeTab} fallbackRender={(error) => <TabErrorFallback error={error} />}>
                {activeTab === "overview" && <div className="mb-4"><SetupChecklist relayUrl={selectedRelay} state={setup} onGo={setActiveTab} /></div>}
                {activeTab === "overview" && <OverviewTab relayUrl={selectedRelay} inbox={inbox} onOpenFeedback={() => setActiveTab("feedback")} onOpenConnection={() => setActiveTab("connection")} />}
                {(activeTab === "events" || activeTab === "live") && <ContentTab relayUrl={selectedRelay} nip11={nip11} initialLive={activeTab === "live"} initialQuery={contentSeed} />}
                {activeTab === "people" && <PeopleTab relayUrl={selectedRelay} nip11={nip11} team={team} initialFilter={peopleFilter} onSeePosts={(npub) => { setContentSeed(npub); setActiveTab("events"); }} />}
                {activeTab === "team" && <TeamScreen relayUrl={selectedRelay} nip11={nip11} team={team} />}
                {activeTab === "badges" && <CommunityBadges relayUrl={selectedRelay} ownerPubkey={nip11?.pubkey?.toLowerCase()} isOwner={role === "Owner"} />}
                {activeTab === "log" && <LogScreen relayUrl={selectedRelay} nip11={nip11} team={team} />}
                {activeTab === "access" && (
                  // Who can post: the rules (who may, who's approved or banned, trust),
                  // what can be posted, who writes articles, pinned discussions (owner, 2026-10-04).
                  <div className="space-y-6" data-testid="ops-who-can-post">
                    <AccessControlTab relayUrl={selectedRelay} nip11={nip11} part="rules" onOpenPeople={(f) => { setPeopleFilter(f); setActiveTab("people"); }} />
                    <KindGateCard relayUrl={selectedRelay} nip11={nip11} />
                    <CommunityTab relayUrl={selectedRelay} nip11={nip11} part="posting" />
                  </div>
                )}
                {activeTab === "feedback" && <InboxTab relayUrl={selectedRelay} nip11={nip11} inbox={inbox} onSeePost={(id) => { setContentSeed(id); setActiveTab("events"); }} onOpenMemberInbox={() => setActiveTab("contact")} />}
                {activeTab === "settings" && <ScreenList screens={COMMUNITY_SCREENS.filter((r) => r.tab !== "groups" || (!!nip11 && supportsNip(nip11, 29)))} onOpen={setActiveTab} testId="ops-settings-rows" />}
                {activeTab === "groups" && <CommunityTab relayUrl={selectedRelay} nip11={nip11} part="groups" />}
                {activeTab === "advanced" && (
                  <ScreenList
                    screens={ADVANCED_SCREENS}
                    onOpen={setActiveTab}
                    testId="ops-advanced-rows"
                    extra={<>
                      {/* For developers: the same relay, on the wire. */}
                      <button
                        onClick={() => navigate(`/my-relays/console?relay=${encodeURIComponent(selectedRelay)}`)}
                        className="w-full flex items-center gap-3 min-h-[60px] px-4 py-2.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                        data-testid="ops-open-console"
                      >
                        <span className="w-6 inline-flex items-center justify-center shrink-0 text-muted-foreground"><Terminal className="w-5 h-5" aria-hidden="true" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium leading-snug">Console</span>
                          <span className="block text-[12px] text-muted-foreground leading-snug">Ask this relay anything, look inside posts, publish by hand</span>
                        </span>
                        <ArrowUpRight className="w-4 h-4 text-muted-foreground/50 shrink-0" aria-hidden="true" />
                      </button>
                      <TechnicalDetailsRow />
                    </>}
                  />
                )}
                {activeTab === "featured" && (
                  // One screen for what greets people: pinned on the community page,
                  // announcements you post, and featured feeds (owner, 2026-10-04).
                  <div className="space-y-8" data-testid="ops-featured-announcements">
                    <CommunityTab relayUrl={selectedRelay} nip11={nip11} part="featured" />
                    <AnnounceTab relayUrl={selectedRelay} nip11={nip11} part="announcements" />
                    <FeaturedTab relayUrl={selectedRelay} nip11={nip11} />
                  </div>
                )}
                {activeTab === "card" && (
                  <div className="space-y-6" data-testid="ops-public-card">
                    <AnnounceTab relayUrl={selectedRelay} nip11={nip11} part="card" />
                    <OverviewTab relayUrl={selectedRelay} part="info" />
                  </div>
                )}
                {activeTab === "scans" && <OverviewTab relayUrl={selectedRelay} part="scans" />}
                {activeTab === "community" && <CommunityTab relayUrl={selectedRelay} nip11={nip11} part="details" />}
                {activeTab === "contact" && <MemberInboxSettings relayUrl={selectedRelay} relayName={relayName} />}
                {activeTab === "connection" && <ConnectionPanel relayUrl={selectedRelay} relayName={relayName} />}
              </ErrorBoundary>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
