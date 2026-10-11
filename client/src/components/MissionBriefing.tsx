import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowRight, X, ChevronRight, Sparkles } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { isOnboardingComplete } from "@/lib/local-account";
import { useSidebar } from "@/components/ui/sidebar";
import { TOURS, TOUR_ORDER, playableSteps, fillStepCount, stepCounter, nextTour, toursDone, type TourStep } from "@/lib/tours";

/**
 * The quick tour (owner, 2026-10-10: "Mission briefing" before). The words
 * and the steps live in lib/tours.ts; this is the panel that plays them,
 * replayed from Help & Guides. It never starts on its own.
 */
export type BriefingStep = TourStep;

const SEEN_KEY_PREFIX = "relay-outpost-coachmarks-seen:";
const LEGACY_HOME_SEEN_PREFIX = "relay-outpost-coachmarks-seen:";
const FORCE_KEY_PREFIX = "relay-outpost-mission-briefing-force:";
const RESTART_EVENT = "mission-briefing:restart";

/** The tours in the order a new account meets them; the Help page's picker reads this. */
export const BRIEFING_ORDER: readonly string[] = TOUR_ORDER;

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
  const id = nextTour(pageId, (t) => isSeen(t, pubkey));
  if (!id) return null;
  const entry = TOURS[id];
  return { pageId: id, label: entry.label, path: entry.path, steps: entry.steps };
}

/**
 * How many orientation tours are complete — counting the CURRENT page as done,
 * since reaching the last slide marks it seen. Powers the "N of M complete"
 * mission-log line on the hand-off block.
 */
export function countCompletedBriefings(pageId: string, pubkey: string | null | undefined): number {
  if (!pubkey) return 0;
  return toursDone(pageId, (t) => isSeen(t, pubkey));
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
    return playableSteps(stepsInput, anchorPresent);
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
      const available = playableSteps(stepsInput, anchorPresent);
      if (available.length === 0) return;
      if (isMobile && openMobile) setOpenMobile(false);
      setStepIndex(0);
      setActive(true);
      try { sessionStorage.removeItem(`${FORCE_KEY_PREFIX}${pageId}`); } catch {}
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

  // "Show me later": the panel closes and the tour is NOT marked seen, so the
  // Help page offers it again. (A snooze key used to be written here and read
  // nowhere.)
  const showLater = useCallback(() => { setActive(false); }, []);

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
        aria-label="Resume the tour"
      >
        <Sparkles className="w-3.5 h-3.5 text-brand" />
        Tour paused — tap to resume
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
      aria-label="Quick tour"
      aria-live="polite"
      data-testid="mission-briefing-panel"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-brand uppercase tracking-[0.2em] text-brand" data-testid="text-mission-briefing-counter">
            {stepCounter(stepIndex, steps.length)}
          </p>
          <p className="text-sm font-semibold leading-tight mt-1" data-testid="text-mission-briefing-title">{currentStep.title}</p>
        </div>
        <button
          type="button"
          onClick={skip}
          aria-label="Skip the tour"
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
        {renderBody(fillStepCount(currentStep.body, steps.length))}
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
            {completedTours} of {BRIEFING_ORDER.length} tours done
          </p>
          <div className="h-px bg-gradient-to-r from-brand/25 via-brand/10 to-transparent" aria-hidden="true" />
          <div>
            <p className="text-[10px] font-brand uppercase tracking-[0.2em] text-brand">
              Next tour
            </p>
            <p className="text-sm font-semibold leading-tight mt-1" data-testid="text-mission-briefing-nextup">
              {nextBriefing.label}
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
                That's the tour
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-1" data-testid="text-mission-briefing-complete">
                You've seen every part of the app. Replay any of it from Help & Guides.
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
// The tours themselves live in lib/tours.ts. These names are the pages' way in.
// ---------------------------------------------------------------------------
export const OUTPOSTS_BRIEFING: BriefingStep[] = TOURS.communities.steps;
export const WALLET_BRIEFING: BriefingStep[] = TOURS.wallet.steps;
export const SHIELD_MATRIX_BRIEFING: BriefingStep[] = TOURS.trust.steps;
export const LIVE_STREAMS_BRIEFING: BriefingStep[] = TOURS.live.steps;
export const ARTICLES_BRIEFING: BriefingStep[] = TOURS.articles.steps;
export const CHATS_BRIEFING: BriefingStep[] = TOURS.chats.steps;
export const ACCOUNT_BRIEFING: BriefingStep[] = TOURS.account.steps;

export const MISSION_BRIEFING_REGISTRY: Record<string, { label: string; path: string; steps: BriefingStep[] }> = TOURS;

export default MissionBriefing;
