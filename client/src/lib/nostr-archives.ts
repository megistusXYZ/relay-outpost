export interface ArchivesStats {
  total_events?: number;
  total_profiles?: number;
  unique_pubkeys?: number;
  events_today?: number;
  profiles_today?: number;
  ingestion_rate_per_min?: number;
  events_by_kind?: { kind: number; count: number }[];
  [key: string]: unknown;
}

export interface ArchivesDailyStats {
  date: string;
  events?: number;
  profiles?: number;
  zaps_sats?: number;
  [key: string]: unknown;
}

export interface ArchivesEvent {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  sig?: string;
  reactions?: number;
  replies?: number;
  zap_sats?: number;
  reposts?: number;
  reactions_count?: number;
  replies_count?: number;
  zaps_count?: number;
  zaps_total?: number;
  reposts_count?: number;
  [key: string]: unknown;
}

export interface TopNote {
  count: number;
  event: {
    id: string;
    pubkey: string;
    kind: number;
    content: string;
    tags: string[][];
    created_at: number;
    sig?: string;
    [key: string]: unknown;
  };
  reactions: number;
  replies: number;
  reposts: number;
  zap_sats: number;
  total_sats: number | null;
}

export type TopNoteMetric = "reactions" | "zaps" | "replies" | "reposts";
export type TopNoteRange = "today" | "7d" | "30d" | "1y" | "all";

export interface TopNotesResponse {
  metric: string;
  range: string;
  notes: TopNote[];
}

export interface ArchivesSocialGraph {
  pubkey: string;
  followers_count?: number;
  following_count?: number;
  followers?: string[];
  following?: string[];
  [key: string]: unknown;
}

export interface ArchivesZapStats {
  pubkey: string;
  total_received?: number;
  total_sent?: number;
  zap_count_received?: number;
  zap_count_sent?: number;
  [key: string]: unknown;
}

export type ArchivesSortOption = "created_at" | "reactions" | "zaps" | "replies";

export async function fetchArchivesStats(): Promise<ArchivesStats> {
  const res = await fetch("/api/archives/stats", { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchArchivesDailyStats(days: number = 30): Promise<ArchivesDailyStats[]> {
  const res = await fetch(`/api/archives/stats/daily?days=${days}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.stats || data.daily || [];
}

export async function searchArchivesEvents(params: {
  q?: string;
  kind?: number;
  author?: string;
  limit?: number;
  offset?: number;
  since?: number;
  until?: number;
  sort?: ArchivesSortOption;
}): Promise<{ events: ArchivesEvent[]; total?: number }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.kind !== undefined) qs.set("kind", String(params.kind));
  if (params.author) qs.set("author", params.author);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.since) qs.set("since", String(params.since));
  if (params.until) qs.set("until", String(params.until));
  if (params.sort) qs.set("sort", params.sort);
  const res = await fetch(`/api/archives/events?${qs.toString()}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const events = Array.isArray(data) ? data : data.events || [];
  const total = data.total ?? data.count ?? undefined;
  return { events, total };
}

export async function fetchArchivesEvent(eventId: string): Promise<ArchivesEvent | null> {
  const res = await fetch(`/api/archives/events/${eventId}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  return data.event || data || null;
}

export async function fetchArchivesThread(eventId: string): Promise<ArchivesEvent[]> {
  const res = await fetch(`/api/archives/events/${eventId}/thread`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.events || data.thread || [];
}

export async function fetchArchivesSocialGraph(pubkey: string): Promise<ArchivesSocialGraph | null> {
  const res = await fetch(`/api/archives/social/${pubkey}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    pubkey: data.pubkey ?? pubkey,
    followers_count: data.followers?.count ?? data.followers_count,
    following_count: data.follows?.count ?? data.following_count,
    followers: data.followers?.pubkeys ?? data.followers,
    following: data.follows?.pubkeys ?? data.following,
  };
}

export async function fetchArchivesZapStats(pubkey: string): Promise<ArchivesZapStats | null> {
  const res = await fetch(`/api/archives/profiles/${pubkey}/zap-stats`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return res.json();
}

export interface LiveMetrics {
  online: number;
  sats: number;
  notes: number;
}

const LIVE_METRICS_WS_URL = "wss://api.nostrarchives.com/v1/ws/live-metrics";

export function connectLiveMetrics(
  onMessage: (data: LiveMetrics) => void,
  onError?: (err: unknown) => void,
): { close: () => void } {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(LIVE_METRICS_WS_URL);
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as LiveMetrics;
          if (typeof data.online === "number") onMessage(data);
        } catch {}
      };
      ws.onerror = () => {
        onError?.("WebSocket error");
      };
      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      };
    } catch (err) {
      onError?.(err);
      if (!closed) {
        reconnectTimer = setTimeout(connect, 5000);
      }
    }
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        try { ws.close(); } catch {}
      }
    },
  };
}

export interface ActiveUser {
  pubkey: string;
  activity: "posted" | "reacted" | "zapped" | "reposted";
}

export async function fetchActiveOnlineUsers(): Promise<ActiveUser[]> {
  const metrics: { metric: TopNoteMetric; activity: ActiveUser["activity"] }[] = [
    { metric: "replies", activity: "posted" },
    { metric: "reactions", activity: "reacted" },
    { metric: "zaps", activity: "zapped" },
    { metric: "reposts", activity: "reposted" },
  ];

  const results = await Promise.allSettled(
    metrics.map(async ({ metric, activity }) => {
      const res = await fetch(
        `/api/archives/notes/top?metric=${metric}&range=today&limit=50`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return [];
      const data = await res.json();
      const notes = Array.isArray(data.notes) ? data.notes : [];
      return notes
        .map((n: any) => n.event?.pubkey)
        .filter(Boolean)
        .map((pubkey: string) => ({ pubkey, activity }));
    }),
  );

  const seen = new Set<string>();
  const users: ActiveUser[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const u of r.value) {
      if (!seen.has(u.pubkey)) {
        seen.add(u.pubkey);
        users.push(u);
      }
    }
  }
  return users;
}

export async function fetchTopNotes(params: {
  metric?: TopNoteMetric;
  range?: TopNoteRange;
  limit?: number;
}): Promise<TopNotesResponse> {
  const qs = new URLSearchParams();
  if (params.metric) qs.set("metric", params.metric);
  if (params.range) qs.set("range", params.range);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`/api/archives/notes/top?${qs.toString()}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return {
    metric: data.metric || params.metric || "reactions",
    range: data.range || params.range || "today",
    notes: Array.isArray(data.notes) ? data.notes : [],
  };
}
