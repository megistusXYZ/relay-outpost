/**
 * Compact relative timestamps for post headers — X/Primal style: "now", "1m",
 * "3h", "2d", "3w", then a short date. Replaces verbose "less than a minute ago".
 */
export function formatCompactTime(unixSeconds: number, nowMs: number = Date.now()): string {
  const diff = Math.max(0, nowMs / 1000 - unixSeconds);
  if (diff < 45) return "now";
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d`;
  if (diff < 2629800) return `${Math.round(diff / 604800)}w`; // < ~1 month
  try {
    const d = new Date(unixSeconds * 1000);
    const sameYear = new Date(nowMs).getFullYear() === d.getFullYear();
    return d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}
