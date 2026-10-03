/**
 * Content's Filter panel: what you narrow to, sent to the relay itself so the
 * page of results is the right page (owner, 2026-10-03: some relays take
 * hundreds of posts a minute — "think Salesforce but simple").
 *
 * Kinds, people and hashtags go into the request (NIP-01 `kinds`, `authors`,
 * `#t`); time stays with the existing range. Each choice shows as a chip you
 * can remove. A set of choices can be saved under a name — on this device for
 * now — and reopened in one tap.
 *
 * Pure apart from the small storage helpers, which take the storage to use.
 */
import { plainKindName } from "@/lib/kind-catalog";
import type { ContentFilter, TypeViewId } from "./content-model";

export interface ContentFilters {
  kinds: number[];
  /** Hex pubkeys. */
  people: string[];
  /** Without the leading #, lower-case. */
  hashtags: string[];
}

export const EMPTY_FILTERS: ContentFilters = { kinds: [], people: [], hashtags: [] };

export function isEmpty(f: ContentFilters): boolean {
  return !f.kinds.length && !f.people.length && !f.hashtags.length;
}

const tag = (t: string) => t.trim().replace(/^#+/, "").toLowerCase();

/** The relay request with the chosen filters folded in. */
export function withFilters(base: ContentFilter, f: ContentFilters): ContentFilter {
  if (base.ids) return base;
  const out: ContentFilter & { "#t"?: string[] } = { ...base };
  if (f.kinds.length) out.kinds = [...f.kinds];
  if (f.people.length) out.authors = [...new Set([...(base.authors ?? []), ...f.people])];
  const tags = [...new Set(f.hashtags.map(tag).filter(Boolean))];
  if (tags.length) out["#t"] = tags;
  return out;
}

export interface Chip { key: string; label: string }

export function filterChips(f: ContentFilters, nameOf: (pk: string) => string | undefined): Chip[] {
  const chips: Chip[] = [];
  if (f.kinds.length) chips.push({ key: "kinds", label: `Kind: ${f.kinds.map(plainKindName).join(", ")}` });
  if (f.people.length) {
    const names = f.people.map((pk) => nameOf(pk) ?? `${pk.slice(0, 8)}…`);
    const shown = names.slice(0, 2).join(", ");
    chips.push({ key: "people", label: `From: ${shown}${names.length > 2 ? ` +${names.length - 2}` : ""}` });
  }
  for (const t of f.hashtags) chips.push({ key: `tag:${tag(t)}`, label: `#${tag(t)}` });
  return chips;
}

export function removeChip(f: ContentFilters, key: string): ContentFilters {
  if (key === "kinds") return { ...f, kinds: [] };
  if (key === "people") return { ...f, people: [] };
  if (key.startsWith("tag:")) return { ...f, hashtags: f.hashtags.filter((t) => tag(t) !== key.slice(4)) };
  return f;
}

// ---- saved views ----

export interface SavedView {
  id: string;
  name: string;
  query: string;
  view: TypeViewId;
  filters: ContentFilters;
  savedAt: number;
}

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }
const keyFor = (relayUrl: string) => `ro_content_views:${relayUrl}`;

export function readSavedViews(relayUrl: string, storage: KV): SavedView[] {
  try {
    const parsed = JSON.parse(storage.getItem(keyFor(relayUrl)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.name === "string" && v.filters) : [];
  } catch {
    return [];
  }
}

export function saveView(relayUrl: string, name: string, view: Pick<SavedView, "query" | "view" | "filters">, storage: KV): SavedView[] {
  const clean = name.trim();
  const others = readSavedViews(relayUrl, storage).filter((v) => v.name.toLowerCase() !== clean.toLowerCase());
  const next = [...others, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean, ...view, savedAt: Date.now() }];
  try { storage.setItem(keyFor(relayUrl), JSON.stringify(next)); } catch {}
  return next;
}

export function deleteView(relayUrl: string, id: string, storage: KV): SavedView[] {
  const next = readSavedViews(relayUrl, storage).filter((v) => v.id !== id);
  try { storage.setItem(keyFor(relayUrl), JSON.stringify(next)); } catch {}
  return next;
}
