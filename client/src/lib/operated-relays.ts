/**
 * The relays you run, kept where the app already keeps them: your community
 * list (lib/outpost-relays.ts), flagged `isAdmin`. Connecting a relay you run
 * adds it there (locally — nothing is published) and flags it, so the
 * sidebar, the console and the Relays home all read one list.
 *
 * Plus one convenience: the relay you managed last, so Relays opens on it.
 */
import { useSyncExternalStore } from "react";
import { getOutpostRelays, joinOutpost, saveOutpostRelays, type OutpostRelay } from "./outpost-relays";

const LAST_KEY = "ro_ops_last_relay";
const CHANGED = "outpost-relays-changed";

const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();

export function getOperatedRelays(): OutpostRelay[] {
  return getOutpostRelays().filter((r) => r.isAdmin);
}

/** Add a relay you've proven you run, and mark it as yours. */
export function connectOperatedRelay(url: string, label: string): void {
  joinOutpost(url, label);
  const relays = getOutpostRelays().map((r) => {
    if (norm(r.url) !== norm(url)) return r;
    const { operatorOverride: _off, ...rest } = r;
    return { ...rest, isAdmin: true };
  });
  saveOutpostRelays(relays);
}

export function getLastUsedRelay(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

export function setLastUsedRelay(url: string): void {
  try { localStorage.setItem(LAST_KEY, url); } catch {}
}

/** The relay Relays opens on: the one used last if you still run it, else the first. */
export function pickHomeRelay(operated: readonly { url: string }[], last: string | null): string | null {
  if (operated.length === 0) return null;
  if (last) {
    const hit = operated.find((r) => norm(r.url) === norm(last));
    if (hit) return hit.url;
  }
  return operated[0].url;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

let cacheKey = "";
let cacheList: OutpostRelay[] = [];
function snapshot(): OutpostRelay[] {
  const list = getOperatedRelays();
  const key = JSON.stringify(list.map((r) => [r.url, r.label]));
  if (key !== cacheKey) { cacheKey = key; cacheList = list; }
  return cacheList;
}

/** The relays you run, live as the list changes. */
export function useOperatedRelays(): OutpostRelay[] {
  return useSyncExternalStore(subscribe, snapshot, () => cacheList);
}
