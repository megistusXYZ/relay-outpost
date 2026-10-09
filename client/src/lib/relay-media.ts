/**
 * Media on your relay: newlay's Blossom store, the owner's view over every
 * file (relay.tools Feeds; docs/MANAGEMENT_API.md §3.14), in plain words.
 * getblobstats is a full scan on the relay — read it when the screen opens,
 * never on a timer.
 */

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const HEX64 = /^[0-9a-f]{64}$/;

export interface MediaStatsView {
  summary: string;
  /** Who uploads most, as the relay ranks them. */
  top: Array<{ pubkey: string; line: string }>;
}

export function describeMediaStats(stats: unknown): MediaStatsView | null {
  if (!isObj(stats) || typeof stats.count !== "number" || typeof stats.bytes !== "number") return null;
  if (stats.count === 0) return { summary: "No files yet", top: [] };
  const owners = typeof stats.owners === "number" ? stats.owners : 0;
  const top = (Array.isArray(stats.top_owners) ? stats.top_owners : [])
    .filter((o: any) => isObj(o) && typeof o.pubkey === "string" && HEX64.test(o.pubkey) && typeof o.count === "number" && typeof o.bytes === "number")
    .map((o: any) => ({ pubkey: o.pubkey, line: `${plural(o.count, "file")} · ${fileSize(o.bytes)}` }));
  return { summary: `${plural(stats.count, "file")} · ${fileSize(stats.bytes)} · from ${plural(owners, "person", "people")}`, top };
}

export interface MediaFile {
  sha256: string;
  kind: "image" | "video" | "audio" | "other";
  type: string;
  size: string;
  /** A web link for the preview, or null when the relay sent anything else. */
  url: string | null;
  uploaded: number;
  owners: string[];
}

function kindOf(type: string): MediaFile["kind"] {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "other";
}

function webUrl(u: unknown): string | null {
  if (typeof u !== "string") return null;
  try { const p = new URL(u); return p.protocol === "https:" || p.protocol === "http:" ? p.href : null; } catch { return null; }
}

/** One listblobs page; `next` is the cursor for the following page (null: that was the last). */
export function readMediaPage(result: unknown): { files: MediaFile[]; next: string | null } | null {
  if (!isObj(result) || !Array.isArray(result.blobs)) return null;
  const files: MediaFile[] = [];
  for (const b of result.blobs) {
    if (!isObj(b) || typeof b.sha256 !== "string" || !HEX64.test(b.sha256)) continue;
    const type = typeof b.type === "string" ? b.type : "";
    files.push({
      sha256: b.sha256,
      kind: kindOf(type),
      type,
      size: fileSize(typeof b.size === "number" ? b.size : 0),
      url: webUrl(b.url),
      uploaded: typeof b.uploaded === "number" ? b.uploaded : 0,
      owners: (Array.isArray(b.owners) ? b.owners : []).map((o: any) => o?.pubkey).filter((p: unknown): p is string => typeof p === "string" && HEX64.test(p)),
    });
  }
  return { files, next: typeof result.next_cursor === "string" && HEX64.test(result.next_cursor) ? result.next_cursor : null };
}

/** newlay answers every media call this way when its host left media storage off. */
export function mediaIsOff(error: string | undefined): boolean {
  return /blossom is disabled/i.test(error ?? "");
}
