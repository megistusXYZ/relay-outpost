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
import { Radio, Server, AlertTriangle, ExternalLink, Settings, RefreshCw } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TabId, TABS, getTabFromHash } from "./relay-ops/shared";
import { useFeedbackInbox } from "@/hooks/use-feedback-inbox";
import { OverviewTab } from "./relay-ops/OverviewTab";
import { LiveFeedTab } from "./relay-ops/LiveFeedTab";
import { EventsTab } from "./relay-ops/EventsTab";
import { AccessControlTab } from "./relay-ops/AccessControlTab";
import { FeaturedTab } from "./relay-ops/FeaturedTab";
import { KindGateCard } from "./relay-ops/KindGateCard";
import { AnnounceTab } from "./relay-ops/AnnounceTab";
import { CommunityTab } from "./relay-ops/CommunityTab";
import { FeedbackTab } from "./relay-ops/FeedbackTab";

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

  useEffect(() => {
    if (adminRelays.length > 0 && !selectedRelay) {
      setSelectedRelay(adminRelays[0].url);
    }
  }, [adminRelays, selectedRelay]);

  const setActiveTab = useCallback((tab: TabId) => {
    setActiveTabRaw(tab);
    try { window.history.replaceState(window.history.state, "", `#${tab}`); } catch {}
  }, []);

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
  const feedbackEnabled = authStatus === "authorized" || authStatus === "no-pubkey";
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
          To use Relay Control, first join an outpost you operate from the Relays page. Once connected and active, toggle on the admin controls for that relay to enable management tools.
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

    if (authStatus === "denied") {
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 px-4">
          <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400/70" />
          <h2 className="text-lg font-brand tracking-wider uppercase text-red-700 dark:text-red-300/80">Access Denied</h2>
          <p className="text-sm text-muted-foreground/60 text-center max-w-md">
            {nip11 === null
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

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Radio className="w-5 h-5 text-brand dark:text-brand/80" />
          <h1 className="text-base sm:text-lg font-brand tracking-wider uppercase">Relay Control</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {adminRelays.length > 1 ? (
            <Select value={selectedRelay} onValueChange={setSelectedRelay}>
              <SelectTrigger className="w-48 sm:w-64 h-8 text-xs">
                <Server className="w-3 h-3 mr-1" />
                <SelectValue placeholder="Select relay" />
              </SelectTrigger>
              <SelectContent>
                {adminRelays.map(r => (
                  <SelectItem key={r.url} value={r.url}>
                    <span className="font-mono text-xs">{r.label || r.url.replace("wss://", "")}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <button
              onClick={() => navigate(`/outposts/${encodeURIComponent(selectedRelay)}`)}
              className="flex items-center gap-1.5 sm:gap-2 hover:opacity-80 transition-opacity cursor-pointer group min-w-0 max-w-[55vw] sm:max-w-none"
              title={`Open outpost · ${selectedRelay.replace("wss://", "")}`}
            >
              <Server className="w-3 h-3 text-muted-foreground/70 shrink-0" />
              <span className="text-xs font-mono text-brand dark:text-brand/70 underline underline-offset-2 decoration-brand/30 truncate">{selectedRelay.replace("wss://", "")}</span>
              <ExternalLink className="w-3 h-3 text-muted-foreground/40 group-hover:text-brand transition-colors shrink-0" />
            </button>
          )}
          {selectedRelay && !authGate && (
            <button
              onClick={() => setActiveTab("community")}
              className={`flex items-center gap-1.5 sm:gap-2 px-2 py-1 rounded-md transition-all cursor-pointer group border shrink-0 ${
                activeTab === "community"
                  ? "bg-brand/10 border-brand/40 text-brand"
                  : "border-transparent hover:border-brand/20 hover:bg-brand/[0.06] text-muted-foreground/70 hover:text-brand"
              }`}
              title="Relay settings"
              data-testid="button-outpost-settings"
            >
              <Settings className={`w-3 h-3 transition-colors ${activeTab === "community" ? "text-brand" : "text-muted-foreground/70 group-hover:text-brand-strong"}`} />
              <span className="text-xs font-mono underline underline-offset-2 decoration-brand/30">
                <span className="sm:hidden">Settings</span>
                <span className="hidden sm:inline">Relay Settings</span>
              </span>
            </button>
          )}
        </div>
      </div>

      {authStatus === "no-pubkey" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-400/30 dark:border-amber-400/20">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-800/70 dark:text-amber-400/70 shrink-0" />
          <p className="text-[11px] text-amber-700 dark:text-amber-300/70">
            This relay does not publish an operator pubkey. Verification skipped — some features may not work if you are not the actual operator.
          </p>
        </div>
      )}

      {authGate || (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 pb-1 border-b border-black/[0.08] dark:border-white/[0.06]">
            {TABS.filter(tab => tab.id !== "community").map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const showFeedbackBadge = tab.id === "feedback" && feedbackUnread > 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex items-center justify-center sm:justify-start gap-1.5 px-2 sm:px-3 py-2.5 sm:py-2 text-[11px] sm:text-xs font-medium rounded-lg sm:rounded-t-md sm:rounded-b-none transition-all whitespace-nowrap min-h-[44px] ${
                    isActive
                      ? "text-brand bg-brand/10 border border-brand/30 sm:border-b-2 sm:border-t-0 sm:border-l-0 sm:border-r-0 sm:border-brand"
                      : "text-muted-foreground/70 hover:text-muted-foreground/80 hover:bg-black/[0.04] dark:hover:bg-white/[0.03] border border-transparent sm:border-0"
                  }`}
                  data-testid={`tab-relay-ops-${tab.id}`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                  {showFeedbackBadge && (
                    <span
                      className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-brand text-white text-[10px] leading-none font-semibold"
                      data-testid="badge-tab-feedback-unread"
                    >
                      {feedbackUnread > 9 ? "9+" : feedbackUnread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedRelay && (
            <div className="mt-2">
              {/* Per-tab boundary: a crash in one tab shows an inline fallback
                  instead of replacing the whole console. Keyed by activeTab so
                  switching tabs remounts a fresh boundary (React error boundaries
                  don't auto-reset), letting the operator recover by tab-switching. */}
              <ErrorBoundary key={activeTab} fallbackRender={(error) => <TabErrorFallback error={error} />}>
                {activeTab === "overview" && <OverviewTab relayUrl={selectedRelay} inbox={inbox} onOpenFeedback={() => setActiveTab("feedback")} />}
                {activeTab === "live" && <LiveFeedTab relayUrl={selectedRelay} />}
                {activeTab === "events" && <EventsTab relayUrl={selectedRelay} />}
                {activeTab === "access" && <><AccessControlTab relayUrl={selectedRelay} nip11={nip11} /><KindGateCard relayUrl={selectedRelay} nip11={nip11} /></>}
                {activeTab === "announce" && <AnnounceTab relayUrl={selectedRelay} nip11={nip11} />}
                {activeTab === "featured" && <FeaturedTab relayUrl={selectedRelay} nip11={nip11} />}
                {activeTab === "community" && <CommunityTab relayUrl={selectedRelay} nip11={nip11} />}
                {activeTab === "feedback" && <FeedbackTab relayUrl={selectedRelay} inbox={inbox} />}
              </ErrorBoundary>
            </div>
          )}
        </>
      )}
    </div>
  );
}
