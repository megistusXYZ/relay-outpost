import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { fetchNip11, isNip11Operator, type Nip11Document } from "@/lib/nip11";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Radio, Server, AlertTriangle, RefreshCw, ShieldCheck, ArrowUpRight, ChevronLeft, ChevronRight, Megaphone, Users, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TabId, getTabFromHash } from "./relay-ops/shared";
import { SECTIONS, SETTINGS_SCREENS, sectionOf } from "./relay-ops/console-nav";
import { useFeedbackInbox } from "@/hooks/use-feedback-inbox";
import { OverviewTab } from "./relay-ops/OverviewTab";
import { EventsTab } from "./relay-ops/EventsTab";
import { AccessControlTab } from "./relay-ops/AccessControlTab";
import { FeaturedTab } from "./relay-ops/FeaturedTab";
import { KindGateCard } from "./relay-ops/KindGateCard";
import { AnnounceTab } from "./relay-ops/AnnounceTab";
import { CommunityTab } from "./relay-ops/CommunityTab";
import { FeedbackTab } from "./relay-ops/FeedbackTab";

const SETTINGS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  community: Users,
  announce: Megaphone,
  featured: Sparkles,
};

// Inline fallback for a single tab that throws during render. Scoped so ONE bad
// tab can't take down the whole console — the header + tab switcher stay usable,
// so the operator can switch to a working tab instead of hitting the app-wide
// "Something went wrong loading this page" screen.
function TabErrorFallback({ error }: { error: Error | null }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 min-h-[240px] px-4 py-8 text-center rounded-lg border border-amber-400/30 dark:border-amber-400/20 bg-amber-500/[0.04]"
      data-testid="relay-ops-tab-error"
    >
      <AlertTriangle className="w-8 h-8 text-amber-500/70" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">This section hit an error</p>
        <p className="text-xs text-muted-foreground/60 max-w-md leading-relaxed">
          The rest of Relay Control is fine — switch to another tab above, or reload to try this one again.
        </p>
      </div>
      {error?.message && (
        <code className="max-w-md break-words rounded bg-foreground/5 px-2 py-1 text-[10px] text-muted-foreground/70">
          {error.message}
        </code>
      )}
      <Button variant="ghost" size="sm" onClick={() => window.location.reload()} className="text-xs">
        <RefreshCw className="w-3.5 h-3.5 mr-1" /> Reload
      </Button>
    </div>
  );
}

export default function RelayOpsCenter({ relayUrl: propRelayUrl }: { relayUrl?: string } = {}) {
  const { pubkey, signer } = useNostrAuth();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTabRaw] = useState<TabId>(getTabFromHash);
  const [selectedRelay, setSelectedRelay] = useState<string>(propRelayUrl || "");
  const [nip11, setNip11] = useState<Nip11Document | null>(null);
  const [authStatus, setAuthStatus] = useState<"loading" | "authorized" | "denied" | "no-pubkey">("loading");

  const adminRelays = useMemo(() => {
    return getOutpostRelays().filter(r => r.isAdmin);
  }, []);

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
  const feedbackEnabled = authStatus === "authorized" || (authStatus === "no-pubkey" && isOwnedRelay);
  const inbox = useFeedbackInbox(selectedRelay, signer, pubkey, feedbackEnabled);
  const feedbackUnread = inbox.unreadCount;

  useEffect(() => {
    if (!selectedRelay) return;
    const requestId = ++verifyRequestRef.current;
    setAuthStatus("loading");
    fetchNip11(selectedRelay).then(doc => {
      if (requestId !== verifyRequestRef.current) return;
      setNip11(doc);
      if (!doc) {
        setAuthStatus("denied");
        return;
      }
      if (doc.pubkey) {
        // Operator OR listed moderator counts — matched via the shared,
        // normalized predicate so an npub/uppercase-published key can't lock the
        // real operator out, and this gate can't disagree with the sidebar's
        // auto-promote (which uses the same predicate).
        setAuthStatus(isNip11Operator(doc, pubkey) ? "authorized" : "denied");
      } else {
        setAuthStatus("no-pubkey");
      }
    });
  }, [selectedRelay, pubkey]);

  if (adminRelays.length === 0 && !propRelayUrl) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 px-4">
        <Radio className="w-10 h-10 text-muted-foreground/50" />
        <h2 className="text-lg font-brand tracking-wider uppercase text-muted-foreground/60">No Admin Relays</h2>
        <p className="text-sm text-muted-foreground/60 text-center max-w-md leading-relaxed">
          To use Relay Control, first join a community you operate from the Relays page. Once connected and active, toggle on the admin controls for that relay to enable management tools.
        </p>
        <Button variant="ghost" onClick={() => window.location.href = "/relays"} className="text-xs">
          <Radio className="w-3.5 h-3.5 mr-1" /> Go to Relays
        </Button>
      </div>
    );
  }

  const renderAuthGate = () => {
    if (authStatus === "loading") {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 px-4">
          <RelayOutpostInlineLoader className="w-8 h-8" />
          <p className="text-sm text-muted-foreground/60">Verifying operator access...</p>
        </div>
      );
    }

    // A relay that publishes no operator pubkey can't prove who runs it. We only
    // skip verification for a relay the user already flagged as their own admin
    // relay; for anything else (e.g. a crafted /relay-ops-center/<url> link) this
    // is treated as denied, so the console never renders — and its auto-scan
    // never signs a NIP-42 challenge — for a relay the user doesn't operate.
    if (authStatus === "denied" || (authStatus === "no-pubkey" && !isOwnedRelay)) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 px-4">
          <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400/70" />
          <h2 className="text-lg font-brand tracking-wider uppercase text-red-700 dark:text-red-300/80">Access Denied</h2>
          <p className="text-sm text-muted-foreground/60 text-center max-w-md">
            {authStatus === "no-pubkey"
              ? "This relay doesn't publish an operator pubkey, so operator access can't be verified. Open Relay Control from a relay you operate on the Relays page."
              : nip11 === null
              ? "Unable to reach this relay for verification. Check that the relay is online."
              : "Your key does not match this relay's operator pubkey. Only the relay operator can access Relay Control."}
          </p>
          <Button variant="ghost" onClick={() => window.location.href = "/relays"} className="text-xs">
            <Radio className="w-3.5 h-3.5 mr-1" /> Back to Relays
          </Button>
        </div>
      );
    }

    return null;
  };

  const authGate = renderAuthGate();

  const host = selectedRelay.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  const relayLabel = adminRelays.find(r => r.url === selectedRelay)?.label;
  const relayName = nip11?.name?.trim() || relayLabel || host;
  const settingsScreen = SETTINGS_SCREENS.find(s => s.tab === activeTab);

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 pt-3 pb-6 sm:pt-5 space-y-4">
      {adminRelays.length > 1 && (
        <Select value={selectedRelay} onValueChange={setSelectedRelay}>
          <SelectTrigger className="h-9 w-full sm:w-72 text-xs" aria-label="Which relay to manage">
            <Server className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="Select relay" />
          </SelectTrigger>
          <SelectContent>
            {adminRelays.map(r => (
              <SelectItem key={r.url} value={r.url}>{r.label || r.url.replace(/^wss?:\/\//, "")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* The head: which relay this is, that you run it, and one way back to
          its community. No card — the page is the surface. */}
      <div className="flex items-center gap-3" data-testid="ops-head">
        <Avatar className="w-12 h-12 sm:w-14 sm:h-14 rounded-xl shrink-0 border border-black/[0.06] dark:border-white/[0.08]">
          {nip11?.icon && <AvatarImage src={nip11.icon} alt="" className="object-cover" />}
          <AvatarFallback className="rounded-xl bg-brand/10 text-brand font-semibold text-base">{relayName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl font-semibold leading-tight truncate" data-testid="ops-head-name">{relayName}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground min-w-0">
            <span className="truncate">{host}</span>
            {!authGate && (
              <>
                <span className="text-muted-foreground/50 shrink-0" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 shrink-0 text-brand font-medium" data-testid="ops-operator-mark">
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />Operator
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

      {authStatus === "no-pubkey" && isOwnedRelay && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-400/30 dark:border-amber-400/20">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-800/70 dark:text-amber-400/70 shrink-0" />
          <p className="text-[11px] text-amber-700 dark:text-amber-300/70">
            This relay does not publish an operator pubkey. Verification skipped — some features may not work if you are not the actual operator.
          </p>
        </div>
      )}

      {authGate || (
        <>
          {/* One row of sections. It never wraps and never truncates: on a
              phone it scrolls sideways; on a desktop the six fit with room. */}
          <div
            ref={navRef}
            role="tablist"
            aria-label="Relay Control sections"
            className="flex items-stretch gap-1 overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0 border-b border-black/[0.08] dark:border-white/[0.08]"
            data-testid="ops-nav"
          >
            {SECTIONS.map(s => {
              const isActive = section === s.id;
              const showFeedbackBadge = s.id === "feedback" && feedbackUnread > 0;
              return (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTab(s.id)}
                  className={`relative shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm font-medium whitespace-nowrap transition-colors ${
                    isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`ops-section-${s.id}`}
                >
                  {s.label}
                  {showFeedbackBadge && (
                    <span
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[11px] leading-none font-semibold"
                      data-testid="badge-tab-feedback-unread"
                    >
                      {feedbackUnread > 9 ? "9+" : feedbackUnread}
                    </span>
                  )}
                  {isActive && <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-brand" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          {selectedRelay && (
            <div>
              {settingsScreen && (
                <div className="flex items-center gap-1 mb-3 -ml-2">
                  <button
                    onClick={() => setActiveTab("settings")}
                    className="inline-flex items-center gap-0.5 min-h-[44px] pl-1.5 pr-2.5 rounded-full text-sm text-brand hover:bg-brand/[0.06] transition-colors"
                    data-testid="ops-settings-back"
                  >
                    <ChevronLeft className="w-5 h-5" aria-hidden="true" />Settings
                  </button>
                  <span className="text-muted-foreground/40" aria-hidden="true">/</span>
                  <h2 className="text-sm font-semibold ml-1.5">{settingsScreen.label}</h2>
                </div>
              )}
              {/* Per-tab boundary: a crash in one tab shows an inline fallback
                  instead of replacing the whole console. Keyed by activeTab so
                  switching tabs remounts a fresh boundary (React error boundaries
                  don't auto-reset), letting the operator recover by tab-switching. */}
              <ErrorBoundary key={activeTab} fallbackRender={(error) => <TabErrorFallback error={error} />}>
                {activeTab === "overview" && <OverviewTab relayUrl={selectedRelay} inbox={inbox} onOpenFeedback={() => setActiveTab("feedback")} />}
                {(activeTab === "events" || activeTab === "live") && <EventsTab relayUrl={selectedRelay} initialLive={activeTab === "live"} />}
                {activeTab === "access" && <><AccessControlTab relayUrl={selectedRelay} nip11={nip11} /><KindGateCard relayUrl={selectedRelay} nip11={nip11} /></>}
                {activeTab === "feedback" && <FeedbackTab relayUrl={selectedRelay} inbox={inbox} />}
                {activeTab === "settings" && (
                  <div className="rounded-xl border border-black/[0.08] dark:border-white/[0.08] divide-y divide-black/[0.06] dark:divide-white/[0.06] overflow-hidden" data-testid="ops-settings-rows">
                    {SETTINGS_SCREENS.map(row => {
                      const Icon = SETTINGS_ICONS[row.tab];
                      return (
                        <button
                          key={row.tab}
                          onClick={() => setActiveTab(row.tab)}
                          className="w-full flex items-center gap-3 min-h-[60px] px-4 py-2.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors"
                          data-testid={`ops-settings-row-${row.tab}`}
                        >
                          <span className="w-8 h-8 rounded-lg bg-brand/10 text-brand inline-flex items-center justify-center shrink-0"><Icon className="w-4 h-4" aria-hidden="true" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium leading-snug">{row.label}</span>
                            <span className="block text-[12px] text-muted-foreground leading-snug truncate">{row.hint}</span>
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" aria-hidden="true" />
                        </button>
                      );
                    })}
                  </div>
                )}
                {activeTab === "announce" && <AnnounceTab relayUrl={selectedRelay} nip11={nip11} />}
                {activeTab === "featured" && <FeaturedTab relayUrl={selectedRelay} nip11={nip11} />}
                {activeTab === "community" && <CommunityTab relayUrl={selectedRelay} nip11={nip11} />}
              </ErrorBoundary>
            </div>
          )}
        </>
      )}
    </div>
  );
}
