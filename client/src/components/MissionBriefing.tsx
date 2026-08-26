import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowRight, X, ChevronRight, Sparkles } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { isOnboardingComplete } from "@/lib/local-account";
import { useSidebar } from "@/components/ui/sidebar";

export interface BriefingStep {
  testId: string | null;
  title: string;
  body: string;
}

const SEEN_KEY_PREFIX = "relay-outpost-coachmarks-seen:";
const LEGACY_HOME_SEEN_PREFIX = "relay-outpost-coachmarks-seen:";
const FORCE_KEY_PREFIX = "relay-outpost-mission-briefing-force:";
const SNOOZE_KEY_PREFIX = "relay-outpost-mission-briefing-snooze:";
const RESTART_EVENT = "mission-briefing:restart";

// Canonical orientation tour order. Mirrors the Help page's replay picker so
// the two never drift — the last slide of each tour hands off to the next
// UNSEEN entry here. (WtfIsThis derives its picker from this + the registry.)
export const BRIEFING_ORDER = ["home", "outposts", "articles", "live", "wallet", "shield-matrix"];

function seenKey(pageId: string, pubkey: string): string {
  return `${SEEN_KEY_PREFIX}${pageId}:${pubkey}`;
}

function isSeen(pageId: string, pubkey: string): boolean {
  try {
    if (localStorage.getItem(seenKey(pageId, pubkey)) === "1") return true;
    if (pageId === "home" && localStorage.getItem(`${LEGACY_HOME_SEEN_PREFIX}${pubkey}`) === "1") return true;
  } catch {}
  return false;
}

function markSeen(pageId: string, pubkey: string): void {
  try { localStorage.setItem(seenKey(pageId, pubkey), "1"); } catch {}
}

export function restartMissionBriefing(pageId: string = "home"): void {
  try {
    sessionStorage.setItem(`${FORCE_KEY_PREFIX}${pageId}`, "1");
    sessionStorage.removeItem(`${SNOOZE_KEY_PREFIX}${pageId}`);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(RESTART_EVENT, { detail: { pageId } }));
  }
}

export interface NextBriefing {
  pageId: string;
  label: string;
  path: string;
  steps: BriefingStep[];
}

/**
 * The next tour to hand off to from the last slide of `pageId`'s briefing:
 * the first entry in BRIEFING_ORDER that isn't the current page and hasn't
 * been seen yet. Returns null when every other tour is already complete.
 * (Reads the registry lazily so it can live above the registry definition.)
 */
export function computeNextBriefing(pageId: string, pubkey: string | null | undefined): NextBriefing | null {
  if (!pubkey) return null;
  for (const id of BRIEFING_ORDER) {
    if (id === pageId) continue;
    if (isSeen(id, pubkey)) continue;
    const entry = MISSION_BRIEFING_REGISTRY[id];
    if (!entry) continue;
    return { pageId: id, label: entry.label, path: entry.path, steps: entry.steps };
  }
  return null;
}

/**
 * How many orientation tours are complete — counting the CURRENT page as done,
 * since reaching the last slide marks it seen. Powers the "N of M complete"
 * mission-log line on the hand-off block.
 */
export function countCompletedBriefings(pageId: string, pubkey: string | null | undefined): number {
  if (!pubkey) return 0;
  return BRIEFING_ORDER.filter((id) => id === pageId || isSeen(id, pubkey)).length;
}

function anchorPresent(testId: string): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return !(r.width === 0 && r.height === 0);
}

function renderBody(body: string): React.ReactNode {
  // Split on **bold** segments. Even indices are plain, odd indices are bold.
  const parts = body.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-foreground">{part}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

interface MissionBriefingProps {
  pageId: string;
  steps: BriefingStep[];
  /** Delay (ms) before auto-starting on first visit. Defaults to 600ms. */
  startDelayMs?: number;
}

export function MissionBriefing({ pageId, steps: stepsInput, startDelayMs = 600 }: MissionBriefingProps) {
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const nextBtnRef = useRef<HTMLButtonElement | null>(null);

  // Filter out steps whose anchor isn't present in the DOM. Keeps the list
  // honest on screens where some UI is hidden (e.g. Wallet not yet connected).
  const steps = useMemo<BriefingStep[]>(() => {
    return stepsInput.filter((s) => s.testId === null || anchorPresent(s.testId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepsInput, active, isMobile]);

  // Briefings NEVER auto-start for new users (too distracting) — they run only
  // when explicitly requested: the Help & Guides page calls
  // restartMissionBriefing(pageId), which sets the force flag / fires the
  // restart event handled below.
  useEffect(() => {
    if (!pubkey) return;
    if (active) return;
    let force = false;
    try { force = sessionStorage.getItem(`${FORCE_KEY_PREFIX}${pageId}`) === "1"; } catch {}
    if (!force) return;

    const start = window.setTimeout(() => {
      const available = stepsInput.filter((s) => s.testId === null || anchorPresent(s.testId));
      if (available.length === 0) return;
      if (isMobile && openMobile) setOpenMobile(false);
      setStepIndex(0);
      setActive(true);
      try {
        sessionStorage.removeItem(`${FORCE_KEY_PREFIX}${pageId}`);
        sessionStorage.removeItem(`${SNOOZE_KEY_PREFIX}${pageId}`);
      } catch {}
    }, startDelayMs);
    return () => window.clearTimeout(start);
  }, [pubkey, active, isMobile, openMobile, setOpenMobile, pageId, stepsInput, startDelayMs]);

  // Listen for explicit restart events targeting this page.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pageId?: string } | undefined;
      const targetPage = detail?.pageId ?? "home";
      if (targetPage !== pageId) return;
      if (!pubkey) return;
      if (isMobile && openMobile) setOpenMobile(false);
      setStepIndex(0);
      setActive(true);
      try { sessionStorage.removeItem(`${FORCE_KEY_PREFIX}${pageId}`); } catch {}
    };
    window.addEventListener(RESTART_EVENT, handler as EventListener);
    return () => window.removeEventListener(RESTART_EVENT, handler as EventListener);
  }, [pubkey, isMobile, openMobile, setOpenMobile, pageId]);

  // If the visible step list shrinks while the briefing is active (e.g. an
  // anchor disappears because the user disconnected their wallet mid-tour),
  // clamp the index so the briefing doesn't silently vanish.
  useEffect(() => {
    if (!active) return;
    if (steps.length === 0) {
      setActive(false);
      return;
    }
    if (stepIndex >= steps.length) setStepIndex(steps.length - 1);
  }, [active, steps.length, stepIndex]);

  const currentStep = steps[stepIndex];

  const dismiss = useCallback(() => {
    if (pubkey) markSeen(pageId, pubkey);
    setActive(false);
  }, [pubkey, pageId]);

  const skip = useCallback(() => { dismiss(); }, [dismiss]);

  const showLater = useCallback(() => {
    try { sessionStorage.setItem(`${SNOOZE_KEY_PREFIX}${pageId}`, "1"); } catch {}
    setActive(false);
  }, [pageId]);

  const next = useCallback(() => {
    if (stepIndex >= steps.length - 1) {
      dismiss();
    } else {
      setStepIndex(stepIndex + 1);
    }
  }, [stepIndex, steps.length, dismiss]);

  // Hand off to the next tour: mark this one complete, close this panel, then
  // launch the next tour (the FORCE flag survives navigation so the target
  // page's briefing auto-starts on mount — home included, since HomeCoachmarks
  // listens for the same generic restart).
  const beginNextTour = useCallback((nextPageId: string, nextPath: string) => {
    if (pubkey) markSeen(pageId, pubkey);
    setActive(false);
    restartMissionBriefing(nextPageId);
    setLocation(nextPath);
  }, [pubkey, pageId, setLocation]);

  // Keyboard: Esc skips, Enter advances, Tab is trapped within the panel.
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
        return;
      }
      if (e.key === "Enter") {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
        e.preventDefault();
        // On the last slide the primary CTA is the hand-off / finish button, not
        // a plain "next" — route Enter through the focused button so its action wins.
        if (stepIndex >= steps.length - 1) {
          nextBtnRef.current?.click();
        } else {
          next();
        }
        return;
      }
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;
        const inside = activeEl ? panel.contains(activeEl) : false;
        if (!inside) {
          e.preventDefault();
          first.focus();
          return;
        }
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, stepIndex, steps.length, skip, next]);

  // Focus next button when step changes (keyboard-friendly).
  useEffect(() => {
    if (!active) return;
    if (isMobile && openMobile) return;
    const id = window.setTimeout(() => nextBtnRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [active, stepIndex, isMobile, openMobile]);

  if (!active || !pubkey || steps.length === 0 || !currentStep) return null;

  const isLast = stepIndex >= steps.length - 1;
  const paused = isMobile && openMobile;
  // Last-slide hand-off: the next unseen tour (null = orientation complete) and
  // how far through the whole orientation arc the operator is.
  const nextBriefing = isLast ? computeNextBriefing(pageId, pubkey) : null;
  const completedTours = isLast ? countCompletedBriefings(pageId, pubkey) : 0;

  if (paused) {
    return (
      <button
        type="button"
        onClick={() => setOpenMobile(false)}
        className="fixed bottom-4 right-4 z-[80] inline-flex items-center gap-2 rounded-full bg-card/95 backdrop-blur border border-brand/40 px-3.5 py-2 shadow-lg text-xs font-brand uppercase tracking-[0.15em] text-foreground"
        data-testid="button-mission-briefing-resume"
        aria-label="Resume mission briefing"
      >
        <Sparkles className="w-3.5 h-3.5 text-brand" />
        Briefing paused — tap to resume
        <ChevronRight className="w-3.5 h-3.5 opacity-60" />
      </button>
    );
  }

  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        left: 12,
        right: 12,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
        zIndex: 81,
      }
    : {
        position: "fixed",
        right: 24,
        bottom: 96,
        width: 360,
        zIndex: 81,
      };

  return (
    <div
      ref={panelRef}
      style={panelStyle}
      className="rounded-xl border border-brand/30 bg-card/95 backdrop-blur-md shadow-2xl p-4 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-300"
      role="dialog"
      aria-label="Mission briefing"
      aria-live="polite"
      data-testid="mission-briefing-panel"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-brand uppercase tracking-[0.2em] text-brand" data-testid="text-mission-briefing-counter">
            Briefing {stepIndex + 1} of {steps.length}
          </p>
          <p className="text-sm font-semibold leading-tight mt-1" data-testid="text-mission-briefing-title">{currentStep.title}</p>
        </div>
        <button
          type="button"
          onClick={skip}
          aria-label="Skip mission briefing"
          className="text-muted-foreground hover:text-foreground -mr-1 -mt-1 p-1 rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
          data-testid="button-mission-briefing-skip"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p
        key={stepIndex}
        className="text-xs text-muted-foreground leading-relaxed animate-in fade-in duration-200"
        data-testid="text-mission-briefing-body"
      >
        {renderBody(currentStep.body)}
      </p>

      {!isLast ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1" aria-hidden="true">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`block w-1.5 h-1.5 rounded-full transition-all ${i === stepIndex ? "bg-brand w-3" : "bg-foreground/20"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={showLater}
              className="text-[10px] font-brand uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              data-testid="button-mission-briefing-later"
            >
              Show me later
            </button>
            <button
              ref={nextBtnRef}
              type="button"
              onClick={next}
              className="text-xs font-brand uppercase tracking-[0.15em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white hover:bg-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              data-testid="button-mission-briefing-next"
            >
              Next
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : nextBriefing ? (
        <div className="pt-1 space-y-3" data-testid="mission-briefing-handoff">
          <p
            className="text-[10px] font-brand uppercase tracking-[0.15em] text-muted-foreground/70"
            data-testid="text-mission-briefing-progress"
          >
            Orientation · {completedTours} of {BRIEFING_ORDER.length} complete
          </p>
          <div className="h-px bg-gradient-to-r from-brand/25 via-brand/10 to-transparent" aria-hidden="true" />
          <div>
            <p className="text-[10px] font-brand uppercase tracking-[0.2em] text-brand">
              Next mission
            </p>
            <p className="text-sm font-semibold leading-tight mt-1" data-testid="text-mission-briefing-nextup">
              {nextBriefing.label}
              {nextBriefing.steps.length > 0 && (
                <span className="text-muted-foreground font-normal"> · {nextBriefing.steps.length} stops</span>
              )}
            </p>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={dismiss}
              className="text-[10px] font-brand uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md focus:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              data-testid="button-mission-briefing-finish"
            >
              Finish
            </button>
            <button
              ref={nextBtnRef}
              type="button"
              onClick={() => beginNextTour(nextBriefing.pageId, nextBriefing.path)}
              className="text-xs font-brand uppercase tracking-[0.15em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white hover:bg-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              data-testid="button-mission-briefing-next-tour"
            >
              Begin
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="pt-1 space-y-3" data-testid="mission-briefing-complete">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-brand shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[10px] font-brand uppercase tracking-[0.2em] text-brand">
                Orientation complete
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1" data-testid="text-mission-briefing-complete">
                You've toured every corner of your outpost.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end">
            <button
              ref={nextBtnRef}
              type="button"
              onClick={dismiss}
              className="text-xs font-brand uppercase tracking-[0.15em] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white hover:bg-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              data-testid="button-mission-briefing-finish"
            >
              Finish
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-page briefing registries
// ---------------------------------------------------------------------------
// Body copy uses **double-asterisk** to mark UI labels — they render bold so
// users can spot the control by name without us drawing geometric overlays
// (which go stale the moment the sidebar opens or the layout shifts).

export const OUTPOSTS_BRIEFING: BriefingStep[] = [
  {
    testId: null,
    title: "Welcome to Communities",
    body: "Communities are independent public spaces — each with its own crew, vibe, and rules. Pick the ones you trust; you're never locked in.",
  },
  {
    testId: null,
    title: "Join and reorder",
    body: "Join a community to add it to your home base. Joined communities pin themselves to the **top of this page** — use the **↑ / ↓** arrows on each card to put your favorites first.",
  },
  {
    testId: "section-network-plumbing",
    title: "Network plumbing",
    body: "Scroll down to **Network plumbing** to tune your relay setup — add new relays, check health, and manage your block list.",
  },
  {
    testId: null,
    title: "Inside a community",
    body: "Tap any community card to land in its posts, chat, articles, and member list — its full social surface, on its own relay.",
  },
];

export const WALLET_BRIEFING: BriefingStep[] = [
  {
    testId: null,
    title: "Your Lightning wallet",
    body: "Lightning is a layer on top of Bitcoin built for instant, near-zero-fee payments — fast enough to zap a post for a few sats.",
  },
  {
    testId: "card-wallet-connect",
    title: "Connect a wallet",
    body: "Find the **Connect Wallet** card and paste a connection link from any compatible Lightning wallet (Alby, Coinos, Zeus, LNbits…). Your funds and keys stay with your wallet — Relay Outpost only passes along payment requests that your wallet approves.",
  },
  {
    testId: "card-wallet-balance",
    title: "Your balance, live",
    body: "Once connected, your **balance and recent activity** stream in at the top of this page. Tap the eye icon to hide it.",
  },
  {
    testId: "tab-wallet-send",
    title: "Send sats",
    body: "Open the **Send** tab to pay a Lightning address, paste an invoice, or scan a QR. Zaps you send to posts also show up in History.",
  },
  {
    testId: "tab-wallet-receive",
    title: "Receive sats",
    body: "Open the **Receive** tab to generate an invoice or share your Lightning address. Zaps people send to your posts land here automatically.",
  },
];

export const SHIELD_MATRIX_BRIEFING: BriefingStep[] = [
  {
    testId: null,
    title: "Welcome to Trust & Safety",
    body: "This is your trust dashboard. Web of Trust ranks accounts based on the people you and your friends already trust.",
  },
  {
    testId: "wot-toggle-row",
    title: "Web of Trust",
    body: "Flip the **Web of Trust** switch near the top to score every account by how connected they are to people you follow.",
  },
  {
    testId: "wot-diagnostics-card",
    title: "Network diagnostics",
    body: "The **Network diagnostics** card shows your sign-in status and trust scoring at a glance — calculate or refresh your scores in-app, and retry anything that's stuck.",
  },
  {
    testId: null,
    title: "Calibrate & moderate",
    body: "Below: tune your trust thresholds, manage muted people, blocked keywords, and the reports you've filed.",
  },
];

export const LIVE_STREAMS_BRIEFING: BriefingStep[] = [
  {
    testId: null,
    title: "Welcome to Live",
    body: "Live video from creators across the network shows up here — happening now and scheduled for later. Tune in, join the chat, and zap broadcasters in real time.",
  },
  {
    testId: "container-live-results",
    title: "Browse what's on",
    body: "Each card is a stream. Tap one to start watching and open the chat side panel — zaps land with the broadcaster instantly.",
  },
];

export const ARTICLES_BRIEFING: BriefingStep[] = [
  {
    testId: null,
    title: "Long-form articles",
    body: "Articles are full-length posts signed with your own key. They live on the relays you choose and travel with you across any reader.",
  },
  {
    testId: "articles-tab-switcher",
    title: "Switch your view",
    body: "Use the **Trending / Latest / Following** switch near the top to change your view. Trending shows what's gaining traction; Latest is the firehose; Following filters to people you follow.",
  },
  {
    testId: "button-topics-dropdown",
    title: "Filter by topic",
    body: "Open the **Topics** dropdown to narrow the feed by curated and trending hashtags — or use the **search bar** to find authors and specific articles.",
  },
  {
    testId: "button-write-article",
    title: "Write your own",
    body: "Tap the **Write** button (top-right) to publish a new article. It goes out to the relays you've chosen — and it stays yours, wherever you take it.",
  },
];

export const MISSION_BRIEFING_REGISTRY: Record<string, { label: string; path: string; steps: BriefingStep[] }> = {
  home: { label: "Home feed", path: "/", steps: [] }, // home registers its own steps via HomeCoachmarks
  // Paths point at where each section actually renders now (consolidated into
  // /account and /search tabs). The old standalone paths redirected to these
  // embedded views, where the briefing was gated off — so the replay played
  // nothing. These land directly on the right tab.
  outposts: { label: "Communities", path: "/outposts", steps: OUTPOSTS_BRIEFING },
  wallet: { label: "Wallet", path: "/account?tab=wallet", steps: WALLET_BRIEFING },
  "shield-matrix": { label: "Trust & safety", path: "/account?tab=shield", steps: SHIELD_MATRIX_BRIEFING },
  live: { label: "Live", path: "/search?tab=live", steps: LIVE_STREAMS_BRIEFING },
  articles: { label: "Articles", path: "/search?tab=media&type=articles", steps: ARTICLES_BRIEFING },
};

export default MissionBriefing;
