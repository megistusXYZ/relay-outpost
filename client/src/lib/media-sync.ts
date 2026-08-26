// "Sync my media" (Blossom Phase C) — enumerate the user's published media and
// mirror each blob to a chosen Blossom server, server-to-server (BUD-04).
//
// Web/PWA-safe by design: the device only sends small "copy this URL" requests
// (PUT /mirror) — bytes never pass through the phone, so there is NO
// download-and-re-upload fallback anywhere in this module. Progress is
// checkpointed to localStorage per target server (keyed by sha256), so a
// suspended PWA or an interrupted run simply resumes: already-mirrored blobs
// are skipped on the next run. Everything soft-fails; nothing here throws.
//
// Pure parts (collectMediaFromEvents, checkpoints, runMediaSync with an
// injected mirror fn) are unit-tested in media-sync.test.ts; only
// enumerateMyMediaUrls touches the relay pool.

import { pool, DEFAULT_RELAYS } from "@/lib/nostr";
import { getUserNotesFetchRelays } from "@/lib/outbox";
import {
  extractSha256FromUrl,
  mirrorBlob,
  type BlossomSignerLike,
  type MirrorResult,
} from "@/lib/blossom-media";
import { parseImetaTags, classifyUrl } from "@/lib/media-utils";

// ── What we scan ─────────────────────────────────────────────────────────────

/**
 * Event kinds that plausibly carry the user's own media:
 * 0 profile (picture/banner), 1 notes, 20 pictures (NIP-68), 21/22 videos
 * (NIP-71), 1063 file metadata (NIP-94), 30023 long-form articles.
 *
 * Deliberately excluded: reposts (kind 6 — someone else's media) and every
 * Concord kind — Concord media references live inside encrypted payloads
 * (and are key-bound ciphertext blobs), so they never surface here.
 */
export const MEDIA_SYNC_KINDS: number[] = [0, 1, 20, 21, 22, 1063, 30023];

/** Newest-first event cap — an honest bound, surfaced in the UI when hit. */
export const MEDIA_SYNC_EVENT_CAP = 500;

/** Mirror requests in flight at once (small on purpose: this is a background chore). */
export const MEDIA_SYNC_CONCURRENCY = 2;

const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

export interface MediaSyncItem {
  /** Source URL the target server will pull the blob from. */
  url: string;
  /** Content fingerprint — mirroring is hash-addressed, so this is required. */
  sha256: string;
}

export interface MediaEnumeration {
  /** Deduped (by sha256) mirrorable media, newest first. */
  items: MediaSyncItem[];
  /**
   * Media URLs with NO derivable fingerprint (no imeta `x`, no hash in the
   * URL path) — posted before mirroring existed or via a non-content-addressed
   * host. These cannot be mirrored by hash; the UI reports them as skipped.
   */
  skippedNoHash: number;
  /** Events actually scanned (after dedupe + cap). */
  scannedEvents: number;
  /** True when the event cap was hit — older posts may not be covered. */
  capped: boolean;
}

// ── Pure extraction ──────────────────────────────────────────────────────────

interface EventLike {
  id?: string;
  kind?: number;
  created_at?: number;
  content?: string;
  tags?: string[][];
}

// Same shape as media-utils' extractMediaFromContent URL scan.
const CONTENT_URL_RE = /(https?:\/\/[^\s<>"]+)/g;

function isMediaClassified(url: string): boolean {
  const type = classifyUrl(url);
  return type === "image" || type === "video" || type === "audio";
}

/**
 * Collect mirrorable media from a set of the user's events (pure — no relay
 * I/O). Sources, in order of trust:
 *  a) NIP-92 `imeta` tags — url + explicit `x` fingerprint when present;
 *  b) NIP-94-style event-level `url` tags paired with an event-level `x` tag;
 *  c) raw http(s) URLs in content — kept when they classify as image/video/
 *     audio by extension, or when their path carries a Blossom-style 64-hex
 *     segment (content-addressed blob, extension or not).
 * A candidate without a derivable sha256 counts toward `skippedNoHash`
 * (mirroring is hash-addressed). Results are deduped by fingerprint, first
 * (newest) URL wins.
 */
export function collectMediaFromEvents(
  events: EventLike[],
  opts?: { capped?: boolean },
): MediaEnumeration {
  const bySha = new Map<string, MediaSyncItem>();
  const noHashUrls = new Set<string>();

  const consider = (url: string | undefined, explicitSha?: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const explicit = explicitSha && SHA256_HEX.test(explicitSha) ? explicitSha.toLowerCase() : undefined;
    const fromUrl = extractSha256FromUrl(url)?.sha256;
    const sha256 = explicit ?? fromUrl;
    // Content-addressed URLs (hash in path) are media-by-construction; others
    // must look like media by extension. Explicitly fingerprinted entries
    // (imeta/x) were declared media by the event itself.
    const isMedia = !!explicit || !!fromUrl || isMediaClassified(url);
    if (!isMedia) return;
    if (!sha256) {
      noHashUrls.add(url);
      return;
    }
    if (!bySha.has(sha256)) bySha.set(sha256, { url, sha256 });
  };

  for (const event of events) {
    const tags = Array.isArray(event?.tags) ? event.tags : [];

    // a) imeta tags (url + x when present)
    try {
      for (const meta of parseImetaTags(tags)) consider(meta.url, meta.sha256);
    } catch {}

    // b) NIP-94-style url/x tag pairs (kind 1063 and friends)
    const eventX = tags.find((t) => t?.[0] === "x" && typeof t[1] === "string")?.[1];
    for (const tag of tags) {
      if (tag?.[0] === "url" && typeof tag[1] === "string") consider(tag[1], eventX);
    }

    // c) raw URLs in content
    const content = typeof event?.content === "string" ? event.content : "";
    if (content) {
      CONTENT_URL_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = CONTENT_URL_RE.exec(content)) !== null) consider(match[1]);
    }
  }

  // A URL that produced a fingerprinted item elsewhere isn't "skipped".
  const itemUrls = new Set(Array.from(bySha.values(), (i) => i.url));
  let skippedNoHash = 0;
  for (const url of noHashUrls) if (!itemUrls.has(url)) skippedNoHash++;

  return {
    items: Array.from(bySha.values()),
    skippedNoHash,
    scannedEvents: events.length,
    capped: opts?.capped ?? false,
  };
}

// ── Enumeration (relay I/O) ──────────────────────────────────────────────────

/**
 * Query the user's own events (write relays + defaults, newest first, capped)
 * and extract mirrorable media. Soft-fails to an empty enumeration.
 */
export async function enumerateMyMediaUrls(
  pubkey: string,
  opts?: { relays?: string[]; eventCap?: number },
): Promise<MediaEnumeration> {
  const cap = opts?.eventCap ?? MEDIA_SYNC_EVENT_CAP;
  let relays: string[] = [];
  try {
    relays = opts?.relays ?? getUserNotesFetchRelays(pubkey, 6);
  } catch {}
  if (relays.length === 0) relays = DEFAULT_RELAYS.slice(0, 4);

  let events: EventLike[] = [];
  try {
    events = await pool.querySync(
      relays,
      { kinds: MEDIA_SYNC_KINDS, authors: [pubkey], limit: cap },
      { maxWait: 8000 } as any,
    );
  } catch {
    events = [];
  }

  // Dedupe by id across relays, newest first, honest cap.
  const seen = new Set<string>();
  const unique: EventLike[] = [];
  for (const event of events) {
    const id = event?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(event);
  }
  unique.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));
  const capped = unique.length >= cap;
  return collectMediaFromEvents(unique.slice(0, cap), { capped });
}

// ── Checkpoints (localStorage, keyed by target server) ───────────────────────

export type MediaSyncStatus = "ok" | "failed";

export interface MediaSyncCheckpointEntry {
  status: MediaSyncStatus;
  reason?: string;
  at: number;
}

const CHECKPOINT_PREFIX = "relay-outpost-media-sync:";

function normalizeTarget(targetServer: string): string {
  try {
    return new URL(targetServer).origin;
  } catch {
    return targetServer.trim().replace(/\/+$/, "");
  }
}

export function syncCheckpointKey(targetServer: string): string {
  return CHECKPOINT_PREFIX + normalizeTarget(targetServer);
}

export function readSyncCheckpoint(
  targetServer: string,
): Record<string, MediaSyncCheckpointEntry> {
  try {
    const raw = localStorage.getItem(syncCheckpointKey(targetServer));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {}
  return {};
}

function writeSyncCheckpoint(
  targetServer: string,
  map: Record<string, MediaSyncCheckpointEntry>,
): void {
  try {
    localStorage.setItem(syncCheckpointKey(targetServer), JSON.stringify(map));
  } catch {}
}

/** Record one blob's outcome (exported for tests; runMediaSync calls it per item). */
export function recordSyncResult(
  targetServer: string,
  sha256: string,
  entry: MediaSyncCheckpointEntry,
): void {
  const map = readSyncCheckpoint(targetServer);
  map[sha256] = entry;
  writeSyncCheckpoint(targetServer, map);
}

/** Forget failures for this target so a retry re-attempts ONLY the failed blobs. */
export function clearFailedSyncCheckpoints(targetServer: string): void {
  const map = readSyncCheckpoint(targetServer);
  let changed = false;
  for (const key of Object.keys(map)) {
    if (map[key]?.status === "failed") {
      delete map[key];
      changed = true;
    }
  }
  if (changed) writeSyncCheckpoint(targetServer, map);
}

// ── The sync run ─────────────────────────────────────────────────────────────

/** nostr.build is NIP-96 (no BUD-04 /mirror) — never offer it as a sync target. */
export function isMirrorCapableTarget(serverUrl: string): boolean {
  try {
    const host = new URL(serverUrl).hostname.toLowerCase();
    return host !== "nostr.build" && !host.endsWith(".nostr.build");
  } catch {
    return false;
  }
}

/** Short human reason for a failed BUD-04 mirror attempt. */
export function mirrorFailureReason(result: MirrorResult): string {
  const status = result.status;
  if (status === 404 || status === 405 || status === 501) return "server doesn't support mirroring";
  if (status === 401 || status === 403) return "server refused authorization";
  if (status === 413) return "too large for this server";
  if (status === 429) return "rate limited by server";
  if (typeof status === "number") return `server error (${status})`;
  return "network error";
}

export interface MediaSyncProgress {
  done: number;
  total: number;
  failed: number;
  /** Skipped as already present (checkpointed ok, or hosted on the target). */
  alreadyDone: number;
  /** URL currently being mirrored (for the "current file" line). */
  current?: string;
}

export interface MediaSyncRunResult {
  total: number;
  ok: number;
  failed: number;
  alreadyDone: number;
  aborted: boolean;
  failures: Array<{ url: string; sha256: string; reason: string }>;
}

export interface RunMediaSyncOptions {
  items: MediaSyncItem[];
  targetServer: string;
  signer?: BlossomSignerLike | null;
  onProgress?: (progress: MediaSyncProgress) => void;
  signal?: AbortSignal;
  /** Clamped to 1..MEDIA_SYNC_CONCURRENCY. */
  concurrency?: number;
  /** Test seam — defaults to the real BUD-04 mirrorBlob. */
  mirrorFn?: (
    sourceUrl: string,
    sha256: string,
    targetServer: string,
    signer?: BlossomSignerLike | null,
  ) => Promise<MirrorResult>;
}

/**
 * Mirror each item to `targetServer` (BUD-04, server-to-server only) with
 * bounded concurrency. Every outcome is checkpointed as it lands, so a rerun
 * skips already-ok blobs (resume). Cancellation via AbortSignal stops cleanly
 * after in-flight requests settle. Never throws.
 */
export async function runMediaSync(opts: RunMediaSyncOptions): Promise<MediaSyncRunResult> {
  const {
    items,
    targetServer,
    signer,
    onProgress,
    signal,
    mirrorFn = mirrorBlob,
  } = opts;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? MEDIA_SYNC_CONCURRENCY, MEDIA_SYNC_CONCURRENCY));

  const checkpoint = readSyncCheckpoint(targetServer);
  const targetOrigin = normalizeTarget(targetServer);

  let done = 0;
  let ok = 0;
  let failed = 0;
  let alreadyDone = 0;
  let current: string | undefined;
  const failures: MediaSyncRunResult["failures"] = [];

  const emit = () => {
    try {
      onProgress?.({ done, total: items.length, failed, alreadyDone, current });
    } catch {}
  };

  const queue = items.slice();
  const worker = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const item = queue.shift();
      if (!item) return;

      // Resume: a previous run already landed this blob on this server.
      if (checkpoint[item.sha256]?.status === "ok") {
        alreadyDone++;
        done++;
        emit();
        continue;
      }

      // The blob already lives on the target — nothing to copy.
      let sourceOrigin: string | null = null;
      try {
        sourceOrigin = new URL(item.url).origin;
      } catch {}
      if (sourceOrigin && sourceOrigin === targetOrigin) {
        checkpoint[item.sha256] = { status: "ok", reason: "already on this server", at: Date.now() };
        recordSyncResult(targetServer, item.sha256, checkpoint[item.sha256]);
        alreadyDone++;
        done++;
        emit();
        continue;
      }

      current = item.url;
      emit();
      let result: MirrorResult;
      try {
        result = await mirrorFn(item.url, item.sha256, targetServer, signer);
      } catch {
        result = { ok: false };
      }

      if (result.ok) {
        ok++;
        checkpoint[item.sha256] = { status: "ok", at: Date.now() };
      } else {
        failed++;
        const reason = mirrorFailureReason(result);
        checkpoint[item.sha256] = { status: "failed", reason, at: Date.now() };
        failures.push({ url: item.url, sha256: item.sha256, reason });
      }
      recordSyncResult(targetServer, item.sha256, checkpoint[item.sha256]);
      done++;
      if (current === item.url) current = undefined;
      emit();
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } catch {}

  current = undefined;
  emit();
  return {
    total: items.length,
    ok,
    failed,
    alreadyDone,
    aborted: !!signal?.aborted,
    failures,
  };
}
