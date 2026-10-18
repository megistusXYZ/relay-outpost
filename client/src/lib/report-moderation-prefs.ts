/**
 * What an operator decided about reports (owner, 2026-10-18), per account:
 *  - whose reports they ignore, on every relay they run;
 *  - when they dismissed each report row, per relay (a newer report brings
 *    the row back).
 * Kept in localStorage and synced, self-encrypted, with the rest of the
 * settings (lib/nip78-settings.ts). Each entry carries its own time and the
 * newer decision wins a merge, so an undo on one device isn't undone by
 * another device's older copy.
 */
export type IgnoreMap = Record<string, { on: boolean; at: number }>;
export type DismissMap = Record<string, number>;

export const IGNORE_PREFIX = "ro_ignored_reporters:";
export const DISMISS_PREFIX = "ro_report_dismissals:";
export const REPORT_PREFS_CHANGED = "ro-report-prefs-changed";
const LEGACY_DISMISSED = "ro_relay_reports_dismissed_";

const nowSec = () => Math.floor(Date.now() / 1000);
const normRelay = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
const dismissKey = (relayUrl: string, key: string) => `${normRelay(relayUrl)}|${key}`;

function readJson<T>(k: string, fallback: T): T {
  try { const raw = localStorage.getItem(k); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeJson(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ }
  try { window.dispatchEvent(new Event(REPORT_PREFS_CHANGED)); } catch { /* no window in tests */ }
}

export function readIgnoreMap(viewer: string): IgnoreMap {
  return readJson<IgnoreMap>(IGNORE_PREFIX + viewer, {});
}
export function writeIgnoreMap(viewer: string, map: IgnoreMap): void {
  writeJson(IGNORE_PREFIX + viewer, map);
}
export function setReporterIgnored(viewer: string, reporter: string, on: boolean, at = nowSec()): void {
  writeIgnoreMap(viewer, { ...readIgnoreMap(viewer), [reporter.toLowerCase()]: { on, at } });
}
export function ignoredReporterSet(map: IgnoreMap): Set<string> {
  return new Set(Object.entries(map).filter(([, v]) => v?.on).map(([k]) => k));
}
export function mergeIgnoreMaps(a: IgnoreMap, b: IgnoreMap): IgnoreMap {
  const out: IgnoreMap = { ...a };
  for (const [k, v] of Object.entries(b)) if (!out[k] || v.at > out[k].at) out[k] = v;
  return out;
}

/** Dismissals, with rows dismissed before this module existed carried over (as dismissed now). */
export function readDismissMap(viewer: string, migrateAt = nowSec()): DismissMap {
  const map = readJson<DismissMap>(DISMISS_PREFIX + viewer, {});
  let migrated = false;
  try {
    const legacy: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LEGACY_DISMISSED)) legacy.push(k);
    }
    for (const k of legacy) {
      const relay = k.slice(LEGACY_DISMISSED.length);
      for (const key of readJson<string[]>(k, [])) {
        const dk = dismissKey(relay, key);
        if (map[dk] === undefined) map[dk] = migrateAt;
      }
      localStorage.removeItem(k);
      migrated = true;
    }
  } catch { /* storage blocked */ }
  if (migrated) writeJson(DISMISS_PREFIX + viewer, map);
  return map;
}
export function writeDismissMap(viewer: string, map: DismissMap): void {
  // Keep the newest 2000 so the synced settings stay small.
  const entries = Object.entries(map).sort((x, y) => y[1] - x[1]).slice(0, 2000);
  writeJson(DISMISS_PREFIX + viewer, Object.fromEntries(entries));
}
export function recordDismissal(viewer: string, relayUrl: string, key: string, at = nowSec()): void {
  writeDismissMap(viewer, { ...readDismissMap(viewer), [dismissKey(relayUrl, key)]: at });
}
export function dismissedAtFor(map: DismissMap, relayUrl: string, key: string): number | undefined {
  return map[dismissKey(relayUrl, key)];
}
export function mergeDismissMaps(a: DismissMap, b: DismissMap): DismissMap {
  const out: DismissMap = { ...a };
  for (const [k, v] of Object.entries(b)) if (out[k] === undefined || v > out[k]) out[k] = v;
  return out;
}
