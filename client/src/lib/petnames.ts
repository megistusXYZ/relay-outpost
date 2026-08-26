/**
 * Petnames — YOUR names for people, groups and communities. Private by
 * construction: stored locally, synced across your devices through the
 * encrypted NIP-78 settings event, never published anywhere a peer could read.
 *
 * Why this pattern earns its place beyond convenience: a display name is the
 * SUBJECT'S claim and changes whenever they like — a petname is YOUR claim and
 * cannot be spoofed by a profile rename. It is the oldest identity idea in
 * Nostr's neighbourhood, kept private (the original kind-3 petname field was
 * public, which is why nobody used it).
 *
 * The real name is never destroyed, only out-shone: `displayNameWith` prefers
 * the petname for list rendering, and the surfaces that manage a subject
 * (profile page, the rename dialog) always show both — "you call this X".
 * Search matches BOTH names, because renaming something must not make it
 * unfindable by the name everyone else uses in conversation.
 */
import { useSyncExternalStore } from "react";

export type PetnameKind = "person" | "group" | "community";

export interface Petname {
  /** Your name for them. Absent = keep the real name (emoji/color only). */
  name?: string;
  /** Avatar override: a single emoji rendered as the row's avatar. */
  emoji?: string;
  /** Avatar override: a background color (hex) behind the emoji/initials. */
  color?: string;
}

export const PETNAMES_LS_KEY = "relay-outpost-petnames";

/**
 * Cap so the NIP-78 settings event stays a settings event, not a database.
 * Insertion-ordered map: at the cap the OLDEST assignment gives way — the
 * things you renamed years ago and never opened since, not the one you just
 * typed.
 */
export const PETNAMES_MAX_ENTRIES = 200;

export function keyOf(kind: PetnameKind, id: string): string {
  // Community ids are relay urls, where trailing slash / case are not
  // differences (same rule as pinned-feeds' normalizeUrl).
  const normalized = kind === "community" ? id.trim().replace(/\/+$/, "").toLowerCase() : id;
  return `${kind[0]}:${normalized}`;
}

type PetnameMap = Record<string, Petname>;

function readMap(): PetnameMap {
  try {
    const raw = localStorage.getItem(PETNAMES_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: PetnameMap): void {
  // Written through localStorage.setItem so the NIP-78 watcher schedules a sync.
  try { localStorage.setItem(PETNAMES_LS_KEY, JSON.stringify(map)); } catch {}
  bump();
}

export function getPetname(kind: PetnameKind, id: string): Petname | undefined {
  return readMap()[keyOf(kind, id)];
}

export function setPetname(kind: PetnameKind, id: string, value: Petname): void {
  const map = readMap();
  const name = value.name?.trim();
  const emoji = value.emoji?.trim();
  const entry: Petname = {
    ...(name ? { name } : {}),
    ...(emoji ? { emoji } : {}),
    ...(value.color ? { color: value.color } : {}),
  };
  const key = keyOf(kind, id);
  if (Object.keys(entry).length === 0) {
    // An empty write IS a clear — no ghost entries accumulating in the sync.
    delete map[key];
    writeMap(map);
    return;
  }
  // Re-inserting moves the entry to the newest position (delete-then-set), so
  // the cap below always evicts the least recently ASSIGNED.
  delete map[key];
  map[key] = entry;
  const keys = Object.keys(map);
  if (keys.length > PETNAMES_MAX_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - PETNAMES_MAX_ENTRIES)) delete map[stale];
  }
  writeMap(map);
}

export function clearPetname(kind: PetnameKind, id: string): void {
  const map = readMap();
  delete map[keyOf(kind, id)];
  writeMap(map);
}

// ── The real↔custom flip ─────────────────────────────────────────────────────
// A session toggle (deliberately NOT persisted: "show me the real names for a
// moment" is a glance, not a mode you should find yourself stuck in tomorrow).
// One flag flips every petname surface at once — names via displayNameWith,
// avatars via overridesSuppressed() at the tile call sites.
let showReal = false;

export function isShowingRealNames(): boolean {
  return showReal;
}

export function toggleShowRealNames(): void {
  showReal = !showReal;
  bump();
}

/** True when the user has ANY petnames — the toggle renders only then; a
 *  real-names switch for someone who renamed nothing is a dead control. */
export function hasAnyPetnames(): boolean {
  return Object.keys(readMap()).length > 0;
}

/** The list-rendering rule: your name wins, the real name is the fallback —
 *  unless the session flip says "show me the real ones". */
export function displayNameWith(kind: PetnameKind, id: string, realName: string): string {
  if (showReal) return realName;
  return getPetname(kind, id)?.name ?? realName;
}

/** Search must find a subject by EITHER name. */
export function matchesQueryWith(kind: PetnameKind, id: string, realName: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (realName.toLowerCase().includes(q)) return true;
  const pet = getPetname(kind, id)?.name;
  return !!pet && pet.toLowerCase().includes(q);
}

// ── Reactivity ───────────────────────────────────────────────────────────────
// A version counter rather than per-subject subscriptions: list surfaces
// re-derive whole rows anyway, and a petname edit is rare — one bump, every
// consumer re-reads. Cross-tab + NIP-78 remote applies arrive as events.
let version = 0;
const listeners = new Set<() => void>();
function bump(): void {
  version++;
  listeners.forEach((l) => l());
  try { window.dispatchEvent(new CustomEvent("petnames-changed")); } catch {}
}

let externalInstalled = false;
function ensureExternalListeners(): void {
  if (externalInstalled || typeof window === "undefined") return;
  externalInstalled = true;
  const onExternal = () => { version++; listeners.forEach((l) => l()); };
  window.addEventListener("storage", onExternal);
  window.addEventListener("nip78-settings-applied", onExternal);
  // Also our own channel: petname-images.ts announces photo loads/removals
  // this way (a local write double-bumps — harmless, renders are idempotent).
  window.addEventListener("petnames-changed", onExternal);
}

function subscribe(cb: () => void): () => void {
  ensureExternalListeners();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Re-renders consumers whenever any petname changes (local, cross-tab, or synced). */
export function usePetnamesVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0);
}
