import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { nip19 } from "nostr-tools";
import { fetchNip11, supportsNip, getSoftwareDisplay, type Nip11Document } from "@/lib/nip11";
import { getAuthStatus, isAuthEnabled, setAuthEnabled, onAuthChange, type AuthStatus } from "@/lib/nip42-auth";
import { copyNostrId } from "@/lib/clipboard-bridge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { OpsCard, OpsSectionHeader } from "./ops-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  Activity,
  Inbox,
  Bug,
  ChevronRight,
  Server,
  Info,
  Shield,
  Lock,
  Unlock,
  RefreshCw,
  Hash,
  Globe,
  Mail,
  Code,
  Layers,
  Zap,
  Copy,
  Check,
  AlertTriangle,
  UserCheck,
  Plus,
  Clock,
  FileText,
  X,
  User,
  Users,
  ExternalLink,
  Package,
  CreditCard,
  Database,
  Languages,
  Tag,
  FileCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  countWithNip45,
  subscribeWithTimeout,
  subscribeWithReach,
  ProfileInfo,
  ProfileName,
  pubkeyToNpub,
  resolveProfileBatch,
  getKindLabel,
  AuthStatusBadge,
  CHART_COLORS,
  ChartTooltip,
  KindCountEntry,
  NostrFilter,
  MANUAL_TEAM_KEY,
  getStoredList,
  saveStoredList,
  getStorageTrends,
  addStorageTrend,
  StorageTrendEntry,
  getUptimeHistory,
  addUptimeEntry,
  UptimeEntry,
  addModLogEntry,
  formatRelativeMs,
} from "./shared";
import type { FeedbackInbox } from "@/hooks/use-feedback-inbox";
import { isCrashIssue, groupCrashesBySig, tallyCrashStatuses, deriveCrashStatuses } from "@/lib/crash-report";
import { tallyFeedbackStatuses, type CrashStatus } from "@/lib/nip34-feedback";

// ── Operator "User Feedback" summary (transparency surface on the Overview) ──
// Reuses the ONE inbox subscription owned by RelayOpsCenter (passed down as a
// prop) so this never opens a second feed. Live-refreshes its crash-status
// breakdown off the same local-annotation event the Feedback tab dispatches.

function SummaryStat({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wide mb-1">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={`text-xl font-semibold tabular-nums ${accent ? "text-brand" : "text-foreground"}`}>{value}</span>
        {sub && <span className="text-[10px] text-muted-foreground/50">{sub}</span>}
      </div>
    </div>
  );
}

const CRASH_BREAKDOWN: Array<{ key: CrashStatus; label: string; dot: string }> = [
  { key: "new", label: "New", dot: "bg-amber-400" },
  { key: "investigating", label: "Investigating", dot: "bg-blue-400" },
  { key: "fixed", label: "Fixed", dot: "bg-emerald-400" },
  { key: "ignored", label: "Closed", dot: "bg-muted-foreground/40" },
];

function FeedbackSummaryCard({ inbox, onOpenFeedback }: { inbox: FeedbackInbox; onOpenFeedback?: () => void }) {
  const summary = useMemo(() => {
    const fb = inbox.issues.filter((i) => !isCrashIssue(i));
    const cr = inbox.issues.filter(isCrashIssue);
    const groups = groupCrashesBySig(cr);
    const status = tallyFeedbackStatuses(fb);
    // Crash statuses derive from the tickets themselves (same source of truth
    // as the Feedback tab) — status changes arrive through the inbox stream.
    const crash = tallyCrashStatuses(groups, deriveCrashStatuses(groups));
    return { feedbackTotal: fb.length, occurrences: cr.length, groupCount: groups.length, status, crash };
  }, [inbox.issues]);

  if (summary.feedbackTotal + summary.groupCount === 0) return null; // nothing filed yet

  return (
    <OpsCard>
      <div className="flex items-center justify-between mb-3">
        <OpsSectionHeader icon={Inbox} label="User Feedback" />
        <button
          onClick={onOpenFeedback}
          className="text-[11px] text-brand hover:underline inline-flex items-center gap-0.5 shrink-0"
          data-testid="button-overview-open-feedback"
        >
          Open inbox <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <SummaryStat label="Open" value={summary.status.open} sub={`of ${summary.feedbackTotal}`} />
        <SummaryStat label="Unread" value={inbox.unreadCount} accent={inbox.unreadCount > 0} />
        <SummaryStat label="Crashes" value={summary.groupCount} sub={summary.occurrences !== summary.groupCount ? `${summary.occurrences}×` : undefined} />
      </div>
      {summary.groupCount > 0 && (
        <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap mt-3 pt-3 border-t border-border/40" data-testid="overview-crash-breakdown">
          <Bug className="w-3 h-3 text-muted-foreground/50" />
          {CRASH_BREAKDOWN.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
              {c.label} <span className="tabular-nums font-medium text-foreground/80">{summary.crash[c.key]}</span>
            </span>
          ))}
        </div>
      )}
    </OpsCard>
  );
}

const DEEP_SCAN_MAX_EVENTS = 5000;
const DEEP_SCAN_DEEPER_MAX_EVENTS = 25000;
const DEEP_SCAN_PAGE_SIZE = 500;

export function OverviewTab({ relayUrl, inbox, onOpenFeedback }: { relayUrl: string; inbox?: FeedbackInbox; onOpenFeedback?: () => void }) {
  const { toast } = useToast();
  const [nip11, setNip11] = useState<Nip11Document | null>(null);
  // Initialize true so the initial-scan effect waits for the first
  // loadNip11() to complete before running fetchKindCounts. Without this,
  // the scan effect runs in the same post-render pass as loadNip11() and
  // the COUNT probe races NIP-11 trust on first paint.
  const [loadingNip11, setLoadingNip11] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(getAuthStatus(relayUrl).status);
  const [authEnabled, setAuthEnabledState] = useState(isAuthEnabled(relayUrl));
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [uptimeHistory, setUptimeHistory] = useState<UptimeEntry[]>(getUptimeHistory(relayUrl));
  const [latencyNow, setLatencyNow] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"checking" | "online" | "offline">("checking");
  const [kindCounts, setKindCounts] = useState<KindCountEntry[]>([]);
  const [loadingCounts, setLoadingCounts] = useState(false);
  // false = the last scan could not open a socket, so the grid below is zeros
  // we invented rather than counts we measured.
  const [countsReached, setCountsReached] = useState(true);
  const [topPublishers, setTopPublishers] = useState<Array<{ pubkey: string; count: number }>>([]);
  const [topPublisherProfiles, setTopPublisherProfiles] = useState<Map<string, ProfileInfo>>(new Map());
  // Deep-scan state for Top Publishers. The initial scan only samples the
  // most recent 100 kind:1 events (because COUNT can't return author-level
  // data). Operators can opt into a deeper, paginated walk back in time to
  // build a more accurate publisher leaderboard.
  const [deepScanRunning, setDeepScanRunning] = useState(false);
  const [deepScanSampled, setDeepScanSampled] = useState(0);
  const [deepScanOldestTs, setDeepScanOldestTs] = useState<number | null>(null);
  const [deepScanNewestTs, setDeepScanNewestTs] = useState<number | null>(null);
  const [deepScanStatus, setDeepScanStatus] = useState<"idle" | "running" | "completed" | "cancelled" | "capped">("idle");
  // Cap used by the most recent run, so the "Capped at N" badge can show
  // the tier the operator actually picked (5k vs 25k).
  const [deepScanCap, setDeepScanCap] = useState<number>(DEEP_SCAN_MAX_EVENTS);
  // When the leaderboard came from a persisted snapshot, this is the wall
  // clock timestamp of that snapshot. Drives the "as of" provenance line.
  const [leaderboardSavedAt, setLeaderboardSavedAt] = useState<number | null>(null);
  const deepScanCancelRef = useRef(false);
  // Monotonic scan token — bumped on every cancel, relay switch, and
  // unmount. The running scan captures the token at start and refuses to
  // call setters once its token is stale. This is what makes a cancelled
  // scan from a prior relay (or a torn-down component) unable to mutate
  // current UI state.
  const deepScanTokenRef = useRef(0);
  const isMountedRef = useRef(true);
  // Persisted leaderboard cache. Keyed by relay URL so reopening the
  // Overview tab paints the previous Top Publishers result instantly
  // instead of staring at an empty card while the initial sample runs.
  const LEADERBOARD_KEY = "top_publishers_v1";
  type PersistedLeaderboard = {
    entries: Array<{ pubkey: string; count: number }>;
    sampled: number;
    oldestTs: number | null;
    newestTs: number | null;
    status: "completed" | "cancelled" | "capped";
    cap: number;
    ts: number;
  };
  const readLeaderboardCache = (url: string): PersistedLeaderboard | null => {
    try {
      const raw = localStorage.getItem(LEADERBOARD_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const entry = (parsed as Record<string, unknown>)[url];
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Partial<PersistedLeaderboard>;
      if (!Array.isArray(e.entries)) return null;
      const cleanEntries = e.entries
        .filter((x): x is { pubkey: string; count: number } =>
          !!x && typeof x === "object" && typeof (x as { pubkey?: unknown }).pubkey === "string" && typeof (x as { count?: unknown }).count === "number")
        .slice(0, 100);
      return {
        entries: cleanEntries,
        sampled: typeof e.sampled === "number" ? e.sampled : 0,
        oldestTs: typeof e.oldestTs === "number" ? e.oldestTs : null,
        newestTs: typeof e.newestTs === "number" ? e.newestTs : null,
        status: (e.status === "completed" || e.status === "cancelled" || e.status === "capped") ? e.status : "completed",
        cap: typeof e.cap === "number" ? e.cap : DEEP_SCAN_MAX_EVENTS,
        ts: typeof e.ts === "number" ? e.ts : 0,
      };
    } catch { return null; }
  };
  const writeLeaderboardCache = (url: string, value: PersistedLeaderboard) => {
    try {
      const raw = localStorage.getItem(LEADERBOARD_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const all = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, PersistedLeaderboard>;
      // Trim to top 100 to stay well under any reasonable localStorage budget.
      all[url] = { ...value, entries: value.entries.slice(0, 100) };
      localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(all));
    } catch {}
  };
  const NIP45_CACHE_KEY = "nip45_capability_v1";
  // List of localStorage keys that hold per-relay capability flags. When the
  // relay's NIP-11 supported_nips list changes we wipe this relay's entry
  // from each one so the flag gets re-probed against the upgraded relay.
  // Add future capability caches (e.g. NIP-50 search) to this list.
  const CAPABILITY_CACHE_KEYS = [NIP45_CACHE_KEY];
  const NIP11_SNAPSHOT_KEY = "nip11_supported_nips_snapshot_v1";
  const readNip11Snapshot = (url: string): number[] | null => {
    try {
      const raw = localStorage.getItem(NIP11_SNAPSHOT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const entry = (parsed as Record<string, unknown>)[url];
      if (!Array.isArray(entry)) return null;
      return (entry as unknown[]).filter((n) => typeof n === "number") as number[];
    } catch { return null; }
  };
  const writeNip11Snapshot = (url: string, nips: number[]) => {
    try {
      const raw = localStorage.getItem(NIP11_SNAPSHOT_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const all = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, number[]>;
      all[url] = nips;
      localStorage.setItem(NIP11_SNAPSHOT_KEY, JSON.stringify(all));
    } catch {}
  };
  const clearCapabilityCachesForRelay = (url: string) => {
    for (const key of CAPABILITY_CACHE_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") continue;
        const all = parsed as Record<string, unknown>;
        if (!(url in all)) continue;
        delete all[url];
        localStorage.setItem(key, JSON.stringify(all));
      } catch {}
    }
  };
  const sortedNipList = (doc: Nip11Document | null): number[] => {
    const list = doc?.supported_nips;
    if (!Array.isArray(list)) return [];
    return list.filter((n) => typeof n === "number").slice().sort((a, b) => a - b);
  };
  const arraysEqual = (a: number[], b: number[]): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  const readNip45Cache = (url: string): boolean | null => {
    try {
      const raw = localStorage.getItem(NIP45_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const entry = (parsed as Record<string, unknown>)[url];
      if (!entry || typeof entry !== "object") return null;
      const sup = (entry as { supported?: unknown }).supported;
      return typeof sup === "boolean" ? sup : null;
    } catch { return null; }
  };
  const writeNip45Cache = (url: string, supported: boolean) => {
    try {
      const raw = localStorage.getItem(NIP45_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const all = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, { supported: boolean; ts: number }>;
      all[url] = { supported, ts: Date.now() };
      localStorage.setItem(NIP45_CACHE_KEY, JSON.stringify(all));
    } catch {}
  };
  const clearNip45Cache = (url: string) => {
    try {
      const raw = localStorage.getItem(NIP45_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const all = parsed as Record<string, { supported: boolean; ts: number }>;
      delete all[url];
      localStorage.setItem(NIP45_CACHE_KEY, JSON.stringify(all));
    } catch {}
  };
  const [nip45Supported, setNip45Supported] = useState<boolean | null>(() => readNip45Cache(relayUrl));
  // When the relay advertises NIP-45 in its NIP-11 doc, treat that as
  // authoritative and refuse to downgrade on a transient probe miss.
  const nip45StickyTrueRef = useRef<boolean>(false);
  const [healthInterval, setHealthInterval] = useState<number>(60);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<"online" | "offline" | null>(null);
  const prevLatencyStateRef = useRef<"normal" | "spike">("normal");
  const LATENCY_SPIKE_THRESHOLD = 500;
  const [storageTrends, setStorageTrends] = useState<StorageTrendEntry[]>(getStorageTrends(relayUrl));
  const [teamProfiles, setTeamProfiles] = useState<Record<string, ProfileInfo>>({});
  const [manualTeam, setManualTeam] = useState<string[]>(() => getStoredList(MANUAL_TEAM_KEY, relayUrl));
  const [newTeamMember, setNewTeamMember] = useState("");

  const loadNip11 = useCallback(async () => {
    setLoadingNip11(true);
    const doc = await fetchNip11(relayUrl);
    setNip11(doc);
    setLoadingNip11(false);
    const allTeamPubkeys: string[] = [];
    if (doc) {
      if (doc.pubkey && /^[0-9a-f]{64}$/i.test(doc.pubkey)) allTeamPubkeys.push(doc.pubkey);
      if (doc.moderators) {
        for (const m of doc.moderators) {
          if (!allTeamPubkeys.includes(m)) allTeamPubkeys.push(m);
        }
      }
    }
    const stored = getStoredList(MANUAL_TEAM_KEY, relayUrl);
    for (const pk of stored) {
      if (!allTeamPubkeys.includes(pk)) allTeamPubkeys.push(pk);
    }
    if (allTeamPubkeys.length > 0) {
      const resolved = await resolveProfileBatch(allTeamPubkeys);
      const profiles: Record<string, ProfileInfo> = {};
      resolved.forEach((p, k) => { profiles[k] = p; });
      setTeamProfiles(profiles);
    } else {
      setTeamProfiles({});
    }
  }, [relayUrl]);

  useEffect(() => {
    loadNip11();
  }, [loadNip11]);

  // Fast path: if the relay's NIP-11 doc advertises NIP-45, treat that as
  // authoritative ("sticky true") — paint the green badge immediately and
  // refuse to downgrade on a transient probe miss.
  useEffect(() => {
    if (nip11 && supportsNip(nip11, 45)) {
      nip45StickyTrueRef.current = true;
      setNip45Supported(true);
      writeNip45Cache(relayUrl, true);
    } else if (nip11) {
      nip45StickyTrueRef.current = false;
    }
  }, [nip11, relayUrl]);

  // When the operator switches relays, re-read the cache for the new relay
  // and clear stale state from the previous one.
  useEffect(() => {
    nip45StickyTrueRef.current = false;
    setNip45Supported(readNip45Cache(relayUrl));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayUrl]);

  const recheckNip45 = useCallback(() => {
    clearNip45Cache(relayUrl);
    nip45StickyTrueRef.current = false;
    setNip45Supported(null);
    fetchKindCounts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayUrl]);

  useEffect(() => {
    setAuthStatus(getAuthStatus(relayUrl).status);
    setAuthEnabledState(isAuthEnabled(relayUrl));
    setUptimeHistory(getUptimeHistory(relayUrl));
    setManualTeam(getStoredList(MANUAL_TEAM_KEY, relayUrl));
    setNewTeamMember("");
    prevStatusRef.current = null;
    prevLatencyStateRef.current = "normal";
    return onAuthChange(() => {
      setAuthStatus(getAuthStatus(relayUrl).status);
    });
  }, [relayUrl]);

  const checkConnection = useCallback(async () => {
    setConnectionStatus("checking");
    const start = Date.now();
    try {
      const ws = new WebSocket(relayUrl);
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 5000);
        ws.onopen = () => { clearTimeout(timeout); ws.close(); resolve(); };
        ws.onerror = () => { clearTimeout(timeout); reject(new Error("error")); };
      });
      const lat = Date.now() - start;
      setLatencyNow(lat);
      setConnectionStatus("online");
      const entry: UptimeEntry = { ts: Math.floor(Date.now() / 1000), latency: lat, online: true };
      addUptimeEntry(relayUrl, entry);
      setUptimeHistory(getUptimeHistory(relayUrl));
      if (prevStatusRef.current === "offline") {
        addModLogEntry(relayUrl, { action: "relay_online", note: `Back online (${lat}ms)` });
      }
      if (lat > LATENCY_SPIKE_THRESHOLD && prevLatencyStateRef.current === "normal") {
        addModLogEntry(relayUrl, { action: "relay_latency_spike", note: `${lat}ms response time` });
        prevLatencyStateRef.current = "spike";
      } else if (lat <= LATENCY_SPIKE_THRESHOLD && prevLatencyStateRef.current === "spike") {
        prevLatencyStateRef.current = "normal";
      }
      prevStatusRef.current = "online";
    } catch {
      setLatencyNow(null);
      setConnectionStatus("offline");
      const entry: UptimeEntry = { ts: Math.floor(Date.now() / 1000), latency: null, online: false };
      addUptimeEntry(relayUrl, entry);
      setUptimeHistory(getUptimeHistory(relayUrl));
      if (prevStatusRef.current === "online") {
        addModLogEntry(relayUrl, { action: "relay_offline", note: "Connection failed or timed out" });
      }
      prevStatusRef.current = "offline";
    }
  }, [relayUrl]);

  useEffect(() => {
    checkConnection();
    healthTimerRef.current = setInterval(() => {
      checkConnection();
    }, healthInterval * 1000);
    return () => {
      if (healthTimerRef.current) clearInterval(healthTimerRef.current);
    };
  }, [checkConnection, healthInterval]);

  const fetchKindCounts = useCallback(async () => {
    setLoadingCounts(true);
    const kindsToCount = [0, 1, 3, 4, 5, 6, 7, 1984, 9735, 30023];
    const entries: KindCountEntry[] = [];
    const publisherMap = new Map<string, number>();

    // Trust NIP-11 first: if the relay's NIP-11 doc advertised NIP-45, or if
    // a previous successful probe is cached, skip the initial probe entirely
    // and run the COUNT path for every kind. A transient probe miss must not
    // be allowed to silently switch us to sampled counts while the badge
    // still says "NIP-45 COUNT".
    const cachedSupport = readNip45Cache(relayUrl);
    let supportsCount: boolean;
    if (nip45StickyTrueRef.current || cachedSupport === true) {
      supportsCount = true;
    } else {
      const firstResult = await countWithNip45(relayUrl, { kinds: [0] });
      supportsCount = firstResult.supported;
    }
    setNip45Supported(supportsCount);
    writeNip45Cache(relayUrl, supportsCount);

    // Turns false the moment any probe finds the socket shut. Every count below
    // is then a number about a relay we never opened.
    let countsReached = true;

    for (const kind of kindsToCount) {
      if (supportsCount) {
        const result = await countWithNip45(relayUrl, { kinds: [kind] });
        entries.push({ kind, label: getKindLabel(kind), count: result.count ?? 0 });
        if (kind === 1 && result.count !== null) {
          const sample = await subscribeWithTimeout([relayUrl], [{ kinds: [1], limit: 100 }], 4000);
          for (const e of sample) {
            publisherMap.set(e.pubkey, (publisherMap.get(e.pubkey) || 0) + 1);
          }
        }
      } else {
        const { events, reached } = await subscribeWithReach([relayUrl], [{ kinds: [kind], limit: 100 }], 4000);
        if (!reached) countsReached = false;
        entries.push({ kind, label: getKindLabel(kind), count: events.length });
        if (kind === 1) {
          for (const e of events) {
            publisherMap.set(e.pubkey, (publisherMap.get(e.pubkey) || 0) + 1);
          }
        }
      }
    }

    const sorted = [...publisherMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pubkey, count]) => ({ pubkey, count }));
    setTopPublishers(sorted);
    if (sorted.length > 0) {
      resolveProfileBatch(sorted.map(s => s.pubkey)).then(setTopPublisherProfiles);
    }
    setKindCounts(entries);
    setCountsReached(countsReached);

    // Only record a data point we actually measured. A relay we never reached
    // counts zero of everything, and appending that to the operator's durable
    // storage history draws a cliff in the graph that never happened.
    if (countsReached) {
      const totalEvents = entries.reduce((sum, e) => sum + e.count, 0);
      const trendEntry: StorageTrendEntry = { ts: Math.floor(Date.now() / 1000), totalEvents };
      addStorageTrend(relayUrl, trendEntry);
      setStorageTrends(getStorageTrends(relayUrl));
    }

    setLoadingCounts(false);
  }, [relayUrl]);

  // Shared single-run gate for the initial capability scan; the drift
  // effect below also writes this so we don't double-scan on the same load.
  const initialScanRanRef = useRef(false);

  // Auto-invalidate per-relay capability caches when the relay's NIP-11
  // supported_nips list changes between visits. This is what lets operators
  // upgrade their relay (e.g. add NIP-45) and have the dashboard pick up
  // the new capability without anyone clicking "Recheck". Gating is based
  // on persisted snapshot state, not in-memory mount state — so on the very
  // first NIP-11 load of a fresh visit we still detect drift against what
  // was stored on the previous visit and re-probe.
  useEffect(() => {
    if (loadingNip11) return;
    if (!nip11) return;
    const newNips = sortedNipList(nip11);
    const prevNips = readNip11Snapshot(relayUrl);
    writeNip11Snapshot(relayUrl, newNips);
    // No prior persisted snapshot for this relay → first-ever observation,
    // nothing to compare against, just record the baseline.
    if (prevNips === null) return;
    if (!arraysEqual(prevNips, newNips)) {
      clearCapabilityCachesForRelay(relayUrl);
      // Preserve "trust NIP-11" semantics: if the freshly fetched doc still
      // advertises NIP-45, keep sticky-true so a transient probe miss
      // during the re-probe can't downgrade us to sampled counts.
      const stillAdvertisesNip45 = supportsNip(nip11, 45);
      if (stillAdvertisesNip45) {
        nip45StickyTrueRef.current = true;
        setNip45Supported(true);
        writeNip45Cache(relayUrl, true);
      } else {
        nip45StickyTrueRef.current = false;
        setNip45Supported(null);
      }
      // Claim the initial-scan slot so the gate effect below doesn't fire
      // a second redundant fetchKindCounts() against the same relay on the
      // same load.
      initialScanRanRef.current = true;
      fetchKindCounts();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nip11, loadingNip11, relayUrl, fetchKindCounts]);

  // Gate the initial scan on NIP-11 finishing so the "trust NIP-11 first"
  // policy actually applies on first load. Without this, fetchKindCounts
  // races loadNip11 and would always run the live probe before sticky-true
  // could be set, causing first-paint flicker / incorrect fallback state.
  useEffect(() => {
    if (loadingNip11) return;
    if (initialScanRanRef.current) return;
    initialScanRanRef.current = true;
    fetchKindCounts();
  }, [loadingNip11, fetchKindCounts]);

  // Reset the initial-scan guard when the operator switches relays so the
  // new relay also waits for its NIP-11 doc before scanning.
  useEffect(() => {
    initialScanRanRef.current = false;
  }, [relayUrl]);

  // Cancel any in-flight deep scan and rehydrate the persisted leaderboard
  // when the operator switches relays. Bumping the token invalidates any
  // in-flight scan from the previous relay so it can't apply state to the
  // new relay's view. If a snapshot exists for the new relay, paint it
  // immediately and resolve its profiles in the background — operators
  // shouldn't have to re-run the scan just to see what they had before.
  useEffect(() => {
    deepScanCancelRef.current = true;
    deepScanTokenRef.current += 1;
    setDeepScanRunning(false);
    const cached = readLeaderboardCache(relayUrl);
    if (cached && cached.entries.length > 0) {
      setTopPublishers(cached.entries.slice(0, 10));
      setDeepScanSampled(cached.sampled);
      setDeepScanOldestTs(cached.oldestTs);
      setDeepScanNewestTs(cached.newestTs);
      setDeepScanStatus(cached.status);
      setDeepScanCap(cached.cap);
      setLeaderboardSavedAt(cached.ts);
      const myToken = deepScanTokenRef.current;
      resolveProfileBatch(cached.entries.slice(0, 10).map((e) => e.pubkey)).then((profiles) => {
        if (deepScanTokenRef.current === myToken && isMountedRef.current) {
          setTopPublisherProfiles(profiles);
        }
      });
    } else {
      setDeepScanSampled(0);
      setDeepScanOldestTs(null);
      setDeepScanNewestTs(null);
      setDeepScanStatus("idle");
      setDeepScanCap(DEEP_SCAN_MAX_EVENTS);
      setLeaderboardSavedAt(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relayUrl]);

  // Cancel any in-flight deep scan on unmount so it stops poking the relay
  // and stops calling state setters on a torn-down component.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      deepScanCancelRef.current = true;
      deepScanTokenRef.current += 1;
    };
  }, []);

  const cancelDeepScan = useCallback(() => {
    deepScanCancelRef.current = true;
  }, []);

  // Walk back through kind:1 events using `until` cursor pagination to
  // assemble a publisher leaderboard from significantly more than the 100
  // events the initial scan can sample. Updates the leaderboard live as
  // each page lands so the operator can see progress, and respects a
  // cancel flag so they can abort without waiting for the cap.
  const runDeepScan = useCallback(async (maxEvents: number = DEEP_SCAN_MAX_EVENTS) => {
    if (deepScanRunning) return;
    // Snapshot the relay URL at scan start so a mid-scan relay switch can't
    // cause the in-flight loop to apply results to the wrong relay's view.
    const scanRelayUrl = relayUrl;
    // Capture this scan's token. Any relay switch / unmount / new scan
    // bumps `deepScanTokenRef.current`, which makes `isCurrent()` false
    // and gates every subsequent setter call.
    deepScanTokenRef.current += 1;
    const myToken = deepScanTokenRef.current;
    const isCurrent = () => isMountedRef.current && deepScanTokenRef.current === myToken;
    deepScanCancelRef.current = false;
    setDeepScanRunning(true);
    setDeepScanStatus("running");
    setDeepScanSampled(0);
    setDeepScanOldestTs(null);
    setDeepScanNewestTs(null);
    setDeepScanCap(maxEvents);
    setLeaderboardSavedAt(null);
    const localMap = new Map<string, number>();
    const seenIds = new Set<string>();
    let until: number | undefined = undefined;
    let totalSampled = 0;
    let oldestTs: number | null = null;
    let newestTs: number | null = null;
    let reachedEnd = false;
    while (!deepScanCancelRef.current && isCurrent() && totalSampled < maxEvents) {
      const filter: NostrFilter = { kinds: [1], limit: DEEP_SCAN_PAGE_SIZE };
      if (until !== undefined) filter.until = until;
      const events = await subscribeWithTimeout([scanRelayUrl], [filter], 6000);
      // Re-check after every await so a cancel, relay switch, or unmount
      // that landed while we were waiting on the relay aborts before we
      // touch state.
      if (!isCurrent() || deepScanCancelRef.current) break;
      if (events.length === 0) { reachedEnd = true; break; }
      let pageMinTs = Number.POSITIVE_INFINITY;
      let newThisPage = 0;
      let pageDupes = 0;
      for (const e of events) {
        if (seenIds.has(e.id)) { pageDupes++; continue; }
        seenIds.add(e.id);
        newThisPage++;
        localMap.set(e.pubkey, (localMap.get(e.pubkey) || 0) + 1);
        if (oldestTs === null || e.created_at < oldestTs) oldestTs = e.created_at;
        if (newestTs === null || e.created_at > newestTs) newestTs = e.created_at;
        if (e.created_at < pageMinTs) pageMinTs = e.created_at;
      }
      totalSampled += newThisPage;
      setDeepScanSampled(totalSampled);
      setDeepScanOldestTs(oldestTs);
      setDeepScanNewestTs(newestTs);
      const sortedLive = [...localMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([pubkey, count]) => ({ pubkey, count }));
      setTopPublishers(sortedLive);
      // Use exclusive cursor progression: NIP-01 `until` is inclusive, so
      // after seeing the oldest event at timestamp T we walk forward by
      // requesting `until = T - 1`. This avoids stalling when many events
      // share the boundary timestamp (e.g. a burst on the same second).
      if (!Number.isFinite(pageMinTs)) { reachedEnd = true; break; }
      // If the entire page was duplicates AND the relay returned a full
      // page, it likely holds many events at the boundary timestamp; step
      // back by one second to make progress instead of marking end.
      if (newThisPage === 0) {
        if (events.length >= DEEP_SCAN_PAGE_SIZE && until !== undefined) {
          until = until - 1;
          continue;
        }
        reachedEnd = true; break;
      }
      const nextUntil = pageMinTs - 1;
      if (until !== undefined && nextUntil >= until) { reachedEnd = true; break; }
      until = nextUntil;
      // Fewer events than requested → we've likely reached the end of the
      // relay's store for this kind. (Account for dupes when judging.)
      if (events.length < DEEP_SCAN_PAGE_SIZE && pageDupes === 0) { reachedEnd = true; break; }
    }
    // Token check first: if we've been superseded (relay switch or
    // unmount), exit silently — the supersedng effect already reset state.
    if (!isCurrent()) return;
    // Persist whatever leaderboard we have to localStorage so reopening
    // the tab paints it instantly. We persist top 100 entries (the UI
    // shows top 10) so future "show more" affordances can use the rest
    // without rescanning. We persist on cancel too — a partial result is
    // still better than nothing on next visit.
    const persist = (
      status: "completed" | "cancelled" | "capped",
      entries: Array<{ pubkey: string; count: number }>,
    ) => {
      if (entries.length === 0) return;
      writeLeaderboardCache(scanRelayUrl, {
        entries: entries.slice(0, 100),
        sampled: totalSampled,
        oldestTs,
        newestTs,
        status,
        cap: maxEvents,
        ts: Date.now(),
      });
    };

    // User-initiated cancel: bail out without overwriting any further
    // state. The leaderboard already reflects the partial scan and the
    // status badge will show "Cancelled — partial result".
    if (deepScanCancelRef.current) {
      const cancelledTop100 = [...localMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 100)
        .map(([pubkey, count]) => ({ pubkey, count }));
      persist("cancelled", cancelledTop100);
      setLeaderboardSavedAt(Date.now());
      setDeepScanRunning(false);
      setDeepScanStatus("cancelled");
      return;
    }
    const finalSortedTop100 = [...localMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([pubkey, count]) => ({ pubkey, count }));
    const finalSorted = finalSortedTop100.slice(0, 10);
    // Only overwrite the leaderboard if the deep scan produced data. If it
    // somehow finished with zero new events, keep whatever the initial
    // sample showed so the card (and its Deep Scan controls) stay visible.
    if (finalSorted.length > 0) {
      setTopPublishers(finalSorted);
      resolveProfileBatch(finalSorted.map((s) => s.pubkey)).then((profiles) => {
        if (isCurrent()) setTopPublisherProfiles(profiles);
      });
    }
    const finalStatus: "completed" | "capped" = reachedEnd ? "completed" : "capped";
    persist(finalStatus, finalSortedTop100);
    setLeaderboardSavedAt(Date.now());
    setDeepScanStatus(finalStatus);
    setDeepScanRunning(false);
  }, [relayUrl, deepScanRunning]);

  const handleCopy = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const toggleAuth = useCallback(() => {
    const newState = !authEnabled;
    setAuthEnabledState(newState);
    setAuthEnabled(relayUrl, newState);
    toast({
      title: newState ? "NIP-42 Auth enabled" : "NIP-42 Auth disabled",
      description: newState ? "Will auto-respond to AUTH challenges." : "AUTH challenges will be ignored.",
    });
  }, [authEnabled, relayUrl, toast]);

  const softwareDisplay = nip11 ? getSoftwareDisplay(nip11) : null;
  const hasNip42 = nip11 ? supportsNip(nip11, 42) : false;

  const uptimeChartData = uptimeHistory.slice(-30).map((e) => ({
    time: new Date(e.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    latency: e.latency,
    online: e.online ? 1 : 0,
  }));

  const kindChartData = kindCounts.filter(k => k.count > 0).map(k => ({
    name: k.label,
    count: k.count,
  }));

  const storageTrendData = storageTrends.slice(-20).map((e) => ({
    time: new Date(e.ts * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    events: e.totalEvents,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="glass-card border-border dark:border-brand/15 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-3.5 h-3.5 text-brand dark:text-brand/80" />
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Status</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${connectionStatus === "online" ? "bg-green-400 animate-pulse" : connectionStatus === "offline" ? "bg-red-400" : "bg-yellow-400 animate-pulse"}`} />
            <span className={`text-sm font-mono ${connectionStatus === "online" ? "text-green-600 dark:text-green-400" : connectionStatus === "offline" ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"}`}>
              {connectionStatus === "checking" ? "Checking..." : connectionStatus === "online" ? "Online" : "Offline"}
            </span>
          </div>
        </Card>
        <Card className="glass-card border-border dark:border-brand/15 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-3.5 h-3.5 text-brand dark:text-brand/80" />
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Latency</span>
          </div>
          <span className="text-sm font-mono text-brand">{latencyNow != null ? `${latencyNow}ms` : "—"}</span>
        </Card>
        <Card className="glass-card border-border dark:border-brand/15 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-3.5 h-3.5 text-brand dark:text-brand/80" />
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Auth</span>
          </div>
          <AuthStatusBadge status={authStatus} />
        </Card>
        <Card className="glass-card border-border dark:border-brand/15 p-3">
          <div className="flex items-center gap-2 mb-1">
            <Server className="w-3.5 h-3.5 text-brand dark:text-brand/80" />
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Software</span>
          </div>
          <span className="text-sm font-mono text-brand truncate block">{softwareDisplay || "—"}</span>
        </Card>
      </div>

      {inbox && <FeedbackSummaryCard inbox={inbox} onOpenFeedback={onOpenFeedback} />}

      <OpsCard>
        <div className="flex flex-col gap-2 mb-3">
          <OpsSectionHeader
            icon={Activity}
            label="Uptime & Health"
            className="mb-0"
            action={
              <>
                <Select value={String(healthInterval)} onValueChange={(v) => setHealthInterval(Number(v))}>
                  <SelectTrigger className="w-[70px] sm:w-24 h-7 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30s</SelectItem>
                    <SelectItem value="60">1 min</SelectItem>
                    <SelectItem value="300">5 min</SelectItem>
                    <SelectItem value="900">15 min</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" className="text-[10px] h-7 sm:h-6 px-2 shrink-0" onClick={checkConnection} aria-label="Check connection now">
                  <RefreshCw className="w-3 h-3 sm:mr-1" /><span className="hidden sm:inline">Check Now</span>
                </Button>
              </>
            }
          />
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] border-border dark:border-white/10 text-muted-foreground/60">
              {uptimeHistory.filter(e => e.online).length}/{uptimeHistory.length} online
            </Badge>
            {(() => {
              const recent = uptimeHistory.slice(-5);
              const recentDown = recent.filter(e => !e.online).length;
              if (recentDown >= 2) return <Badge variant="outline" className="text-[10px] border-red-400/40 dark:border-red-400/30 text-red-600/80 dark:text-red-400/70 animate-pulse">Downtime detected</Badge>;
              if (recentDown === 1) return <Badge variant="outline" className="text-[10px] border-amber-400/30 dark:border-amber-400/20 text-amber-600 dark:text-amber-400/70">Intermittent</Badge>;
              return recent.length > 0 ? <Badge variant="outline" className="text-[10px] border-green-400/25 dark:border-green-400/15 text-green-700 dark:text-green-400/70">Stable</Badge> : null;
            })()}
          </div>
        </div>
        {uptimeChartData.length > 1 ? (
          <div className="w-full h-32 sm:h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={uptimeChartData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
                <XAxis dataKey="time" tick={{ fill: "rgba(168,85,247,0.5)", fontSize: 9 }} />
                <YAxis tick={{ fill: "rgba(168,85,247,0.4)", fontSize: 9 }} width={35} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="latency" name="Latency (ms)" stroke="#a855f7" strokeWidth={2} dot={{ r: 2, fill: "#a855f7" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground/60">Health checks run automatically every {healthInterval}s. Data will appear after multiple checks.</p>
        )}
      </OpsCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <OpsCard className="flex flex-col">
          <OpsSectionHeader
            icon={Info}
            label="Relay Information"
            action={
              <Button variant="ghost" size="sm" className="text-[10px] h-7 sm:h-6 px-2 shrink-0" onClick={loadNip11} aria-label="Refresh relay information">
                <RefreshCw className="w-3 h-3 sm:mr-1" /><span className="hidden sm:inline">Refresh</span>
              </Button>
            }
          >
            {loadingNip11 && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground/70" />}
          </OpsSectionHeader>
          {nip11 ? (
            <div className="space-y-2">
              {nip11.name && (
                <div className="flex items-start gap-2">
                  <Server className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Name</span>
                    <span className="text-xs text-foreground">{nip11.name}</span>
                  </div>
                </div>
              )}
              {nip11.description && (
                <div className="flex items-start gap-2">
                  <Info className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Description</span>
                    <span className="text-xs text-muted-foreground/80">{nip11.description}</span>
                  </div>
                </div>
              )}
              {softwareDisplay && (
                <div className="flex items-start gap-2">
                  <Code className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Software</span>
                    <span className="text-xs font-mono text-brand dark:text-brand/70">{softwareDisplay}</span>
                  </div>
                </div>
              )}
              {nip11.contact && (
                <div className="flex items-start gap-2">
                  <Mail className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div className="flex items-center gap-1">
                    <div>
                      <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Contact</span>
                      <span className="text-xs text-muted-foreground/80">{nip11.contact}</span>
                    </div>
                    <button className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground/60 transition-colors" onClick={() => handleCopy(nip11.contact!, "contact")} aria-label="Copy contact">
                      {copiedField === "contact" ? <Check className="w-2 h-2 text-green-800/70 dark:text-green-400/70" /> : <Copy className="w-2 h-2" />}
                    </button>
                  </div>
                </div>
              )}
              {nip11.pubkey && !nip11.moderators?.length && (
                <div className="flex items-start gap-2">
                  <Shield className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div className="flex items-center gap-1">
                    <div>
                      <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Operator Pubkey</span>
                      <span className="text-xs font-mono text-muted-foreground/70 truncate max-w-[200px] block">{nip11.pubkey}</span>
                    </div>
                    <button className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/50 hover:text-muted-foreground/60 transition-colors" onClick={() => handleCopy(nip11.pubkey!, "pubkey")} aria-label="Copy pubkey">
                      {copiedField === "pubkey" ? <Check className="w-2 h-2 text-green-800/70 dark:text-green-400/70" /> : <Copy className="w-2 h-2" />}
                    </button>
                  </div>
                </div>
              )}
              {nip11.supported_nips && nip11.supported_nips.length > 0 && (
                <div className="flex items-start gap-2">
                  <Hash className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Supported NIPs <span className="normal-case tracking-normal text-muted-foreground/50">(relay protocol capabilities)</span></span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {nip11.supported_nips.map(nip => (
                        <Badge key={nip} variant="outline" className="text-[10px] border-border dark:border-brand/15 text-brand dark:text-brand/70 px-1 py-0">{nip}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {nip11.blossom_servers && nip11.blossom_servers.length > 0 && (
                <div className="flex items-start gap-2">
                  <Package className="w-3 h-3 text-emerald-500/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Blossom Media Servers</span>
                    <div className="space-y-1 mt-1">
                      {nip11.blossom_servers.map((server) => {
                        let hostname = server;
                        try { hostname = new URL(server).hostname; } catch {}
                        return (
                          <div key={server} className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 shrink-0" />
                            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400/80">{hostname}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground/50 mt-1">Uploads from this community are stored on the relay's Blossom server.</p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-2">
                <FileText className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                <div>
                  <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Accepted Event Kinds</span>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 mb-1.5 leading-relaxed">Content types this relay stores when published from Relay Outpost</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1">
                    {[
                      { kind: 0, label: "Profiles", nip: "NIP-01" },
                      { kind: 1, label: "Short Notes", nip: "NIP-01" },
                      { kind: 3, label: "Contacts", nip: "NIP-02" },
                      { kind: 6, label: "Reposts", nip: "NIP-18" },
                      { kind: 7, label: "Reactions", nip: "NIP-25" },
                      { kind: 10002, label: "Relay Lists", nip: "NIP-65" },
                      { kind: 10003, label: "Bookmarks", nip: "NIP-51" },
                      { kind: 30023, label: "Long-form Articles", nip: "NIP-23" },
                      { kind: 30078, label: "App Data", nip: "NIP-78" },
                      { kind: 30311, label: "Live Streams", nip: "NIP-53" },
                      { kind: 31337, label: "Audio Tracks", nip: "NIP-31" },
                    ].map(({ kind, label, nip }) => (
                      <span key={kind} className="text-[10px] text-muted-foreground/60">
                        <span className="text-brand dark:text-brand/70 font-mono">{kind}</span>{" "}
                        {label}{" "}
                        <span className="text-muted-foreground/50">{nip}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {nip11.limitation && (
                <div className="flex items-start gap-2">
                  <Layers className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Limitations</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                      {nip11.limitation.max_message_length != null && (
                        <span className="text-[10px] text-muted-foreground/60">Max msg: <span className="text-brand dark:text-brand/70 font-mono">{nip11.limitation.max_message_length.toLocaleString()}</span></span>
                      )}
                      {nip11.limitation.max_subscriptions != null && (
                        <span className="text-[10px] text-muted-foreground/60">Max subs: <span className="text-brand dark:text-brand/70 font-mono">{nip11.limitation.max_subscriptions}</span></span>
                      )}
                      {nip11.limitation.max_content_length != null && (
                        <span className="text-[10px] text-muted-foreground/60">Max content: <span className="text-brand dark:text-brand/70 font-mono">{nip11.limitation.max_content_length.toLocaleString()}</span></span>
                      )}
                      {nip11.limitation.max_event_tags != null && (
                        <span className="text-[10px] text-muted-foreground/60">Max tags: <span className="text-brand dark:text-brand/70 font-mono">{nip11.limitation.max_event_tags}</span></span>
                      )}
                      {nip11.limitation.auth_required != null && (
                        <span className="text-[10px] text-muted-foreground/60">Auth required: <span className={`font-mono ${nip11.limitation.auth_required ? "text-amber-600 dark:text-amber-400/70" : "text-green-600 dark:text-green-400/70"}`}>{nip11.limitation.auth_required ? "Yes" : "No"}</span></span>
                      )}
                      {nip11.limitation.payment_required != null && (
                        <span className="text-[10px] text-muted-foreground/60">Payment required: <span className={`font-mono ${nip11.limitation.payment_required ? "text-amber-600 dark:text-amber-400/70" : "text-green-600 dark:text-green-400/70"}`}>{nip11.limitation.payment_required ? "Yes" : "No"}</span></span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {nip11.relay_countries && nip11.relay_countries.length > 0 && (
                <div className="flex items-start gap-2">
                  <Globe className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Countries</span>
                    <span className="text-xs text-muted-foreground/70">{nip11.relay_countries.join(", ")}</span>
                  </div>
                </div>
              )}
              {nip11.language_tags && nip11.language_tags.length > 0 && (
                <div className="flex items-start gap-2">
                  <Languages className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Languages</span>
                    <span className="text-xs text-muted-foreground/70">{nip11.language_tags.join(", ")}</span>
                  </div>
                </div>
              )}
              {nip11.tags && nip11.tags.length > 0 && (
                <div className="flex items-start gap-2">
                  <Tag className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Tags</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {nip11.tags.map(tag => (
                        <Badge key={tag} variant="outline" className="text-[10px] border-border dark:border-brand/15 text-brand dark:text-brand/70 px-1 py-0">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {nip11.posting_policy && (
                <div className="flex items-start gap-2">
                  <FileCheck className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Posting Policy</span>
                    {/^https?:\/\//i.test(nip11.posting_policy) ? (
                      <a href={nip11.posting_policy} target="_blank" rel="noopener noreferrer" className="text-xs text-brand dark:text-brand/80 hover:underline flex items-center gap-1">
                        {(() => { try { return new URL(nip11.posting_policy).hostname; } catch { return nip11.posting_policy; } })()}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground/70">{nip11.posting_policy}</span>
                    )}
                  </div>
                </div>
              )}
              {nip11.payments_url && (
                <div className="flex items-start gap-2">
                  <CreditCard className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Payments</span>
                    {/^https?:\/\//i.test(nip11.payments_url) ? (
                      <a href={nip11.payments_url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand dark:text-brand/80 hover:underline flex items-center gap-1">
                        {(() => { try { return new URL(nip11.payments_url).hostname; } catch { return nip11.payments_url; } })()}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground/70">{nip11.payments_url}</span>
                    )}
                  </div>
                </div>
              )}
              {nip11.fees && (
                <div className="flex items-start gap-2">
                  <Zap className="w-3 h-3 text-amber-500/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Fees</span>
                    <div className="space-y-0.5 mt-0.5">
                      {nip11.fees.admission && nip11.fees.admission.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60 block">Admission: {nip11.fees.admission.map(f => `${f.amount} ${f.unit}`).join(", ")}</span>
                      )}
                      {nip11.fees.subscription && nip11.fees.subscription.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60 block">Subscription: {nip11.fees.subscription.map(f => `${f.amount} ${f.unit} / ${f.period}s`).join(", ")}</span>
                      )}
                      {nip11.fees.publication && nip11.fees.publication.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60 block">Publication: {nip11.fees.publication.map(f => `${f.amount} ${f.unit}`).join(", ")}</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {nip11.retention && nip11.retention.length > 0 && (
                <div className="flex items-start gap-2">
                  <Database className="w-3 h-3 text-muted-foreground/70 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide block">Retention Policy</span>
                    <div className="space-y-0.5 mt-0.5">
                      {nip11.retention.map((r, i) => {
                        const kindStr = r.kinds ? `Kinds ${r.kinds.join(", ")}` : "All kinds";
                        const timeStr = r.time === null ? "forever" : r.time ? `${Math.round(r.time / 86400)}d` : undefined;
                        const countStr = r.count ? `max ${r.count}` : undefined;
                        const detail = [timeStr, countStr].filter(Boolean).join(", ") || "stored";
                        return (
                          <span key={i} className="text-[10px] text-muted-foreground/60 block">{kindStr}: {detail}</span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : loadingNip11 ? (
            <div className="flex items-center gap-2 py-4">
              <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground/70" />
              <span className="text-xs text-muted-foreground/70">Fetching relay information...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-4">
              <AlertTriangle className="w-3 h-3 text-amber-700 dark:text-amber-400/70" />
              <span className="text-xs text-muted-foreground/70">Could not fetch NIP-11 document</span>
              <Button variant="ghost" size="sm" className="text-[10px] h-5" onClick={loadNip11}>Retry</Button>
            </div>
          )}
        </OpsCard>

        <div className="flex flex-col gap-4">
          <OpsCard className="flex-1 flex flex-col justify-center">
            <OpsSectionHeader
              icon={Lock}
              label="NIP-42 Auth"
              className="mb-2"
              action={
                <Button
                  variant={authEnabled ? "default" : "ghost"}
                  size="sm"
                  onClick={toggleAuth}
                  className={`text-[10px] sm:text-[11px] h-6 shrink-0 ${authEnabled ? "bg-accent text-accent-foreground dark:text-brand hover:bg-brand/30 border border-brand/20" : ""}`}
                >
                  {authEnabled ? <><Lock className="w-2.5 h-2.5 mr-1" />Enabled</> : <><Unlock className="w-2.5 h-2.5 mr-1" />Disabled</>}
                </Button>
              }
            >
              {hasNip42 && <Badge variant="outline" className="text-[10px] border-green-400/25 dark:border-green-400/15 text-green-700 dark:text-green-400/70">Supported</Badge>}
            </OpsSectionHeader>
            <p className="text-[10px] text-muted-foreground/60">
              {authEnabled ? "Auto-responds to AUTH challenges from this relay." : "Enable to auto-authenticate with this relay."}
            </p>
          </OpsCard>

          <OpsCard className="flex-1 flex flex-col">
            <OpsSectionHeader
              icon={Activity}
              label="Event Analytics"
              action={
                <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2 shrink-0" onClick={fetchKindCounts} disabled={loadingCounts}>
                  <RefreshCw className={`w-3 h-3 mr-1 ${loadingCounts ? "animate-spin" : ""}`} />Scan
                </Button>
              }
            >
              {nip45Supported === true && (
                <Badge variant="outline" className="text-[10px] border-green-400/25 dark:border-green-400/15 text-green-700 dark:text-green-400/70" title="Relay supports NIP-45 COUNT — exact totals.">NIP-45 COUNT</Badge>
              )}
              {nip45Supported === false && (
                <>
                  <Badge variant="outline" className="text-[10px] border-amber-400/25 dark:border-amber-400/15 text-amber-700 dark:text-amber-400/70" title="Relay didn't respond to COUNT — using a 100-event sample.">Sample fallback</Badge>
                  <Button variant="ghost" size="sm" className="text-[10px] h-5 px-1.5 shrink-0 text-amber-700/80 dark:text-amber-400/70 hover:text-amber-700 dark:hover:text-amber-300" onClick={recheckNip45} disabled={loadingCounts} title="Re-probe NIP-45 capability">
                    Recheck
                  </Button>
                </>
              )}
            </OpsSectionHeader>
            {!countsReached && (
              <p className="text-[10px] text-red-700/80 dark:text-red-400/70 mb-2">Couldn't reach this relay on the last scan — the counts below are not a measurement of what it holds.</p>
            )}
            {nip45Supported === false && countsReached && kindCounts.length > 0 && (
              <p className="text-[10px] text-amber-700/80 dark:text-amber-400/60 mb-2">Relay didn't respond to COUNT — counts shown are sampled estimates (up to 100 per kind). Use Recheck after a relay upgrade.</p>
            )}
            {kindCounts.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {kindCounts.map((k) => (
                  <div key={k.kind} className="flex items-center justify-between rounded-md bg-muted dark:bg-white/[0.02] border border-border dark:border-white/[0.06] px-2 py-1">
                    <span className="text-[10px] text-muted-foreground/60">{k.label}</span>
                    <span className={`text-[10px] font-mono ${k.count > 0 ? "text-brand dark:text-brand/70" : "text-muted-foreground/50"}`}>
                      {nip45Supported ? k.count.toLocaleString() : `~${k.count}`}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground/60">Click "Scan" to count events by kind. Uses NIP-45 COUNT when supported, falls back to sampling.</p>
            )}
          </OpsCard>

          {(() => {
            const nip11Pubkeys: string[] = [];
            if (nip11?.pubkey && /^[0-9a-f]{64}$/i.test(nip11.pubkey)) nip11Pubkeys.push(nip11.pubkey);
            if (nip11?.moderators) {
              for (const m of nip11.moderators) {
                if (!nip11Pubkeys.includes(m)) nip11Pubkeys.push(m);
              }
            }
            const teamPubkeys = [...nip11Pubkeys];
            for (const pk of manualTeam) {
              if (!teamPubkeys.includes(pk)) teamPubkeys.push(pk);
            }

            const handleAddTeamMember = async () => {
              const input = newTeamMember.trim();
              if (!input) return;
              let hex = input;
              if (input.startsWith("npub1")) {
                try {
                  const decoded = nip19.decode(input);
                  if (decoded.type === "npub") hex = decoded.data;
                } catch {
                  toast({ title: "Invalid npub", description: "Could not decode the npub.", variant: "destructive" });
                  return;
                }
              }
              if (!/^[0-9a-f]{64}$/i.test(hex)) {
                toast({ title: "Invalid pubkey", description: "Enter a valid hex pubkey or npub.", variant: "destructive" });
                return;
              }
              if (teamPubkeys.includes(hex)) {
                toast({ title: "Already on team", description: "This pubkey is already in the team list." });
                setNewTeamMember("");
                return;
              }
              const updated = [...manualTeam, hex];
              setManualTeam(updated);
              saveStoredList(MANUAL_TEAM_KEY, relayUrl, updated);
              setNewTeamMember("");
              toast({ title: "Team member added", description: `${hex.slice(0, 8)}... added to relay team.` });
              const resolved = await resolveProfileBatch([hex]);
              if (resolved.size > 0) {
                setTeamProfiles(prev => {
                  const next = { ...prev };
                  resolved.forEach((p, k) => { next[k] = p; });
                  return next;
                });
              }
            };

            const handleRemoveTeamMember = (hex: string) => {
              const updated = manualTeam.filter(pk => pk !== hex);
              setManualTeam(updated);
              saveStoredList(MANUAL_TEAM_KEY, relayUrl, updated);
              toast({ title: "Team member removed", description: `${hex.slice(0, 8)}... removed from relay team.` });
            };

            return (
              <OpsCard className="flex-1 flex flex-col">
                <OpsSectionHeader icon={Users} label="Relay Team" className="mb-2">
                  {teamPubkeys.length > 0 && (
                    <Badge variant="outline" className="text-[10px] border-border dark:border-brand/15 text-brand dark:text-brand/70 px-1 py-0">{teamPubkeys.length}</Badge>
                  )}
                </OpsSectionHeader>
                {teamPubkeys.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {teamPubkeys.map((hex) => {
                      const profile = teamProfiles[hex];
                      const npub = pubkeyToNpub(hex);
                      const isOperator = hex === nip11?.pubkey;
                      const isMod = nip11Pubkeys.includes(hex) && !isOperator;
                      const isManual = manualTeam.includes(hex);
                      return (
                        <div key={hex} className="flex items-center gap-2 sm:gap-2.5 rounded-md bg-muted dark:bg-white/[0.02] border border-border dark:border-white/[0.06] px-2 sm:px-2.5 py-1.5 sm:py-2">
                          <Avatar className="w-7 h-7 sm:w-8 sm:h-8 shrink-0">
                            {profile?.picture ? <AvatarImage src={profile.picture} alt={profile.name || ""} /> : null}
                            <AvatarFallback className="bg-accent text-brand text-[10px]">
                              <User className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs sm:text-sm font-medium text-foreground truncate block">
                              {profile?.name || `${npub.slice(0, 12)}...${npub.slice(-4)}`}
                            </span>
                            {profile?.nip05 && (
                              <span className="text-[10px] sm:text-[10px] text-muted-foreground/60 block truncate">{profile.nip05}</span>
                            )}
                          </div>
                          <Badge variant="outline" className={`text-[10px] sm:text-[10px] px-1 sm:px-1.5 py-0 shrink-0 ${isOperator ? "border-cyan-400/30 dark:border-cyan-400/20 text-cyan-700 dark:text-cyan-300/70" : isMod ? "border-border dark:border-brand/20 text-brand dark:text-brand/70" : "border-border dark:border-brand/20 text-brand dark:text-brand/70"}`}>
                            {isOperator ? "Operator" : isMod ? "Mod" : "Manual"}
                          </Badge>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7" onClick={() => { copyNostrId(npub); setCopiedField(hex); setTimeout(() => setCopiedField(null), 2000); toast({ title: "Copied", description: "npub copied to clipboard." }); }}>
                              {copiedField === hex ? <Check className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-green-500" /> : <Copy className="w-2.5 h-2.5 sm:w-3 sm:h-3" />}
                            </Button>
                            {isManual && !isOperator && !isMod && (
                              <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7 text-muted-foreground/50 hover:text-red-700 dark:hover:text-red-400" onClick={() => handleRemoveTeamMember(hex)}>
                                <X className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Add member (npub or hex)..."
                    value={newTeamMember}
                    onChange={e => setNewTeamMember(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddTeamMember(); }}
                    className="flex-1 min-w-0 bg-muted dark:bg-white/[0.03] border border-border dark:border-white/[0.06] rounded px-2 py-1 text-[11px] sm:text-xs placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
                  />
                  <Button variant="ghost" size="icon" className="h-6 w-6 sm:h-7 sm:w-7 shrink-0 text-brand hover:text-brand" onClick={handleAddTeamMember} disabled={!newTeamMember.trim()}>
                    <Plus className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  </Button>
                </div>
              </OpsCard>
            );
          })()}
        </div>
      </div>

      {kindChartData.length > 0 && (
        <OpsCard>
          <OpsSectionHeader icon={Activity} label="Event Distribution" />
          <div className="w-full h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kindChartData} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
                <XAxis dataKey="name" tick={{ fill: "rgba(168,85,247,0.5)", fontSize: 9 }} angle={-25} textAnchor="end" interval={0} />
                <YAxis tick={{ fill: "rgba(168,85,247,0.4)", fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Events Sampled" radius={[4, 4, 0, 0]}>
                  {kindChartData.map((_, idx) => (
                    <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </OpsCard>
      )}

      {topPublishers.length > 0 && (
        <OpsCard>
          <div className="flex flex-col gap-2 mb-3">
            <OpsSectionHeader
              icon={UserCheck}
              label={<>Top Publishers {deepScanSampled === 0 && "(from sample)"}</>}
              className="mb-0"
              action={
                deepScanRunning ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[10px] h-6 px-2 text-amber-600 dark:text-amber-400"
                    onClick={cancelDeepScan}
                    aria-label="Cancel deep scan"
                  >
                    <X className="w-3 h-3 mr-1" />Cancel
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] h-6 px-2"
                      onClick={() => runDeepScan(DEEP_SCAN_MAX_EVENTS)}
                      aria-label="Run deep scan"
                      title={`Walk back through up to ${DEEP_SCAN_MAX_EVENTS.toLocaleString()} kind:1 events to build a more accurate leaderboard.`}
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      {deepScanStatus !== "idle" || deepScanSampled > 0 ? "Re-run scan" : "Deep scan"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] h-6 px-2 text-muted-foreground/70 hover:text-foreground"
                      onClick={() => runDeepScan(DEEP_SCAN_DEEPER_MAX_EVENTS)}
                      aria-label="Scan deeper"
                      title={`Walk back through up to ${DEEP_SCAN_DEEPER_MAX_EVENTS.toLocaleString()} kind:1 events. Slower, but the leaderboard will reflect a much longer window.`}
                    >
                      Scan deeper
                    </Button>
                  </>
                )
              }
            />
            {(deepScanRunning || deepScanSampled > 0) && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] border-border dark:border-brand/15 text-brand dark:text-brand/70">
                  {deepScanSampled.toLocaleString()} events sampled
                </Badge>
                {deepScanOldestTs !== null && deepScanNewestTs !== null && (
                  <Badge variant="outline" className="text-[10px] border-border dark:border-white/10 text-muted-foreground/70">
                    Window: {new Date(deepScanOldestTs * 1000).toLocaleDateString()} → {new Date(deepScanNewestTs * 1000).toLocaleDateString()}
                  </Badge>
                )}
                {deepScanStatus === "running" && (
                  <Badge variant="outline" className="text-[10px] border-amber-400/25 dark:border-amber-400/15 text-amber-700 dark:text-amber-400/70">
                    Scanning…
                  </Badge>
                )}
                {deepScanStatus === "capped" && (
                  deepScanCap >= DEEP_SCAN_DEEPER_MAX_EVENTS ? (
                    <Badge variant="outline" className="text-[10px] border-border dark:border-white/10 text-muted-foreground/70" title={`Stopped at the ${deepScanCap.toLocaleString()}-event safety cap.`}>
                      Stopped at {deepScanCap.toLocaleString()}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-border dark:border-white/10 text-muted-foreground/70" title={`Stopped at ${deepScanCap.toLocaleString()} — use Scan deeper to walk back further.`}>
                      Stopped at {deepScanCap.toLocaleString()} — Scan deeper for more
                    </Badge>
                  )
                )}
                {deepScanStatus === "completed" && (
                  <Badge variant="outline" className="text-[10px] border-green-400/25 dark:border-green-400/15 text-green-700 dark:text-green-400/70">
                    Reached end of relay store
                  </Badge>
                )}
                {deepScanStatus === "cancelled" && (
                  <Badge variant="outline" className="text-[10px] border-border dark:border-white/10 text-muted-foreground/70">
                    Cancelled — partial result
                  </Badge>
                )}
              </div>
            )}
            {!deepScanRunning && leaderboardSavedAt !== null && deepScanSampled > 0 && (
              <p className="text-[10px] text-muted-foreground/60 leading-snug">
                As of {formatRelativeMs(leaderboardSavedAt)}
                {" · "}
                {deepScanSampled.toLocaleString()} event{deepScanSampled === 1 ? "" : "s"} scanned
                {deepScanOldestTs !== null && deepScanNewestTs !== null && (
                  <>
                    {" · "}
                    {new Date(deepScanOldestTs * 1000).toLocaleDateString()} → {new Date(deepScanNewestTs * 1000).toLocaleDateString()}
                  </>
                )}
              </p>
            )}
          </div>
          <div className="space-y-1">
            {topPublishers.map((pub, i) => (
              <div key={pub.pubkey} className="flex items-center justify-between rounded-md bg-muted dark:bg-white/[0.02] border border-border dark:border-white/[0.06] px-2 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-muted-foreground/60 w-4 text-right shrink-0">{i + 1}.</span>
                  <ProfileName pubkey={pub.pubkey} profiles={topPublisherProfiles} showCopy />
                </div>
                <Badge variant="outline" className="text-[10px] border-border dark:border-brand/15 text-brand dark:text-brand/70 shrink-0 ml-2">{pub.count} notes</Badge>
              </div>
            ))}
          </div>
        </OpsCard>
      )}

      <OpsCard>
        <OpsSectionHeader
          icon={Layers}
          label="Storage Growth"
          action={
            <Button variant="ghost" size="sm" className="text-[10px] h-6 px-2 shrink-0" onClick={fetchKindCounts} disabled={loadingCounts}>
              <RefreshCw className={`w-3 h-3 mr-1 ${loadingCounts ? "animate-spin" : ""}`} />Scan
            </Button>
          }
        >
          {storageTrends.length > 0 && (
            <Badge variant="outline" className="text-[10px] border-border dark:border-white/10 text-muted-foreground/60">
              {storageTrends.length} snapshot{storageTrends.length !== 1 ? "s" : ""}
            </Badge>
          )}
          {nip45Supported === false && kindCounts.length > 0 && (
            <Badge variant="outline" className="text-[10px] border-amber-400/25 dark:border-amber-400/15 text-amber-700 dark:text-amber-400/70" title="Relay didn't respond to COUNT — totals are sampled estimates.">Estimated — sample fallback</Badge>
          )}
        </OpsSectionHeader>
        {storageTrendData.length > 1 ? (
          <>
            <div className="w-full h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={storageTrendData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
                  <XAxis dataKey="time" tick={{ fill: "rgba(168,85,247,0.5)", fontSize: 9 }} />
                  <YAxis tick={{ fill: "rgba(168,85,247,0.4)", fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="events" name="Total Events" stroke="#c084fc" strokeWidth={2} dot={{ r: 2, fill: "#c084fc" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Each data point is recorded when you scan. Run scans periodically to track growth over time.</p>
          </>
        ) : storageTrendData.length === 1 ? (
          <div className="text-center py-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-border flex items-center justify-center mx-auto mb-2">
              <Activity className="w-4 h-4 text-brand" />
            </div>
            <p className="text-xs text-muted-foreground/60 font-medium">{storageTrendData[0].events.toLocaleString()} events recorded</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Run another scan later to start tracking growth over time.</p>
          </div>
        ) : (
          <div className="text-center py-6">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-border flex items-center justify-center mx-auto mb-2">
              <Layers className="w-4 h-4 text-brand" />
            </div>
            <p className="text-xs text-muted-foreground/60 font-medium">No data yet</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Click Scan to take your first snapshot and start tracking relay growth.</p>
          </div>
        )}
      </OpsCard>
    </div>
  );
}
