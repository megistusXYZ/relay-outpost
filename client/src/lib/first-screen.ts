/**
 * A stranger's first screen, handed over by our server (server/first-screen.ts):
 * recent notes by people the default lens trusts, their trust scores, and
 * their profiles. The guest For-you feed shows them the moment the page
 * mounts instead of waiting on relays and the spam floor's lookups.
 *
 * Everything is signed by its author and checked here; a note or profile
 * whose signature doesn't hold is dropped, so nothing is shown on the
 * server's word alone.
 *
 * index.html starts the request for a signed-out visitor on "/" while the
 * HTML is still parsing (window.__roFirstScreen); takeFirstScreen() uses that
 * answer when it's there and asks itself when it isn't.
 */
import { verifyEvent, type Event } from "nostr-tools";
import { isNote } from "@shared/feed-sample";
import { isSignedEvent } from "@shared/discover-samples";

export interface FirstScreenData {
  notes: Event[];
  profiles: Event[];
  /** Author → trust score (0-1) on the default lens. */
  ranks: Map<string, number>;
}

export function readFirstScreen(raw: unknown, verify: (e: Event) => boolean = verifyEvent): FirstScreenData | null {
  const body = raw as { notes?: unknown; profiles?: unknown; ranks?: unknown } | null;
  if (!body || !Array.isArray(body.notes)) return null;
  const notes = body.notes.filter((n): n is Event => isNote(n) && verify(n as Event));
  if (notes.length === 0) return null;
  const authors = new Set(notes.map((n) => n.pubkey));
  const profiles: Event[] = [];
  if (body.profiles && typeof body.profiles === "object") {
    for (const [pk, p] of Object.entries(body.profiles as Record<string, unknown>)) {
      if (!authors.has(pk) || !isSignedEvent(p, [0]) || p.pubkey !== pk) continue;
      if (verify(p as Event)) profiles.push(p as Event);
    }
  }
  const ranks = new Map<string, number>();
  if (body.ranks && typeof body.ranks === "object") {
    for (const [pk, v] of Object.entries(body.ranks as Record<string, unknown>)) {
      if (authors.has(pk) && typeof v === "number" && v >= 0 && v <= 1) ranks.set(pk, v);
    }
  }
  return { notes, profiles, ranks };
}

declare global {
  interface Window { __roFirstScreen?: Promise<unknown> }
}

/** The first screen, once: the HTML's early request when it made one, else a request now. */
export async function takeFirstScreen(): Promise<FirstScreenData | null> {
  try {
    const early = typeof window !== "undefined" ? window.__roFirstScreen : undefined;
    if (typeof window !== "undefined") window.__roFirstScreen = undefined;
    const raw = early
      ? await early
      : await fetch("/api/first-screen", { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.json() : null));
    return readFirstScreen(raw);
  } catch {
    return null;
  }
}
