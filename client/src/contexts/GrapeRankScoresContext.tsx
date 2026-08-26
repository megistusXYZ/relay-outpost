import { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { fetchConnectionScores, fetchGrapeRankScore, fetchSelfGrapeRank, getSignalTier, clearGrapeRankCache, loadLsScores, saveLsScores, clearLsScores, triggerGrapeRankCalculation, type SignalTier, type UserConnection, authenticateWithBrainstorm, onBrainstormAuthEvent, getBrainstormAuthStatus, getConnectionFetchStatus, clearBrainstormAuth } from "@/lib/graperank";
import { fetchBrainstormWotBatch, onBrainstormBatchEvent, getBrainstormBatchStatus, clearBrainstormBatchCooldown } from "@/lib/brainstorm-search";
import { planBulkResults, decideScoreRequest } from "@/lib/wot-hydration";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { fetchContactLists, resetContactListCache } from "@/lib/nostr";
import { recordScoreSnapshot } from "@/lib/wot-history";
import { toast } from "@/hooks/use-toast";

const LAZY_BATCH_DELAY = 50;
// Max concurrent per-observer /api/graperank/user/{target} fetches. These are
// per-target authenticated graph queries against the Brainstorm server — keep
// the ceiling low; the refinement queue drains in the background while the
// provisional global scores already render.
const LAZY_MAX_CONCURRENT = 6;
const LAZY_FLUSH_INTERVAL = 150;
const LAZY_MAX_PENDING = 500;
const LAZY_MAX_RETRIES = 2;
const BULK_DEBOUNCE = 80;
const NEGATIVE_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
const LS_SAVE_INTERVAL = 10000;

const WOT_ENABLED_KEY = "relay-outpost-wot-enabled";
const WOT_CHOICE_SET_KEY = "relay-outpost-wot-choice-set";
const RECALC_STATE_KEY = "relay-outpost-recalc-state";
const RECALC_POLL_INTERVAL = 60_000;
const RECALC_MAX_DURATION = 25 * 60_000;

function getWotEnabled(): boolean {
  try {
    const val = localStorage.getItem(WOT_ENABLED_KEY);
    if (val === null) return false;
    return val === "true";
  } catch {
    return false;
  }
}

function hasExplicitWotChoice(): boolean {
  try {
    return localStorage.getItem(WOT_CHOICE_SET_KEY) === "true";
  } catch {
    return false;
  }
}

function markWotChoiceSet(): void {
  try { localStorage.setItem(WOT_CHOICE_SET_KEY, "true"); } catch {}
}

export interface WotDiagnostics {
  authenticated: boolean;
  authPubkey: string | null;
  authLastSuccessAt: number;
  authLastFailAt: number;
  authLastFailReason: string;
  connLastSuccessAt: number;
  connLastFailAt: number;
  connLastError: string;
  batchCooldownUntil: number;
  batchLastSuccessAt: number;
  batchLastFailAt: number;
  batchLastError: string;
}

interface GrapeRankScoresContextValue {
  scores: Map<string, number> | null;
  flaggedPubkeys: Set<string> | null;
  followedByPubkeys: Set<string> | null;
  loading: boolean;
  wotEnabled: boolean;
  /**
   * True once THIS observer has a completed server-side calculation
   * (lastCalculated exists). Until then every trust surface must hide and all
   * tier/reach filtering must be inert — a never-calculated observer would
   * otherwise see false "Unverified/Unknown" signals for everyone (the
   * new-user ~15-20 min calculation gap).
   */
  wotReady: boolean;
  setWotEnabled: (enabled: boolean) => void;
  recalculating: boolean;
  notifyRecalculating: () => void;
  refreshVersion: number;
  getAuthorTier: (pubkey: string) => SignalTier;
  getAuthorInfluence: (pubkey: string) => number | null;
  isAuthorFlagged: (pubkey: string) => boolean;
  /** How many trusted accounts flagged this pubkey (0 if none / unknown). */
  getFlagReporterCount: (pubkey: string) => number;
  /** Live pubkey → trusted-reporter-count map (null until scores load). */
  flagReporterCounts: Map<string, number> | null;
  /** Live pubkey → reporters WITH influence (un-collapsed; null until scores load). */
  reportedBy: Map<string, UserConnection[]> | null;
  requestScore: (pubkey: string) => void;
  requestScoresBulk: (pubkeys: string[]) => void;
  injectScores: (newScores: Map<string, number | null>) => void;
  diagnostics: WotDiagnostics;
  retryAuth: () => Promise<boolean>;
  clearCooldownAndRefresh: () => void;
}

function emptyDiagnostics(): WotDiagnostics {
  return {
    authenticated: false,
    authPubkey: null,
    authLastSuccessAt: 0,
    authLastFailAt: 0,
    authLastFailReason: "",
    connLastSuccessAt: 0,
    connLastFailAt: 0,
    connLastError: "",
    batchCooldownUntil: 0,
    batchLastSuccessAt: 0,
    batchLastFailAt: 0,
    batchLastError: "",
  };
}

const GrapeRankScoresContext = createContext<GrapeRankScoresContextValue>({
  scores: null,
  flaggedPubkeys: null,
  followedByPubkeys: null,
  loading: false,
  // WoT is OFF by default (matches getWotEnabled() and the provider); a consumer
  // rendered outside the provider must not silently see it enabled.
  wotEnabled: false,
  wotReady: false,
  setWotEnabled: () => {},
  recalculating: false,
  notifyRecalculating: () => {},
  refreshVersion: 0,
  getAuthorTier: () => "none",
  getAuthorInfluence: () => null,
  isAuthorFlagged: () => false,
  getFlagReporterCount: () => 0,
  flagReporterCounts: null,
  reportedBy: null,
  requestScore: () => {},
  requestScoresBulk: () => {},
  injectScores: () => {},
  diagnostics: emptyDiagnostics(),
  retryAuth: async () => false,
  clearCooldownAndRefresh: () => {},
});

function loadRecalcState(): { startedAt: number; pubkey: string } | null {
  try {
    const raw = localStorage.getItem(RECALC_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.startedAt === "number" && typeof parsed.pubkey === "string") {
      if (Date.now() - parsed.startedAt > RECALC_MAX_DURATION) {
        localStorage.removeItem(RECALC_STATE_KEY);
        return null;
      }
      return parsed;
    }
  } catch {}
  return null;
}

function saveRecalcState(pubkey: string) {
  try {
    localStorage.setItem(RECALC_STATE_KEY, JSON.stringify({ startedAt: Date.now(), pubkey }));
  } catch {}
}

function clearRecalcState() {
  try { localStorage.removeItem(RECALC_STATE_KEY); } catch {}
}

export function GrapeRankScoresProvider({ children }: { children: ReactNode }) {
  const { pubkey, follows } = useNostrAuth();
  const [wotEnabled, setWotEnabledRaw] = useState(() => {
    const enabled = getWotEnabled();
    if (!hasExplicitWotChoice()) {
      try {
        const raw = localStorage.getItem(WOT_ENABLED_KEY);
        if (raw !== null) {
          markWotChoiceSet();
        }
      } catch {}
    }
    return enabled;
  });
  const setWotEnabled = useCallback((enabled: boolean) => {
    setWotEnabledRaw(enabled);
    try { localStorage.setItem(WOT_ENABLED_KEY, String(enabled)); } catch {}
    markWotChoiceSet();
  }, []);

  useEffect(() => {
    const handleSettingsApplied = () => {
      setWotEnabledRaw(getWotEnabled());
      markWotChoiceSet();
    };
    window.addEventListener("nip78-settings-applied", handleSettingsApplied);
    return () => window.removeEventListener("nip78-settings-applied", handleSettingsApplied);
  }, []);
  const [recalculating, setRecalculating] = useState(() => {
    const saved = loadRecalcState();
    return saved !== null;
  });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const recalcPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [scores, setScores] = useState<Map<string, number> | null>(null);
  const [flaggedPubkeys, setFlaggedPubkeys] = useState<Set<string> | null>(null);
  const [flagReporterCounts, setFlagReporterCounts] = useState<Map<string, number> | null>(null);
  const [reportedBy, setReportedBy] = useState<Map<string, UserConnection[]> | null>(null);
  const [followedByPubkeys, setFollowedByPubkeys] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(false);
  // Server-side "a calculation has completed" truth for THIS observer. Persisted
  // per pubkey so returning users are ready instantly (and offline); null for a
  // never-calculated observer — the new-user gap where trust UI must stay hidden.
  const [lastCalculated, setLastCalculated] = useState<string | null>(null);
  // True only if we actually observed the not-ready state this session — gates
  // the one-time "trust network is ready" toast so long-time users never see it.
  const sawNotReadyRef = useRef(false);
  const fetchedRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const lazyQueueRef = useRef<Set<string>>(new Set());
  const lazyLookedUpRef = useRef<Set<string>>(new Set());
  const lazyAccumulatorRef = useRef<Map<string, number>>(new Map());
  const lazyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeFetchCountRef = useRef(0);
  const lazyFailCountRef = useRef<Map<string, number>>(new Map());
  const negativeRetryAtRef = useRef<Map<string, number>>(new Map());
  const lazyGenerationRef = useRef(0);
  const bulkQueueRef = useRef<Set<string>>(new Set());
  const bulkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bulkInFlightRef = useRef(false);
  const lsSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lsDirtyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (lazyTimerRef.current) clearTimeout(lazyTimerRef.current);
    };
  }, []);

  const flushAccumulator = useCallback(() => {
    if (!mountedRef.current) return;
    const acc = lazyAccumulatorRef.current;
    if (acc.size === 0) return;

    const batch = new Map(acc);
    acc.clear();

    setScores(prev => {
      // Create the map when it doesn't exist yet: if fetchConnectionScores
      // failed (or hasn't landed), badge hydration must still be able to
      // populate the store instead of silently dropping every result.
      const next = new Map(prev ?? []);
      for (const [k, v] of batch) {
        next.set(k, v);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    flushTimerRef.current = setInterval(flushAccumulator, LAZY_FLUSH_INTERVAL);
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    };
  }, [flushAccumulator]);

  const scheduleNextBatch = useCallback(() => {
    if (lazyTimerRef.current) clearTimeout(lazyTimerRef.current);
    lazyTimerRef.current = null;
    if (lazyQueueRef.current.size > 0 && activeFetchCountRef.current < LAZY_MAX_CONCURRENT) {
      lazyTimerRef.current = setTimeout(processLazyBatchRef.current, LAZY_BATCH_DELAY);
    }
  }, []);

  // Drains the per-observer refinement queue: each entry gets an authenticated
  // /api/graperank/user/{target} lookup (the same per-observer source the
  // profile HUD uses), bounded to LAZY_MAX_CONCURRENT in flight. Entries arrive
  // here from processBulkQueue after the fast global prewarm answered (or
  // failed) — per-observer resolution is the only terminal state.
  const processLazyBatchRef = useRef<() => void>(() => {});
  processLazyBatchRef.current = () => {
    lazyTimerRef.current = null;
    if (!mountedRef.current || !pubkey) return;
    const queue = lazyQueueRef.current;
    if (queue.size === 0) return;

    const availableSlots = LAZY_MAX_CONCURRENT - activeFetchCountRef.current;
    if (availableSlots <= 0) return;

    const batch: string[] = [];
    for (const pk of queue) {
      batch.push(pk);
      if (batch.length >= availableSlots) break;
    }
    for (const pk of batch) {
      queue.delete(pk);
    }

    const gen = lazyGenerationRef.current;

    activeFetchCountRef.current += batch.length;

    for (const targetPk of batch) {
      fetchIndividualScore(targetPk, pubkey, gen);
    }
  };

  // Per-observer resolution came back empty (or errored). Never write a
  // negative "No data" verdict into the shared map: an existing provisional
  // global score keeps rendering, and an absent score stays neutral. Terminal
  // misses are only bookkeeping — a timestamp that gates a later retry.
  function handleIndividualMiss(targetPk: string) {
    const fails = (lazyFailCountRef.current.get(targetPk) ?? 0) + 1;
    lazyFailCountRef.current.set(targetPk, fails);
    if (fails >= LAZY_MAX_RETRIES) {
      lazyLookedUpRef.current.add(targetPk);
      negativeRetryAtRef.current.set(targetPk, Date.now());
      lazyFailCountRef.current.delete(targetPk);
    } else {
      lazyQueueRef.current.add(targetPk);
    }
  }

  function fetchIndividualScore(targetPk: string, observerPk: string, gen: number) {
    if (lazyLookedUpRef.current.has(targetPk)) {
      activeFetchCountRef.current = Math.max(0, activeFetchCountRef.current - 1);
      scheduleNextBatch();
      return;
    }
    fetchGrapeRankScore(targetPk, observerPk)
      .then(result => {
        if (!mountedRef.current || gen !== lazyGenerationRef.current) return;
        if (result && result.influence !== null) {
          // Per-observer truth: overwrites any provisional global value.
          lazyLookedUpRef.current.add(targetPk);
          negativeRetryAtRef.current.delete(targetPk);
          lazyFailCountRef.current.delete(targetPk);
          lazyAccumulatorRef.current.set(targetPk, result.influence);
          lsDirtyRef.current = true;
          if (lazyAccumulatorRef.current.size >= 5) flushAccumulator();
        } else {
          handleIndividualMiss(targetPk);
        }
      })
      .catch(() => {
        if (gen !== lazyGenerationRef.current) return;
        handleIndividualMiss(targetPk);
      })
      .finally(() => {
        if (gen !== lazyGenerationRef.current) return;
        activeFetchCountRef.current = Math.max(0, activeFetchCountRef.current - 1);
        scheduleNextBatch();
      });
  }

  // Shared enqueue gate for requestScore / requestScoresBulk. Works with a null
  // shared map — a request must be able to hydrate an empty store (the old
  // requestScore returned early on `!scores`, leaving single-badge hydration
  // inert until something else created the map).
  const enqueueForBulk = useCallback((pk: string, existing: number | undefined): boolean => {
    const decision = decideScoreRequest({
      existing,
      resolved: lazyLookedUpRef.current.has(pk),
      missAt: negativeRetryAtRef.current.get(pk),
      now: Date.now(),
      cooldownMs: NEGATIVE_RETRY_COOLDOWN_MS,
    });
    if (decision === "skip") return false;
    if (decision === "retry") {
      negativeRetryAtRef.current.delete(pk);
      lazyLookedUpRef.current.delete(pk);
      lazyFailCountRef.current.delete(pk);
    }
    if (lazyAccumulatorRef.current.has(pk)) return false;
    if (bulkQueueRef.current.has(pk)) return false;
    // Already awaiting per-observer refinement — don't bounce it back to the
    // global batch path.
    if (lazyQueueRef.current.has(pk)) return false;
    bulkQueueRef.current.add(pk);
    return true;
  }, []);

  // Route single-author badge requests (used by every post's author indicator
  // across the app) through the fast chunked Brainstorm batch path first: many
  // badges rendering at once coalesce into a couple of batched calls whose
  // global wot_rank values render immediately as PROVISIONAL dots. Every author
  // is then refined through the per-observer queue so the dots converge on the
  // same score the profile HUD shows — without needing a profile visit.
  const requestScore = useCallback((pk: string) => {
    if (!pubkey || !wotEnabled) return;
    if (!enqueueForBulk(pk, scores?.get(pk))) return;
    if (bulkTimerRef.current) clearTimeout(bulkTimerRef.current);
    bulkTimerRef.current = setTimeout(() => processBulkQueueRef.current(), BULK_DEBOUNCE);
  }, [pubkey, scores, wotEnabled, enqueueForBulk]);

  const processBulkQueueRef = useRef<() => void>(() => {});
  processBulkQueueRef.current = () => {
    if (!mountedRef.current || !pubkey || bulkInFlightRef.current) return;
    const queue = bulkQueueRef.current;
    if (queue.size === 0) return;

    const batch = Array.from(queue).filter(pk => !lazyLookedUpRef.current.has(pk));
    queue.clear();
    if (batch.length === 0) return;
    bulkInFlightRef.current = true;
    const gen = lazyGenerationRef.current;

    // Global (Meili wot_rank) prewarm: fast + batched, but a fixed-root-observer
    // metric — so its values are written as provisional and every author is
    // queued for per-observer refinement. Misses (-1 markers from the server)
    // are NOT written into the map: "Meili has no data" must render as neutral
    // and stay resolvable by the per-observer path, never as a sticky "No data"
    // verdict (the July 2026 feed-badge bug). If the batch API is cooling down
    // it returns an empty map, which simply sends everyone straight to the
    // per-observer queue.
    fetchBrainstormWotBatch(batch)
      .then(results => {
        if (!mountedRef.current || gen !== lazyGenerationRef.current) return;
        const room = LAZY_MAX_PENDING - lazyQueueRef.current.size;
        const plan = planBulkResults(batch, results, lazyLookedUpRef.current, room);
        if (plan.writes.size > 0) {
          for (const [pk, influence] of plan.writes) {
            lazyAccumulatorRef.current.set(pk, influence);
          }
          lsDirtyRef.current = true;
          flushAccumulator();
        }
        for (const pk of plan.refine) {
          lazyQueueRef.current.add(pk);
        }
        scheduleNextBatch();
      })
      .catch(() => {
        if (gen !== lazyGenerationRef.current) return;
        for (const pk of batch) {
          if (!lazyLookedUpRef.current.has(pk)) {
            lazyQueueRef.current.add(pk);
          }
        }
        scheduleNextBatch();
      })
      .finally(() => {
        bulkInFlightRef.current = false;
        if (bulkQueueRef.current.size > 0) {
          bulkTimerRef.current = setTimeout(() => processBulkQueueRef.current(), BULK_DEBOUNCE);
        }
      });
  };

  const requestScoresBulk = useCallback((pubkeys: string[]) => {
    if (!pubkey || !wotEnabled) return;
    let added = 0;
    for (const pk of pubkeys) {
      if (enqueueForBulk(pk, scores?.get(pk))) added++;
    }
    if (added === 0) return;
    if (bulkTimerRef.current) clearTimeout(bulkTimerRef.current);
    bulkTimerRef.current = setTimeout(() => processBulkQueueRef.current(), BULK_DEBOUNCE);
  }, [pubkey, scores, wotEnabled, enqueueForBulk]);

  const [diagnostics, setDiagnostics] = useState<WotDiagnostics>(() => {
    const a = getBrainstormAuthStatus();
    const c = getConnectionFetchStatus();
    const b = getBrainstormBatchStatus();
    return {
      authenticated: a.authenticated,
      authPubkey: a.pubkey,
      authLastSuccessAt: a.lastSuccessAt,
      authLastFailAt: a.lastFailAt,
      authLastFailReason: a.lastFailReason,
      connLastSuccessAt: c.lastSuccessAt,
      connLastFailAt: c.lastFailAt,
      connLastError: c.lastError,
      batchCooldownUntil: b.cooldownUntil,
      batchLastSuccessAt: b.lastSuccessAt,
      batchLastFailAt: b.lastFailAt,
      batchLastError: b.lastError,
    };
  });

  const refreshDiagnostics = useCallback(() => {
    const a = getBrainstormAuthStatus();
    const c = getConnectionFetchStatus();
    const b = getBrainstormBatchStatus();
    setDiagnostics({
      authenticated: a.authenticated,
      authPubkey: a.pubkey,
      authLastSuccessAt: a.lastSuccessAt,
      authLastFailAt: a.lastFailAt,
      authLastFailReason: a.lastFailReason,
      connLastSuccessAt: c.lastSuccessAt,
      connLastFailAt: c.lastFailAt,
      connLastError: c.lastError,
      batchCooldownUntil: b.cooldownUntil,
      batchLastSuccessAt: b.lastSuccessAt,
      batchLastFailAt: b.lastFailAt,
      batchLastError: b.lastError,
    });
  }, []);

  useEffect(() => {
    const unsubAuth = onBrainstormAuthEvent(() => {
      refreshDiagnostics();
    });
    const unsubBatch = onBrainstormBatchEvent(() => {
      refreshDiagnostics();
    });
    return () => { unsubAuth(); unsubBatch(); };
  }, [refreshDiagnostics]);

  const contactListFetchedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pubkey || !wotEnabled) {
      setScores(null);
      setFlaggedPubkeys(null);
      setFlagReporterCounts(null);
      setReportedBy(null);
      setFollowedByPubkeys(null);
      setLoading(false);
      fetchedRef.current = null;
      contactListFetchedForRef.current = null;
      contactListScheduledRef.current = false;
      resetContactListCache();
      lazyGenerationRef.current++;
      lazyQueueRef.current.clear();
      lazyLookedUpRef.current.clear();
      lazyAccumulatorRef.current.clear();
      lazyFailCountRef.current.clear();
      negativeRetryAtRef.current.clear();
      activeFetchCountRef.current = 0;
      if (lazyTimerRef.current) clearTimeout(lazyTimerRef.current);
      if (bulkTimerRef.current) clearTimeout(bulkTimerRef.current);
      bulkQueueRef.current.clear();
      bulkInFlightRef.current = false;
      return;
    }

    if (fetchedRef.current === pubkey) return;
    fetchedRef.current = pubkey;
    lazyGenerationRef.current++;
    lazyQueueRef.current.clear();
    lazyLookedUpRef.current.clear();
    lazyAccumulatorRef.current.clear();
    lazyFailCountRef.current.clear();
    negativeRetryAtRef.current.clear();
    activeFetchCountRef.current = 0;
    bulkQueueRef.current.clear();
    if (bulkTimerRef.current) clearTimeout(bulkTimerRef.current);
    bulkInFlightRef.current = false;

    const cached = loadLsScores(pubkey);
    if (cached.size > 0) {
      setScores(cached);
      setLoading(true);
      console.log(`[GrapeRank] Loaded ${cached.size} cached scores from localStorage`);
    } else {
      setScores(null);
      setLoading(true);
    }
    // Restore the persisted readiness truth for this observer immediately, so
    // returning users don't flash a hidden-trust state while the fetch runs.
    try { setLastCalculated(localStorage.getItem(`relay-outpost-wot-lastcalc:${pubkey}`)); } catch { setLastCalculated(null); }
    sawNotReadyRef.current = false;
    setFlaggedPubkeys(null);
    setFlagReporterCounts(null);
    setReportedBy(null);
    setFollowedByPubkeys(null);

    fetchConnectionScores(pubkey)
      .then((result) => {
        if (!mountedRef.current || fetchedRef.current !== pubkey) return;
        const fresh = result?.scores ?? null;
        let effective = fresh;
        if (fresh && cached.size > 0) {
          const merged = new Map(cached);
          for (const [k, v] of fresh) merged.set(k, v);
          setScores(merged);
          effective = merged;
          lsDirtyRef.current = true;
        } else {
          setScores(fresh);
          if (fresh) lsDirtyRef.current = true;
        }
        // Background score-history snapshot (bounded, one-per-day) for future
        // "trending down" surfaces — no UI, just accumulate whenever scores land.
        if (effective && follows && follows.length > 0) {
          try { recordScoreSnapshot(pubkey, follows, (pk) => effective!.get(pk) ?? null); } catch {}
        }
        setFlaggedPubkeys(result?.flaggedPubkeys ?? null);
        setFlagReporterCounts(result?.flagReporterCounts ?? null);
        setReportedBy(result?.reportedBy ?? null);
        setFollowedByPubkeys(result?.followedByPubkeys ?? null);
        setLoading(false);
        refreshDiagnostics();

        if (result?.lastTriggered && result?.lastCalculated) {
          const trigTime = new Date(result.lastTriggered).getTime();
          const calcTime = new Date(result.lastCalculated).getTime();
          if (trigTime > calcTime && !recalculating) {
            console.log("[GrapeRank] Detected in-progress recalculation from API timestamps");
            setRecalculating(true);
            saveRecalcState(pubkey);
          }
        }

        // Readiness truth: a completed calculation exists for this observer.
        if (result?.lastCalculated) {
          setLastCalculated(result.lastCalculated);
          try { localStorage.setItem(`relay-outpost-wot-lastcalc:${pubkey}`, result.lastCalculated); } catch {}
        } else {
          // Never-calculated observer (new account / first sign-in): this is
          // the gap where trust UI hides. Remember we saw it so the ready
          // toast fires when the calculation lands.
          sawNotReadyRef.current = true;
          setLastCalculated(null);
          try { localStorage.removeItem(`relay-outpost-wot-lastcalc:${pubkey}`); } catch {}
        }
      })
      .catch(() => {
        if (!mountedRef.current || fetchedRef.current !== pubkey) return;
        if (cached.size === 0) setScores(null);
        setFlaggedPubkeys(null);
        setFlagReporterCounts(null);
        setReportedBy(null);
        setFollowedByPubkeys(null);
        setLoading(false);
        refreshDiagnostics();
      });
  }, [pubkey, wotEnabled, refreshVersion]);

  // Web of Trust is OFF by default for new users. They must explicitly flip
  // the toggle on the Trust & safety page to activate it. Returning users who
  // had previously enabled WoT keep their choice (WOT_ENABLED_KEY = "true" in
  // localStorage). We intentionally do NOT auto-enable based on cached scores
  // or API probes — opting in should be a deliberate user action.

  const contactListScheduledRef = useRef(false);

  useEffect(() => {
    if (!scores || !pubkey || !follows || follows.length === 0) return;
    if (contactListFetchedForRef.current === pubkey) return;
    if (contactListScheduledRef.current) return;

    const topTrusted: { pk: string; score: number }[] = [];
    for (const f of follows) {
      if (f === pubkey) continue;
      const s = scores.get(f);
      if (s !== undefined && s >= 0.5) {
        topTrusted.push({ pk: f, score: s });
      }
    }
    topTrusted.sort((a, b) => b.score - a.score);
    const toFetch = topTrusted.slice(0, 50).map(t => t.pk);
    if (toFetch.length === 0) return;
    contactListScheduledRef.current = true;
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        contactListFetchedForRef.current = pubkey;
        fetchContactLists(toFetch);
      }
    }, 8000);
    return () => { clearTimeout(timer); contactListScheduledRef.current = false; };
  }, [scores, pubkey, follows]);

  const getAuthorTier = useCallback((pk: string): SignalTier => {
    if (!scores) return "none";
    const influence = scores.get(pk) ?? null;
    return getSignalTier(influence);
  }, [scores]);

  const getAuthorInfluence = useCallback((pk: string): number | null => {
    if (!scores) return null;
    const val = scores.get(pk);
    if (val === undefined || val < 0) return null;
    return val;
  }, [scores]);

  const isAuthorFlagged = useCallback((pk: string): boolean => {
    if (!flaggedPubkeys) return false;
    return flaggedPubkeys.has(pk);
  }, [flaggedPubkeys]);

  const getFlagReporterCount = useCallback((pk: string): number => {
    if (!flagReporterCounts) return 0;
    return flagReporterCounts.get(pk) ?? 0;
  }, [flagReporterCounts]);

  useEffect(() => {
    if (!pubkey) return;
    const currentPubkey = pubkey;
    lsSaveTimerRef.current = setInterval(() => {
      if (lsDirtyRef.current && scores && scores.size > 0) {
        saveLsScores(currentPubkey, scores);
        lsDirtyRef.current = false;
      }
    }, LS_SAVE_INTERVAL);
    return () => {
      if (lsSaveTimerRef.current) clearInterval(lsSaveTimerRef.current);
      if (lsDirtyRef.current && scores && scores.size > 0) {
        saveLsScores(currentPubkey, scores);
      }
    };
  }, [pubkey, scores]);

  const notifyRecalculating = useCallback(() => {
    if (!pubkey || recalculating) return;
    setRecalculating(true);
    saveRecalcState(pubkey);
    console.log("[GrapeRank] Recalculation initiated, starting poll");
  }, [pubkey, recalculating]);

  // WoT is ON but this observer has NEVER had a server-side calculation
  // (lastCalculated is null, confirmed by the connection fetch — that's what
  // sawNotReadyRef records). Historically only CreateAccountFlow triggered the
  // first calculation; the Settings/ShieldMatrix toggles just flipped the flag,
  // leaving toggle-users permanently un-ready with an empty score store. Kick
  // the first calculation here; the recalc poller watches for completion and
  // rehydrates. Guards: once per observer per session, and never with zero
  // follows (a followless account has no graph to rank — CreateAccountFlow's
  // anchor-follow invariant). The upstream enforces its own ~30-min per-user
  // cooldown; "rate_limited" means a calc was already requested recently (e.g.
  // by onboarding), so we still start polling for its completion.
  const autoCalcForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wotEnabled || !pubkey || loading || recalculating) return;
    if (lastCalculated !== null) return;
    if (!sawNotReadyRef.current) return;
    if (autoCalcForRef.current === pubkey) return;
    if (!follows || follows.length === 0) return;
    autoCalcForRef.current = pubkey;
    void triggerGrapeRankCalculation(pubkey)
      .then((r) => {
        if (!mountedRef.current) return;
        if (r.ok || r.error === "rate_limited") {
          console.log("[GrapeRank] First calculation triggered on WoT enable", r.ok ? "" : "(already pending upstream)");
          notifyRecalculating();
        } else {
          // Transient failure (signer, upstream) — allow a later attempt.
          autoCalcForRef.current = null;
        }
      })
      .catch(() => {
        if (mountedRef.current) autoCalcForRef.current = null;
      });
  }, [wotEnabled, pubkey, loading, recalculating, lastCalculated, follows, notifyRecalculating]);

  useEffect(() => {
    if (!recalculating || !pubkey || !wotEnabled) {
      if (recalcPollRef.current) {
        clearInterval(recalcPollRef.current);
        recalcPollRef.current = null;
      }
      return;
    }

    const saved = loadRecalcState();
    if (saved && saved.pubkey !== pubkey) {
      clearRecalcState();
      setRecalculating(false);
      return;
    }

    const startedAt = saved?.startedAt ?? Date.now();

    const doPoll = async () => {
      if (!mountedRef.current) return;

      if (Date.now() - startedAt > RECALC_MAX_DURATION) {
        console.log("[GrapeRank] Recalculation poll timed out after 25 minutes");
        clearRecalcState();
        setRecalculating(false);
        return;
      }

      if (document.hidden) return;

      try {
        const result = await fetchSelfGrapeRank(pubkey);
        if (!result || !mountedRef.current) return;

        const { lastCalculated, lastTriggered } = result;
        if (!lastTriggered || !lastCalculated) return;

        const calcTime = new Date(lastCalculated).getTime();
        const trigTime = new Date(lastTriggered).getTime();

        if (calcTime >= trigTime) {
          console.log("[GrapeRank] Recalculation complete — scores updated");
          clearRecalcState();
          setRecalculating(false);
          setRefreshVersion((v) => v + 1);

          clearGrapeRankCache();
          clearLsScores(pubkey);

          fetchedRef.current = null;
          lazyGenerationRef.current++;
          lazyQueueRef.current.clear();
          lazyLookedUpRef.current.clear();
          lazyAccumulatorRef.current.clear();
          lazyFailCountRef.current.clear();
          negativeRetryAtRef.current.clear();
          activeFetchCountRef.current = 0;
          bulkQueueRef.current.clear();
          bulkInFlightRef.current = false;
          contactListFetchedForRef.current = null;

          setLoading(true);
          fetchConnectionScores(pubkey)
            .then((freshResult) => {
              if (!mountedRef.current) return;
              const fresh = freshResult?.scores ?? null;
              setScores(fresh);
              setFlaggedPubkeys(freshResult?.flaggedPubkeys ?? null);
              setFlagReporterCounts(freshResult?.flagReporterCounts ?? null);
              setReportedBy(freshResult?.reportedBy ?? null);
              setFollowedByPubkeys(freshResult?.followedByPubkeys ?? null);
              setLoading(false);
              if (fresh) lsDirtyRef.current = true;
            })
            .catch(() => {
              if (mountedRef.current) setLoading(false);
            });
        }
      } catch (err) {
        console.warn("[GrapeRank] Recalculation poll error:", err);
      }
    };

    doPoll();
    recalcPollRef.current = setInterval(doPoll, RECALC_POLL_INTERVAL);

    const handleVisibility = () => {
      if (!document.hidden) doPoll();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (recalcPollRef.current) {
        clearInterval(recalcPollRef.current);
        recalcPollRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [recalculating, pubkey, wotEnabled]);

  const injectScores = useCallback((newScores: Map<string, number | null>) => {
    setScores(prev => {
      const merged = new Map(prev ?? []);
      for (const [pk, val] of newScores) {
        // null = nothing to inject; negative = a "no data" miss marker, which
        // must never be written as an authoritative verdict (it would stick and
        // block the per-observer pipeline from ever filling the gap).
        if (val === null || val < 0) continue;
        // Authoritative overwrite. injectScores only ever receives a freshly
        // fetched per-observer /user/ score (the same live calc the profile HUD
        // shows). It must win over a pre-seeded bulk value from published NIP-85,
        // otherwise the profile shows e.g. 77% while a post badge is stuck on the
        // stale bulk 3% ("scores are off"). This mirrors flushAccumulator, which
        // already sets the individual score unconditionally — injectScores was
        // the lone path that kept the stale value.
        merged.set(pk, val);
      }
      return merged;
    });
    for (const [pk, val] of newScores) {
      if (val !== null && val >= 0) {
        lazyLookedUpRef.current.add(pk);
        lazyFailCountRef.current.delete(pk);
        negativeRetryAtRef.current.delete(pk);
        lazyQueueRef.current.delete(pk);
        bulkQueueRef.current.delete(pk);
      }
    }
  }, []);


  const retryAuth = useCallback(async () => {
    if (!pubkey) return false;
    clearBrainstormAuth();
    refreshDiagnostics();
    const ok = await authenticateWithBrainstorm(pubkey);
    refreshDiagnostics();
    if (ok) {
      try {
        const raw = sessionStorage.getItem("wot-diag-toasts");
        const arr: string[] = raw ? JSON.parse(raw) : [];
        const filtered = arr.filter(k => k !== "auth-failed");
        sessionStorage.setItem("wot-diag-toasts", JSON.stringify(filtered));
      } catch {}
    }
    return ok;
  }, [pubkey, refreshDiagnostics]);

  const clearCooldownAndRefresh = useCallback(() => {
    clearBrainstormBatchCooldown();
    clearGrapeRankCache();
    if (pubkey) clearLsScores(pubkey);
    fetchedRef.current = null;
    lazyGenerationRef.current++;
    refreshDiagnostics();
    setRefreshVersion(v => v + 1);
    try {
      const raw = sessionStorage.getItem("wot-diag-toasts");
      const arr: string[] = raw ? JSON.parse(raw) : [];
      const filtered = arr.filter(k => k !== "batch-cooldown");
      sessionStorage.setItem("wot-diag-toasts", JSON.stringify(filtered));
    } catch {}
  }, [pubkey, refreshDiagnostics]);

  // Ready ≡ this observer has a completed server-side calculation. Until then
  // every trust surface hides and tier/reach filtering is inert (new-user gap).
  const wotReady = wotEnabled && !!lastCalculated;

  // One-time reveal: only when THIS session watched the not-ready state (new
  // account mid-calculation), never for long-time users on a fresh load.
  useEffect(() => {
    if (!pubkey || !wotReady || !sawNotReadyRef.current) return;
    sawNotReadyRef.current = false;
    const guard = `relay-outpost-wot-ready-toast:${pubkey}`;
    try {
      if (localStorage.getItem(guard)) return;
      localStorage.setItem(guard, "1");
    } catch {}
    toast({
      title: "Your trust network is ready",
      description: "Trust signals are now live across your feed.",
    });
  }, [wotReady, pubkey]);

  const value = useMemo(() => ({
    scores, flaggedPubkeys, flagReporterCounts, reportedBy, followedByPubkeys, loading, wotEnabled, wotReady, setWotEnabled, recalculating, notifyRecalculating, refreshVersion, getAuthorTier, getAuthorInfluence, isAuthorFlagged, getFlagReporterCount, requestScore, requestScoresBulk, injectScores,
    diagnostics, retryAuth, clearCooldownAndRefresh,
  }), [scores, flaggedPubkeys, flagReporterCounts, reportedBy, followedByPubkeys, loading, wotEnabled, wotReady, setWotEnabled, recalculating, notifyRecalculating, refreshVersion, getAuthorTier, getAuthorInfluence, isAuthorFlagged, getFlagReporterCount, requestScore, requestScoresBulk, injectScores, diagnostics, retryAuth, clearCooldownAndRefresh]);

  return (
    <GrapeRankScoresContext.Provider value={value}>
      {children}
    </GrapeRankScoresContext.Provider>
  );
}

export function useGrapeRankScores() {
  return useContext(GrapeRankScoresContext);
}
