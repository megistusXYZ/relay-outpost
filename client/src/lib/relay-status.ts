/**
 * "How your relay is doing": newlay's admin-only getrelaystatus report
 * (relay.tools Feeds; docs/MANAGEMENT_API.md §6) in plain words. Operators
 * here are community hosts, not relay engineers — so kinds become "Posts",
 * subsystems become what they do, and the engine/version is small print.
 *
 * store.lifetime_writes is NOT shown: it counts every write ever, including
 * replaced and deleted events, so it would overstate what's there.
 */

export interface RelayStatusView {
  uptime: string;
  /** What people keep there, biggest first; kinds with nothing are left out. */
  counts: Array<{ label: string; value: string }>;
  /** Null when the relay has no trust scoring set up. */
  trust: string | null;
  features: string[];
  software: string | null;
}

/** The kinds newlay counts (§6 events_by_kind), as people call them. */
const KIND_LABELS: Record<string, string> = {
  "1": "Posts", "7": "Reactions", "6": "Reposts", "0": "Profiles", "9735": "Zaps", "30023": "Articles",
};

/** subsystems → what they do, in the order a host cares about. nip86 is the console itself. */
const FEATURES: Array<[string, string]> = [
  ["nip29", "Groups"], ["nip43", "Member sign-up"], ["search", "Search"], ["blossom", "Media storage"],
  ["wot", "Trust filter"], ["spider", "Gathers posts from your network"],
];

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string) => `${v} ${one}${v === 1 ? "" : "s"}`;

function since(seconds: number): string {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${plural(Math.floor(seconds / 60), "minute")} ago`;
  if (seconds < 86400) return `${plural(Math.floor(seconds / 3600), "hour")} ago`;
  return `${plural(Math.floor(seconds / 86400), "day")} ago`;
}

function uptime(seconds: number): string {
  if (seconds < 3600) return "Just restarted";
  if (seconds < 86400) return `Up for ${plural(Math.floor(seconds / 3600), "hour")}`;
  return `Up for ${plural(Math.floor(seconds / 86400), "day")}`;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** The report in words, or null when there's no report to show (disabled, refused, malformed). */
export function describeRelayStatus(result: unknown): RelayStatusView | null {
  if (!isObj(result) || typeof result.uptime_seconds !== "number") return null;
  const store = isObj(result.store) ? result.store : {};
  const byKind = isObj(store.events_by_kind) ? store.events_by_kind : {};
  const counts: Array<{ label: string; n: number }> = [];
  for (const [kind, label] of Object.entries(KIND_LABELS)) {
    const v = Number(byKind[kind]);
    if (v > 0) counts.push({ label, n: v });
  }
  if (typeof store.blobs === "number" && store.blobs > 0) counts.push({ label: "Media files", n: store.blobs });
  counts.sort((a, b) => b.n - a.n);

  const wot = isObj(result.wot) ? result.wot : null;
  let trust: string | null = null;
  if (wot) {
    trust = wot.computed && typeof wot.last_computed_seconds_ago === "number"
      ? `Trust scores updated ${since(wot.last_computed_seconds_ago)} · ${n(Number(wot.trusted_users) || 0)} trusted people`
      : "Trust scores are being worked out";
  }

  const subs = isObj(result.subsystems) ? result.subsystems : {};
  const relay = isObj(result.relay) ? result.relay : {};
  return {
    uptime: uptime(result.uptime_seconds),
    counts: counts.map((c) => ({ label: c.label, value: n(c.n) })),
    trust,
    features: FEATURES.filter(([k]) => subs[k] === true).map(([, label]) => label),
    software: typeof relay.software === "string" ? [relay.software, relay.version].filter(Boolean).join(" ") : null,
  };
}
