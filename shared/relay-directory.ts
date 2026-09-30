/**
 * The relay directory, as the monitors report it (NIP-66, kind 30166).
 *
 * Several monitors report each relay every few minutes, and a report carries
 * a copy of the relay's info document, so reading the directory from the
 * monitors costs far more than the directory is worth: measured 2026-09-30,
 * 3,500 reports and 6.5 MB for about 950 relays, of which the app keeps a few
 * tags each (~140 KB). The server reads the monitors and shares this compact
 * list (server/relay-directory.ts); the app reads them itself only when the
 * server can't answer.
 */
export const NIP_66_MONITOR_RELAYS = ["wss://relaypag.es", "wss://monitorlizard.nostr1.com"];
export const KIND_RELAY_REPORT = 30166;
/** How many reports one monitor is asked for. */
export const REPORT_LIMIT = 2000;

export interface DirectoryEntry {
  url: string;
  supportedNips: number[];
  requirements: string[];
  software: string;
  relayType: string;
  /** created_at of the newest report about this relay. */
  lastSeen: number;
}

type Report = { created_at?: number; tags?: unknown };

/** One entry per relay, from its newest report; relays that support the most first. */
export function directoryFromReports(reports: readonly unknown[]): DirectoryEntry[] {
  const byUrl = new Map<string, DirectoryEntry>();
  for (const raw of reports) {
    const e = raw as Report | null;
    if (!e || !Array.isArray(e.tags)) continue;
    const tags = e.tags.filter((t): t is string[] => Array.isArray(t));
    const d = tags.find((t) => t[0] === "d")?.[1];
    if (!d || typeof d !== "string") continue;
    const withScheme = d.startsWith("wss://") || d.startsWith("ws://") ? d : "wss://" + d;
    const url = withScheme.replace(/\/+$/, "");
    const key = url.toLowerCase();
    const seen = typeof e.created_at === "number" ? e.created_at : 0;
    const existing = byUrl.get(key);
    if (existing && existing.lastSeen >= seen) continue;
    byUrl.set(key, {
      url,
      supportedNips: tags.filter((t) => t[0] === "N").map((t) => parseInt(t[1], 10)).filter((n) => !isNaN(n)),
      requirements: tags.filter((t) => t[0] === "R").map((t) => t[1]?.toLowerCase()).filter(Boolean) as string[],
      software: tags.find((t) => t[0] === "s")?.[1] || "",
      relayType: tags.find((t) => t[0] === "T")?.[1] || "",
      lastSeen: seen,
    });
  }
  return Array.from(byUrl.values()).sort((a, b) => b.supportedNips.length - a.supportedNips.length);
}

/** A directory entry from somewhere we don't control (the server's answer). */
export function isDirectoryEntry(x: unknown): x is DirectoryEntry {
  const e = x as DirectoryEntry | null;
  return !!e
    && typeof e.url === "string" && /^wss?:\/\//.test(e.url)
    && Array.isArray(e.supportedNips) && e.supportedNips.every((n) => typeof n === "number")
    && Array.isArray(e.requirements) && e.requirements.every((r) => typeof r === "string")
    && typeof e.software === "string"
    && typeof e.relayType === "string"
    && typeof e.lastSeen === "number";
}
