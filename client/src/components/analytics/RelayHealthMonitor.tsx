import { useState, useCallback, useRef, useEffect } from "react";
import { pool, DEFAULT_RELAYS } from "@/lib/nostr";
import { getRelayScore, getRelayHealthData, isRelayCoolingDown, getAllRelayHealth } from "@/lib/relay-health";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Activity,
  RefreshCw,
  Wifi,
  WifiOff,
  Zap,
  Globe,
  Server,
  Clock,
  Shield,
  AlertTriangle,
  Timer,
} from "lucide-react";

const COLORS = ["#a855f7", "#9333ea", "#7e22ce", "#6b21a8", "#c084fc", "#d8b4fe", "#e9d5ff", "#581c87"];

interface RelayHealthData {
  url: string;
  connected: boolean;
  latency: number | null;
  throughput: number | null;
  nip11: Nip11Info | null;
  error: string | null;
  testing: boolean;
}

interface Nip11Info {
  name?: string;
  description?: string;
  supported_nips?: number[];
  software?: string;
  version?: string;
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

async function testLatency(url: string): Promise<{ connected: boolean; latency: number | null; error: string | null }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeout = setTimeout(() => {
      resolve({ connected: false, latency: null, error: "Timeout (5s)" });
    }, 5000);

    try {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        const latency = Date.now() - start;
        clearTimeout(timeout);
        ws.close();
        resolve({ connected: true, latency, error: null });
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ connected: false, latency: null, error: "Connection failed" });
      };
      ws.onclose = (event) => {
        if (!event.wasClean && event.code !== 1000) {
          clearTimeout(timeout);
          resolve({ connected: false, latency: null, error: `Closed: ${event.code}` });
        }
      };
    } catch {
      clearTimeout(timeout);
      resolve({ connected: false, latency: null, error: "Invalid URL" });
    }
  });
}

async function fetchNip11(url: string): Promise<Nip11Info | null> {
  try {
    const httpUrl = url.replace("wss://", "https://").replace("ws://", "http://");
    const res = await fetch(httpUrl, {
      headers: { "Accept": "application/nostr+json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data.name,
      description: data.description,
      supported_nips: data.supported_nips,
      software: data.software,
      version: data.version,
    };
  } catch {
    return null;
  }
}

function testThroughput(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    let count = 0;
    const startTime = Date.now();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { closer.close(); } catch {}
        const elapsed = (Date.now() - startTime) / 1000;
        resolve(elapsed > 0 ? Math.round(count / elapsed) : null);
      }
    }, 3000);

    const closer = pool.subscribeMany(
      [url],
      { kinds: [1], limit: 50 },
      {
        onevent() {
          count++;
        },
        oneose() {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            try { closer.close(); } catch {}
            const elapsed = (Date.now() - startTime) / 1000;
            resolve(elapsed > 0 ? Math.round(count / elapsed) : null);
          }
        },
      },
    );
  });
}

interface RelayHealthMonitorProps {
  relays?: string[];
}

export function RelayHealthMonitor({ relays }: RelayHealthMonitorProps = {}) {
  const allRelays = relays ?? DEFAULT_RELAYS;
  const [results, setResults] = useState<Map<string, RelayHealthData>>(new Map());
  const [testingAll, setTestingAll] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const testSingleRelay = useCallback(async (url: string) => {
    setResults((prev) => {
      const next = new Map(prev);
      next.set(url, { url, connected: false, latency: null, throughput: null, nip11: null, error: null, testing: true });
      return next;
    });

    const [latencyResult, nip11] = await Promise.all([
      testLatency(url),
      fetchNip11(url),
    ]);

    let throughput: number | null = null;
    if (latencyResult.connected) {
      throughput = await testThroughput(url);
    }

    if (mountedRef.current) {
      setResults((prev) => {
        const next = new Map(prev);
        next.set(url, {
          url,
          connected: latencyResult.connected,
          latency: latencyResult.latency,
          throughput,
          nip11,
          error: latencyResult.error,
          testing: false,
        });
        return next;
      });
    }
  }, []);

  const testAllRelays = useCallback(async () => {
    setTestingAll(true);
    await Promise.allSettled(allRelays.map((url) => testSingleRelay(url)));
    if (mountedRef.current) setTestingAll(false);
  }, [testSingleRelay, allRelays]);

  const relayList = allRelays.map((url) => results.get(url)).filter(Boolean) as RelayHealthData[];
  const connectedRelays = relayList.filter((r) => r.connected);
  const latencies = connectedRelays.map((r) => r.latency!).filter((l) => l !== null);
  const fastestRelay = connectedRelays.length > 0
    ? connectedRelays.reduce((a, b) => ((a.latency ?? Infinity) < (b.latency ?? Infinity) ? a : b))
    : null;
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  const nip04Relays = relayList.filter((r) => r.nip11?.supported_nips?.includes(4));
  const nip42Relays = relayList.filter((r) => r.nip11?.supported_nips?.includes(42));

  const allHealth = getAllRelayHealth();
  const healthyCount = allRelays.filter(url => !isRelayCoolingDown(url)).length;
  const coolingCount = allRelays.filter(url => isRelayCoolingDown(url)).length;

  function getHealthStatus(url: string): "healthy" | "degraded" | "cooldown" {
    if (isRelayCoolingDown(url)) return "cooldown";
    const hd = getRelayHealthData(url);
    if (hd && hd.failures > 0) return "degraded";
    return "healthy";
  }

  function getSuccessRate(url: string): number | null {
    const hd = getRelayHealthData(url);
    if (!hd) return null;
    const total = hd.successCount + hd.failures;
    if (total === 0) return null;
    return Math.round((hd.successCount / total) * 100);
  }

  const chartData = connectedRelays
    .filter((r) => r.latency !== null)
    .map((r) => ({
      name: r.url.replace("wss://", ""),
      latency: r.latency,
    }))
    .sort((a, b) => (a.latency ?? 0) - (b.latency ?? 0));

  return (
    <div className="space-y-4" data-testid="relay-health-monitor">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-brand/80" />
          <h2 className="text-base font-brand tracking-wider uppercase" data-testid="text-health-title">
            Relay Health Monitor
          </h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={testAllRelays}
          disabled={testingAll}
          data-testid="button-test-all"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${testingAll ? "animate-spin" : ""}`} />
          {testingAll ? "Testing..." : "Test All"}
        </Button>
      </div>

      {relayList.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="glass-card border-brand/15 p-3" data-testid="card-fastest-relay">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-3.5 h-3.5 text-brand/80" />
              <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">Fastest Relay</span>
            </div>
            <p className="text-sm font-mono text-brand truncate" data-testid="text-fastest-relay">
              {fastestRelay ? fastestRelay.url.replace("wss://", "") : "—"}
            </p>
            {fastestRelay?.latency !== null && fastestRelay?.latency !== undefined && (
              <p className="text-xs text-muted-foreground/50 mt-0.5">{fastestRelay.latency}ms</p>
            )}
          </Card>

          <Card className="glass-card border-brand/15 p-3" data-testid="card-avg-latency">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-3.5 h-3.5 text-brand/80" />
              <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">Avg Latency</span>
            </div>
            <p className="text-sm font-mono text-brand" data-testid="text-avg-latency">
              {avgLatency !== null ? `${avgLatency}ms` : "—"}
            </p>
            <p className="text-xs text-muted-foreground/50 mt-0.5">
              {connectedRelays.length}/{allRelays.length} connected
            </p>
          </Card>

          <Card className="glass-card border-brand/15 p-3" data-testid="card-relay-health-summary">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-3.5 h-3.5 text-brand/80" />
              <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">Relay Health</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap" data-testid="text-relay-health-summary">
              <Badge variant="outline" className="text-[10px] border-green-400/20 text-green-800/60 dark:text-green-400/60">
                {healthyCount} Healthy
              </Badge>
              {coolingCount > 0 && (
                <Badge variant="outline" className="text-[10px] border-red-400/20 text-red-700/60 dark:text-red-400/60">
                  {coolingCount} Cooldown
                </Badge>
              )}
            </div>
          </Card>
        </div>
      )}

      {chartData.length > 0 && (
        <Card className="glass-card border-brand/15 p-4" data-testid="card-latency-chart">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-3.5 h-3.5 text-brand/80" />
            <span className="text-xs text-muted-foreground/70 uppercase tracking-wide">Latency Comparison (ms)</span>
          </div>
          <div className="w-full h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(168,85,247,0.08)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "rgba(168,85,247,0.5)", fontSize: 10 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  height={60}
                />
                <YAxis tick={{ fill: "rgba(168,85,247,0.4)", fontSize: 10 }} />
                <Tooltip content={<CustomTooltipContent />} />
                <Bar dataKey="latency" name="Latency (ms)" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {relayList.length > 0 && (
        <Card className="glass-card border-brand/15 p-4" data-testid="card-relay-table">
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-relay-health">
              <thead>
                <tr className="border-b border-brand/10">
                  <th className="text-left py-2 pr-3 text-muted-foreground/60 uppercase tracking-wide font-medium">Relay</th>
                  <th className="text-left py-2 px-3 text-muted-foreground/60 uppercase tracking-wide font-medium">Status</th>
                  <th className="text-left py-2 px-3 text-muted-foreground/60 uppercase tracking-wide font-medium">Health</th>
                  <th className="text-right py-2 px-3 text-muted-foreground/60 uppercase tracking-wide font-medium">Score</th>
                  <th className="text-right py-2 px-3 text-muted-foreground/60 uppercase tracking-wide font-medium">Latency</th>
                  <th className="text-right py-2 px-3 text-muted-foreground/60 uppercase tracking-wide font-medium">Success</th>
                  <th className="text-right py-2 px-3 text-muted-foreground/60 uppercase tracking-wide font-medium">Throughput</th>
                  <th className="text-left py-2 pl-3 text-muted-foreground/60 uppercase tracking-wide font-medium">Software</th>
                </tr>
              </thead>
              <tbody>
                {relayList.map((relay, idx) => {
                  const healthStatus = getHealthStatus(relay.url);
                  const score = getRelayScore(relay.url);
                  const successRate = getSuccessRate(relay.url);
                  const hd = getRelayHealthData(relay.url);
                  return (
                  <tr
                    key={relay.url}
                    className="border-b border-white/[0.04] last:border-0"
                    data-testid={`row-relay-${idx}`}
                  >
                    <td className="py-2 pr-3">
                      <span className="font-mono text-brand/80 whitespace-nowrap" data-testid={`text-relay-url-${idx}`}>
                        {relay.url.replace("wss://", "")}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      {relay.testing ? (
                        <Badge variant="outline" className="text-[10px] border-yellow-400/20 text-yellow-800/60 dark:text-yellow-400/60" data-testid={`badge-status-${idx}`}>
                          <RefreshCw className="w-2.5 h-2.5 mr-0.5 animate-spin" />
                          Testing
                        </Badge>
                      ) : relay.connected ? (
                        <Badge variant="outline" className="text-[10px] border-green-400/20 text-green-800/60 dark:text-green-400/60" data-testid={`badge-status-${idx}`}>
                          <Wifi className="w-2.5 h-2.5 mr-0.5" />
                          Online
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-red-400/20 text-red-700/60 dark:text-red-400/60" data-testid={`badge-status-${idx}`}>
                          <WifiOff className="w-2.5 h-2.5 mr-0.5" />
                          Offline
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-3" data-testid={`badge-health-${idx}`}>
                      {healthStatus === "healthy" ? (
                        <Badge variant="outline" className="text-[10px] border-green-400/20 text-green-800/60 dark:text-green-400/60">
                          <Shield className="w-2.5 h-2.5 mr-0.5" />
                          Healthy
                        </Badge>
                      ) : healthStatus === "degraded" ? (
                        <Badge variant="outline" className="text-[10px] border-amber-400/20 text-amber-800/60 dark:text-amber-400/60">
                          <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                          Degraded{hd ? ` (${hd.failures})` : ""}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-red-400/20 text-red-700/60 dark:text-red-400/60">
                          <Timer className="w-2.5 h-2.5 mr-0.5" />
                          Cooldown
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono" data-testid={`text-score-${idx}`}>
                      <span className={score < 2000 ? "text-green-800 dark:text-green-400" : score < 5000 ? "text-amber-800 dark:text-amber-400" : "text-red-700 dark:text-red-400"}>
                        {score.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono" data-testid={`text-latency-${idx}`}>
                      {relay.latency !== null ? (
                        <span className="text-brand">{relay.latency}ms</span>
                      ) : hd?.avgLatency && hd.avgLatency < 5000 ? (
                        <span className="text-brand/60">{hd.avgLatency}ms</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono" data-testid={`text-success-rate-${idx}`}>
                      {successRate !== null ? (
                        <span className={successRate >= 90 ? "text-green-800 dark:text-green-400" : successRate >= 70 ? "text-amber-800 dark:text-amber-400" : "text-red-700 dark:text-red-400"}>
                          {successRate}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono" data-testid={`text-throughput-${idx}`}>
                      {relay.throughput !== null ? (
                        <span className="text-brand">{relay.throughput} evt/s</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-3" data-testid={`text-software-${idx}`}>
                      {relay.nip11?.software || relay.nip11?.version ? (
                        <span className="text-muted-foreground/70 whitespace-nowrap">
                          {relay.nip11.software?.split("/").pop() ?? ""}{relay.nip11.version ? ` v${relay.nip11.version}` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {relayList.length === 0 && !testingAll && (
        <Card className="glass-card border-brand/15 p-6" data-testid="card-empty-state">
          <div className="flex flex-col items-center text-center gap-3">
            <Activity className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/60">
              Click "Test All" to measure relay health, latency, and throughput.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
