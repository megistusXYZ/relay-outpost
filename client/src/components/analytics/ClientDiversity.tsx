import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Event } from "nostr-tools";
import { DEFAULT_RELAYS, pool, fetchProfilesCached, filterBlockedRelays } from "@/lib/nostr";
import { getOutpostRelays, getActiveDefaultRelays } from "@/lib/outpost-relays";
import { getHealthyRelays, markRelaySuccess } from "@/lib/relay-health";
import { throttledSubscribe } from "@/lib/relay-throttler";
import { ProfileLink } from "@/components/analytics/ProfileLink";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue } from "@/components/ui/select";
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend } from "recharts";
import {
  Play,
  Smartphone,
  Users,
  BarChart3,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Search,
  Radio,
  Globe,
  Filter } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const CHART_COLORS = [
  "#8b5cf6", "#a78bfa", "#7c3aed", "#6d28d9", "#c4b5fd",
  "#ddd6fe", "#5b21b6", "#4c1d95", "#ede9fe", "#f5f3ff",
];

const TIME_RANGES = [
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 6 * 3600 },
  { label: "24h", seconds: 86400 },
  { label: "7d", seconds: 7 * 86400 },
  { label: "30d", seconds: 30 * 86400 },
];

const KNOWN_CLIENTS: { id: string; label: string; tags: string[] }[] = [
  { id: "damus", label: "Damus", tags: ["damus", "Damus", "damus ios", "Damus iOS"] },
  { id: "amethyst", label: "Amethyst", tags: ["amethyst", "Amethyst"] },
  { id: "primal", label: "Primal", tags: ["primal", "Primal", "primal web app", "primal ios", "primal android", "Primal Web App", "Primal iOS", "Primal Android"] },
  { id: "snort", label: "Snort", tags: ["snort", "Snort", "snort.social"] },
  { id: "coracle", label: "Coracle", tags: ["coracle", "Coracle"] },
  { id: "nostrudel", label: "noStrudel", tags: ["nostrudel", "noStrudel", "nostrudel.ninja"] },
  { id: "yakihonne", label: "Yakihonne", tags: ["yakihonne", "Yakihonne", "YakiHonne"] },
  { id: "nostur", label: "Nostur", tags: ["nostur", "Nostur"] },
  { id: "nos", label: "Nos", tags: ["nos", "Nos", "nos.social"] },
  { id: "iris", label: "Iris", tags: ["iris", "Iris", "iris.to"] },
  { id: "gossip", label: "Gossip", tags: ["gossip", "Gossip"] },
  { id: "lume", label: "Lume", tags: ["lume", "Lume"] },
  { id: "spring", label: "Spring", tags: ["spring", "Spring", "spring.site"] },
  { id: "0xchat", label: "0xChat", tags: ["0xchat", "0xChat"] },
  { id: "openvibe", label: "OpenVibe", tags: ["openvibe", "OpenVibe"] },
  { id: "habla", label: "Habla", tags: ["habla", "Habla", "habla.news"] },
  { id: "highlighter", label: "Highlighter", tags: ["highlighter", "Highlighter", "highlighter.com"] },
  { id: "zapstream", label: "Zap.Stream", tags: ["zap.stream", "Zap.Stream"] },
  { id: "plebstr", label: "Plebstr", tags: ["plebstr", "Plebstr"] },
  { id: "current", label: "Current", tags: ["current", "Current"] },
  { id: "freefrom", label: "FreeFrom", tags: ["freefrom", "FreeFrom"] },
  { id: "voyage", label: "Voyage", tags: ["voyage", "Voyage"] },
  { id: "rabbit", label: "Rabbit", tags: ["rabbit", "Rabbit"] },
  { id: "satellite", label: "Satellite", tags: ["satellite", "Satellite", "satellite.earth"] },
  { id: "flycat", label: "Flycat", tags: ["flycat", "Flycat", "flycat.club"] },
  { id: "nostter", label: "Nostter", tags: ["nostter", "Nostter"] },
  { id: "blowater", label: "Blowater", tags: ["blowater", "Blowater"] },
  { id: "relay-outpost", label: "Relay Outpost", tags: ["relay outpost", "Relay Outpost", "relay-outpost"] },
];

const CLIENT_DISPLAY_NAMES: Record<string, string> = {};
for (const client of KNOWN_CLIENTS) {
  for (const tag of client.tags) {
    CLIENT_DISPLAY_NAMES[tag.toLowerCase()] = client.label;
  }
}

function normalizeClientName(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (CLIENT_DISPLAY_NAMES[lower]) return CLIENT_DISPLAY_NAMES[lower];
  for (const [key, display] of Object.entries(CLIENT_DISPLAY_NAMES)) {
    if (lower.includes(key)) return display;
  }
  if (raw.length > 0 && raw !== "Unknown") {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return raw;
}

interface ClientInfo {
  name: string;
  displayName: string;
  count: number;
  users: Set<string>;
  relays: Set<string>;
  latestEvent?: Event;
}

interface DayClientData {
  date: string;
  [client: string]: string | number;
}

function CustomTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-brand/20 bg-white dark:bg-[rgba(4,4,10,0.95)] px-3 py-2 text-xs shadow-lg">
      <p className="font-display text-brand mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} className="text-foreground">
          {entry.name}: <span className="text-brand font-mono">{Number(entry.value).toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

function extractClientName(event: Event): string {
  const clientTag = event.tags.find((t) => t[0] === "client");
  if (clientTag?.[1]?.trim()) {
    return normalizeClientName(clientTag[1].trim());
  }

  const proxyTag = event.tags.find((t) => t[0] === "proxy" && t[1]);
  if (proxyTag?.[1]?.trim()) {
    const proxyVal = proxyTag[1].trim();
    try {
      const url = new URL(proxyVal);
      const host = url.hostname.replace(/^www\./, "");
      return normalizeClientName(host);
    } catch {
      return normalizeClientName(proxyVal);
    }
  }

  const appHandlerTag = event.tags.find(
    (t) => t[0] === "a" && t[1]?.startsWith("31990:")
  );
  if (appHandlerTag?.[1]) {
    const parts = appHandlerTag[1].split(":");
    if (parts.length >= 3 && parts[2]) {
      const identifier = parts[2];
      return normalizeClientName(identifier);
    }
  }

  const labelTag = event.tags.find(
    (t) => t[0] === "l" && t[2] === "client"
  );
  if (labelTag?.[1]?.trim()) {
    return normalizeClientName(labelTag[1].trim());
  }

  const userAgentTag = event.tags.find(
    (t) => t[0] === "user-agent" || t[0] === "ua"
  );
  if (userAgentTag?.[1]?.trim()) {
    return normalizeClientName(userAgentTag[1].trim());
  }

  if (event.content) {
    const viaMatch = event.content.match(/\bvia\s+(\S+)/i);
    if (viaMatch?.[1]) return normalizeClientName(viaMatch[1]);
    const sentFromMatch = event.content.match(/sent from (\S+)/i);
    if (sentFromMatch?.[1]) return normalizeClientName(sentFromMatch[1]);
  }

  return "Unknown";
}

function getAllScanRelays(): string[] {
  const outpostRelays = getOutpostRelays().map((r) => r.url);
  const defaultRelays = getActiveDefaultRelays();
  const all = [...new Set([...DEFAULT_RELAYS, ...defaultRelays, ...outpostRelays])];
  return filterBlockedRelays(getHealthyRelays(all));
}

function ClientUserList({ users, maxShow = 8 }: { users: string[]; maxShow?: number }) {
  const [expanded, setExpanded] = useState(false);
  const displayed = expanded ? users : users.slice(0, maxShow);

  useEffect(() => {
    if (users.length > 0) {
      fetchProfilesCached(users.slice(0, 50));
    }
  }, [users]);

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
        {displayed.map((pk) => (
          <div key={pk} className="py-0.5">
            <ProfileLink pubkey={pk} avatarSize="sm" />
          </div>
        ))}
      </div>
      {users.length > maxShow && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-brand hover:underline mt-1"
        >
          {expanded ? "Show less" : `Show ${users.length - maxShow} more users`}
        </button>
      )}
    </div>
  );
}

export function ClientDiversity({ relays: propRelays }: { relays?: string[] }) {
  const relaysToUse = propRelays && propRelays.length > 0 ? propRelays : DEFAULT_RELAYS;
  const [timeRange, setTimeRange] = useState("24h");
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [scanAllRelays, setScanAllRelays] = useState(true);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [relayStats, setRelayStats] = useState<{ total: number; responded: number }>({ total: 0, responded: 0 });
  const [liveMode, setLiveMode] = useState(false);
  const [liveSubRef, setLiveSubRef] = useState<{ close: () => void } | null>(null);
  const scanCleanupRef = useRef<{ closers: Array<{ close(): void }>; timeout: ReturnType<typeof setTimeout> | null }>({ closers: [], timeout: null });

  const cleanupScan = useCallback(() => {
    const sc = scanCleanupRef.current;
    for (const c of sc.closers) {
      try { c.close(); } catch {}
    }
    sc.closers = [];
    if (sc.timeout) {
      clearTimeout(sc.timeout);
      sc.timeout = null;
    }
  }, []);

  const scanRelays = useMemo(() => {
    if (scanAllRelays) return getAllScanRelays();
    return filterBlockedRelays(getHealthyRelays(relaysToUse));
  }, [scanAllRelays, relaysToUse]);

  const toggleClient = useCallback((id: string) => {
    setSelectedClients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const stopLive = useCallback(() => {
    if (liveSubRef) {
      liveSubRef.close();
      setLiveSubRef(null);
    }
    setLiveMode(false);
  }, [liveSubRef]);

  const fetchData = useCallback(() => {
    cleanupScan();
    if (liveSubRef) {
      liveSubRef.close();
      setLiveSubRef(null);
    }
    setLiveMode(false);
    setLoading(true);
    setEvents([]);
    setHasRun(true);
    setExpandedClient(null);

    const relays = scanRelays;
    if (relays.length === 0) {
      setRelayStats({ total: 0, responded: 0 });
      setLoading(false);
      return;
    }

    const rangeConfig = TIME_RANGES.find((r) => r.label === timeRange) || TIME_RANGES[2];
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const sinceTimestamp = nowTimestamp - rangeConfig.seconds;

    const collected: Event[] = [];
    const seenIds = new Set<string>();
    let eoseCount = 0;
    let completed = false;

    setRelayStats({ total: relays.length, responded: 0 });

    const finish = () => {
      if (completed) return;
      completed = true;
      cleanupScan();
      setEvents([...collected]);
      setLoading(false);
    };

    const safetyTimeout = setTimeout(finish, 15000);
    scanCleanupRef.current.timeout = safetyTimeout;

    for (const relay of relays) {
      const start = Date.now();
      const closer = throttledSubscribe(relay, () => {
        return pool.subscribeMany(
          [relay],
          { kinds: [1, 11, 30023], since: sinceTimestamp, until: nowTimestamp, limit: 5000 },
          {
            onevent(event: Event) {
              if (seenIds.has(event.id)) return;
              seenIds.add(event.id);
              (event as any)._fromRelay = relay;
              collected.push(event);
            },
            oneose() {
              markRelaySuccess(relay, Date.now() - start);
              eoseCount++;
              setRelayStats((prev) => ({ ...prev, responded: eoseCount }));
              closer.close();
              if (eoseCount >= relays.length) {
                finish();
              }
            } },
        );
      });
      scanCleanupRef.current.closers.push(closer);
    }
  }, [timeRange, scanRelays, liveSubRef, cleanupScan]);

  const startLive = useCallback(() => {
    cleanupScan();
    if (liveSubRef) {
      liveSubRef.close();
    }
    setLiveMode(true);
    setHasRun(true);
    setExpandedClient(null);
    setEvents([]);

    const relays = scanRelays;
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const closers: Array<{ close(): void }> = [];

    for (const relay of relays) {
      const closer = throttledSubscribe(relay, () => {
        return pool.subscribeMany(
          [relay],
          { kinds: [1, 11, 30023], since: nowTimestamp, limit: 0 },
          {
            onevent(event: Event) {
              (event as any)._fromRelay = relay;
              setEvents((prev) => {
                if (prev.some((e) => e.id === event.id)) return prev;
                return [...prev, event];
              });
            },
            oneose() {} },
        );
      });
      closers.push(closer);
    }

    const combinedCloser = {
      close() {
        for (const c of closers) {
          try { c.close(); } catch {}
        }
      } };
    setLiveSubRef(combinedCloser);
  }, [scanRelays, liveSubRef, cleanupScan]);

  useEffect(() => {
    return () => {
      cleanupScan();
      if (liveSubRef) {
        liveSubRef.close();
      }
    };
  }, [liveSubRef, cleanupScan]);

  const clientMap = useMemo(() => {
    const map = new Map<string, ClientInfo>();
    for (const e of events) {
      const display = extractClientName(e);
      const key = display.toLowerCase();
      const relay = (e as any)._fromRelay || "";
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        existing.users.add(e.pubkey);
        if (relay) existing.relays.add(relay);
        if (!existing.latestEvent || e.created_at > existing.latestEvent.created_at) {
          existing.latestEvent = e;
        }
      } else {
        const relays = new Set<string>();
        if (relay) relays.add(relay);
        map.set(key, {
          name: key,
          displayName: display,
          count: 1,
          users: new Set([e.pubkey]),
          relays,
          latestEvent: e });
      }
    }
    return map;
  }, [events]);

  const sortedClients = useMemo(() => {
    return Array.from(clientMap.values()).sort((a, b) => b.count - a.count);
  }, [clientMap]);

  const knownClients = useMemo(() => {
    let filtered = sortedClients.filter((c) => c.name !== "unknown");
    if (selectedClients.size > 0) {
      const selectedLabels = new Set(
        KNOWN_CLIENTS.filter((kc) => selectedClients.has(kc.id)).map((kc) => kc.label)
      );
      filtered = filtered.filter((c) => selectedLabels.has(c.displayName));
    }
    if (clientFilter.trim()) {
      const lower = clientFilter.toLowerCase();
      filtered = filtered.filter((c) => c.displayName.toLowerCase().includes(lower));
    }
    return filtered;
  }, [sortedClients, selectedClients, clientFilter]);

  const pieData = useMemo(() => {
    if (knownClients.length === 0) return [];
    const top = knownClients.slice(0, 10);
    const rest = knownClients.slice(10);
    const restCount = rest.reduce((s, c) => s + c.count, 0);
    const result = top.map((c) => ({
      name: c.displayName,
      value: c.count }));
    if (restCount > 0) {
      result.push({ name: "Other", value: restCount });
    }
    return result;
  }, [knownClients]);

  const topClientNames = useMemo(() => {
    return knownClients.slice(0, 8).map((c) => c.displayName);
  }, [knownClients]);

  const areaData = useMemo((): DayClientData[] => {
    if (events.length === 0 || topClientNames.length === 0) return [];
    const buckets = new Map<string, Map<string, number>>();
    for (const e of events) {
      const clientDisplay = extractClientName(e);
      if (clientDisplay === "Unknown") continue;
      const rangeConfig = TIME_RANGES.find((r) => r.label === timeRange);
      const useHours = rangeConfig && rangeConfig.seconds <= 86400;
      const day = useHours
        ? format(new Date(e.created_at * 1000), "HH:00")
        : format(new Date(e.created_at * 1000), "yyyy-MM-dd");
      const key = clientDisplay.toLowerCase();
      const display = clientMap.get(key)?.displayName || clientDisplay;
      const clientLabel = topClientNames.includes(display) ? display : "Other";
      if (!buckets.has(day)) buckets.set(day, new Map());
      const dayMap = buckets.get(day)!;
      dayMap.set(clientLabel, (dayMap.get(clientLabel) || 0) + 1);
    }
    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([day, counts]) => {
      const rangeConfig = TIME_RANGES.find((r) => r.label === timeRange);
      const useHours = rangeConfig && rangeConfig.seconds <= 86400;
      const row: DayClientData = { date: useHours ? day : format(new Date(day), "MMM dd") };
      for (const name of topClientNames) {
        row[name] = counts.get(name) || 0;
      }
      row["Other"] = counts.get("Other") || 0;
      return row;
    });
  }, [events, topClientNames, clientMap, timeRange]);

  const summary = useMemo(() => {
    if (events.length === 0) return null;
    const totalEvents = events.length;
    const unknownClient = clientMap.get("unknown");
    const unknownCount = unknownClient?.count || 0;
    const identifiedCount = totalEvents - unknownCount;
    const identifiedPct = totalEvents > 0 ? ((identifiedCount / totalEvents) * 100).toFixed(1) : "0";
    const allKnown = sortedClients.filter((c) => c.name !== "unknown");
    const uniqueKnown = allKnown.length;
    const topKnown = allKnown[0];
    const topPct = topKnown && identifiedCount > 0
      ? ((topKnown.count / identifiedCount) * 100).toFixed(1)
      : "0";
    const totalUniqueUsers = new Set(events.map((e) => e.pubkey)).size;
    const identifiedUsers = new Set<string>();
    for (const c of allKnown) {
      c.users.forEach((u) => identifiedUsers.add(u));
    }
    return {
      uniqueClients: uniqueKnown,
      topClientName: topKnown?.displayName || "-",
      topClientPct: topPct,
      identifiedCount,
      identifiedPct,
      totalEvents,
      totalUniqueUsers,
      identifiedUniqueUsers: identifiedUsers.size };
  }, [events, clientMap, sortedClients]);

  const areaKeys = useMemo(() => {
    const keys = [...topClientNames];
    if (areaData.some((d) => (d["Other"] as number) > 0)) {
      keys.push("Other");
    }
    return keys;
  }, [topClientNames, areaData]);

  const filteredKnownClientList = useMemo(() => {
    if (!clientFilter.trim()) return KNOWN_CLIENTS;
    const lower = clientFilter.toLowerCase();
    return KNOWN_CLIENTS.filter((c) => c.label.toLowerCase().includes(lower));
  }, [clientFilter]);

  return (
    <div className="overflow-visible" data-testid="client-diversity">
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Smartphone className="w-4 h-4 text-brand" />
          <h2 className="text-sm font-display text-brand">Client Diversity Scanner</h2>
          {hasRun && (
            <Badge variant="secondary" data-testid="badge-event-count">
              {events.length.toLocaleString()} events
            </Badge>
          )}
          {liveMode && (
            <Badge variant="secondary" className="bg-red-500/10 text-red-500 border-red-500/20 animate-pulse">
              <Radio className="w-3 h-3 mr-1" />
              Live
            </Badge>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                Time Range
              </Label>
              <Select value={timeRange} onValueChange={setTimeRange} data-testid="select-time-range">
                <SelectTrigger className="w-[100px]" style={{ fontSize: "16px" }} data-testid="select-time-range-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_RANGES.map((r) => (
                    <SelectItem key={r.label} value={r.label} data-testid={`select-time-range-${r.label}`}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={fetchData}
                disabled={loading}
                data-testid="button-run-diversity"
              >
                {loading ? (
                  <RelayOutpostInlineLoader className="w-4 h-4 mr-1.5" />
                ) : (
                  <Play className="w-4 h-4 mr-1.5" />
                )}
                {loading ? "Scanning..." : "Scan"}
              </Button>

              {!liveMode ? (
                <Button
                  variant="outline"
                  onClick={startLive}
                  disabled={loading}
                  className="border-red-500/20 text-red-500 hover:bg-red-500/10"
                >
                  <Radio className="w-4 h-4 mr-1.5" />
                  Live
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={stopLive}
                  className="border-red-500/30 text-red-500 hover:bg-red-500/10"
                >
                  Stop
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-muted-foreground/50" />
              <Label className="text-[10px] text-muted-foreground/50">All connected relays</Label>
              <Switch
                checked={scanAllRelays}
                onCheckedChange={setScanAllRelays}
                className="scale-75"
              />
            </div>
            <span className="text-[10px] text-muted-foreground/40">
              {scanRelays.length} relay{scanRelays.length !== 1 ? "s" : ""}
            </span>
            {loading && relayStats.total > 0 && (
              <span className="text-[10px] text-brand">
                {relayStats.responded}/{relayStats.total} relays responded
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Filter className="w-3 h-3 text-muted-foreground/50" />
              <Label className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">
                Filter by Client
              </Label>
              {selectedClients.size > 0 && (
                <button
                  onClick={() => setSelectedClients(new Set())}
                  className="text-[9px] text-brand hover:underline"
                >
                  Clear ({selectedClients.size})
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <Input
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                placeholder="Search clients..."
                className="pl-8 h-8 text-xs"
                style={{ fontSize: "16px" }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
              {filteredKnownClientList.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleClient(c.id)}
                  className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                    selectedClients.has(c.id)
                      ? "bg-brand dark:bg-brand/20 text-foreground border border-brand/40 dark:border-brand/30"
                      : "bg-black/[0.02] dark:bg-white/[0.03] text-foreground/60 border border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3" data-testid="summary-cards">
            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Clients Found</p>
              <div className="flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-brand" data-testid="text-unique-clients">
                  {summary.uniqueClients.toLocaleString()}
                </p>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Top Client</p>
              <div className="flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-brand" />
                <div className="min-w-0">
                  <p className="text-sm font-mono text-brand truncate" data-testid="text-top-client">
                    {summary.topClientName}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50" data-testid="text-top-client-pct">
                    {summary.topClientPct}% share
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Identification Rate</p>
              <div className="flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-emerald-800 dark:text-emerald-400" />
                <div className="min-w-0">
                  <p className="text-lg font-mono text-emerald-800 dark:text-emerald-400" data-testid="text-identified-pct">
                    {summary.identifiedPct}%
                  </p>
                  <p className="text-[10px] text-muted-foreground/50">
                    {summary.identifiedCount.toLocaleString()} of {summary.totalEvents.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Unique Users</p>
              <div className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-brand" />
                <div className="min-w-0">
                  <p className="text-lg font-mono text-foreground" data-testid="text-total-users">
                    {summary.totalUniqueUsers.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50">
                    {summary.identifiedUniqueUsers.toLocaleString()} identified
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1 p-3 rounded-lg bg-brand/5 border border-brand/10">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50">Total Events</p>
              <div className="flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-brand" />
                <p className="text-lg font-mono text-foreground" data-testid="text-total-events">
                  {events.length.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {summary && (
          <p className="text-[10px] text-muted-foreground/40 italic">
            Scanned {scanRelays.length} relay{scanRelays.length !== 1 ? "s" : ""} (defaults{scanAllRelays ? " + communities" : ""}). {summary.identifiedPct}% of events had client identification tags.
          </p>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 gap-2" data-testid="loading-indicator">
            <RelayOutpostInlineLoader className="w-5 h-5 text-brand" />
            <span className="text-sm text-muted-foreground">
              Scanning {scanRelays.length} relays for client data...
            </span>
          </div>
        )}

        {!loading && hasRun && events.length === 0 && !liveMode && (
          <div className="text-center py-12 text-sm text-muted-foreground" data-testid="empty-state">
            No events found in this time range.
          </div>
        )}

        {!loading && pieData.length > 0 && (
          <div className="space-y-4">
            <div data-testid="pie-chart-market-share">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                Client Distribution
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    strokeWidth={1}
                    stroke="rgba(4,4,10,0.6)"
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltipContent />} />
                  <Legend
                    wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {areaData.length > 1 && (
              <div data-testid="area-chart-usage-over-time">
                <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                  Client Usage Over Time
                </p>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={areaData}>
                    <defs>
                      {areaKeys.map((key, i) => (
                        <linearGradient key={key} id={`clientGrad-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.08)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }}
                      axisLine={false}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip content={<CustomTooltipContent />} />
                    <Legend
                      wrapperStyle={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}
                    />
                    {areaKeys.map((key, i) => (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={key}
                        stackId="1"
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        fill={`url(#clientGrad-${i})`}
                        strokeWidth={1.5}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            <div data-testid="client-table">
              <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-2">
                Client Rankings
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-brand/10">
                      <th className="text-left py-2 pr-3 text-muted-foreground/50 font-brand uppercase tracking-widest text-[9px]">#</th>
                      <th className="text-left py-2 pr-3 text-muted-foreground/50 font-brand uppercase tracking-widest text-[9px]">Client</th>
                      <th className="text-right py-2 pr-3 text-muted-foreground/50 font-brand uppercase tracking-widest text-[9px]">Events</th>
                      <th className="text-right py-2 pr-3 text-muted-foreground/50 font-brand uppercase tracking-widest text-[9px]">Share</th>
                      <th className="text-right py-2 pr-3 text-muted-foreground/50 font-brand uppercase tracking-widest text-[9px]">Users</th>
                      <th className="text-right py-2 text-muted-foreground/50 font-brand uppercase tracking-widest text-[9px]">Relays</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const identifiedTotal = knownClients.reduce((s, c) => s + c.count, 0);
                      return knownClients.slice(0, 30).map((client, i) => {
                        const pct = identifiedTotal > 0
                          ? ((client.count / identifiedTotal) * 100).toFixed(1)
                          : "0";
                        const isExpanded = expandedClient === client.name;
                        const userList = Array.from(client.users);
                        return (
                          <tr
                            key={client.name}
                            className="border-b border-brand/5"
                            data-testid={`row-client-${i}`}
                          >
                            <td className="py-1.5 pr-3 text-muted-foreground/40 font-mono align-top">{i + 1}</td>
                            <td className="py-1.5 pr-3 text-foreground align-top" data-testid={`text-client-name-${i}`}>
                              <div>
                                <button
                                  onClick={() => setExpandedClient(isExpanded ? null : client.name)}
                                  className="flex items-center gap-1.5 hover:text-brand transition-colors"
                                >
                                  <span
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                                  />
                                  <span>{client.displayName}</span>
                                  {isExpanded ? (
                                    <ChevronUp className="w-3 h-3 text-muted-foreground/40" />
                                  ) : (
                                    <ChevronDown className="w-3 h-3 text-muted-foreground/40" />
                                  )}
                                </button>
                                {isExpanded && userList.length > 0 && (
                                  <div className="mt-2 ml-3.5 pb-2">
                                    <p className="text-[10px] font-brand uppercase tracking-widest text-muted-foreground/50 mb-1.5">
                                      Users ({userList.length})
                                    </p>
                                    <ClientUserList users={userList} />
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="py-1.5 pr-3 text-right font-mono text-brand align-top" data-testid={`text-client-count-${i}`}>
                              {client.count.toLocaleString()}
                            </td>
                            <td className="py-1.5 pr-3 text-right font-mono text-muted-foreground align-top" data-testid={`text-client-pct-${i}`}>
                              {pct}%
                            </td>
                            <td className="py-1.5 pr-3 text-right font-mono text-foreground align-top" data-testid={`text-client-users-${i}`}>
                              {client.users.size.toLocaleString()}
                            </td>
                            <td className="py-1.5 text-right font-mono text-muted-foreground/60 align-top">
                              <div className="flex flex-wrap justify-end gap-1">
                                {Array.from(client.relays).slice(0, 3).map((r) => {
                                  let host = r;
                                  try { host = new URL(r).hostname; } catch {}
                                  return (
                                    <span key={r} className="text-[9px] bg-brand/10 rounded px-1 py-0.5 whitespace-nowrap" title={r}>
                                      {host}
                                    </span>
                                  );
                                })}
                                {client.relays.size > 3 && (
                                  <span className="text-[9px] text-muted-foreground/40">+{client.relays.size - 3}</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!hasRun && !loading && (
          <div className="text-center py-12 space-y-2" data-testid="initial-state">
            <Smartphone className="w-8 h-8 text-brand/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Scan your connected relays to discover which clients are active across the network.
            </p>
            <p className="text-[10px] text-muted-foreground/40">
              Filter by specific clients, expand rows to see users, or enable live mode for real-time tracking.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
