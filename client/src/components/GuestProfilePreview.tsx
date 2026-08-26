// Phase 3: read-only preview of a shared PROFILE (/profile/<npub>) for a logged-out
// visitor. Same slim, signer-less, pubkey-less pattern. Shows the profile header
// (avatar / name / bio) + the author's recent top-level posts as plain text.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { nip19, type Event } from "nostr-tools";
import { pool, fetchProfilesCached, eventStore } from "@/lib/nostr";
import { getDisplayName, getAvatarUrl, shortenNpub, formatNpub, KIND_METADATA } from "@/lib/nostr-helpers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { GUEST_READ_RELAYS, guestSignIn } from "@/components/GuestNotePreview";
import { GUEST_TASTE_COUNT } from "@/lib/guest-limits";
import { GuestWall } from "@/components/GuestWall";
import { GuestPostBody } from "@/components/GuestPostBody";

// The taste matches the app-wide guest policy (owner decision, 2026-08-14):
// a shared "look at this person" link shows the header + the first screen of
// posts; the rest is membership.
const NOTE_LIMIT = GUEST_TASTE_COUNT;

function decodePubkey(raw: string): string | null {
  try {
    if (raw.startsWith("npub1")) { const d = nip19.decode(raw); if (d.type === "npub") return d.data as string; }
    if (raw.startsWith("nprofile")) { const d = nip19.decode(raw); if (d.type === "nprofile") return (d.data as { pubkey: string }).pubkey; }
    if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
  } catch {}
  return null;
}

function bioOf(profile: Event | undefined): string | undefined {
  if (!profile) return undefined;
  try { const c = JSON.parse(profile.content); return typeof c?.about === "string" ? c.about : undefined; } catch { return undefined; }
}

export function GuestProfilePreview({ npub }: { npub: string }) {
  const [, navigate] = useLocation();
  const pubkey = useMemo(() => decodePubkey(npub), [npub]);
  const [notes, setNotes] = useState<Event[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const profile = use$(() => (pubkey ? eventStore.replaceable(KIND_METADATA, pubkey) : undefined), [pubkey]) as Event | undefined;

  useEffect(() => {
    if (!pubkey) { setLoaded(true); return; }
    setNotes([]);
    setLoaded(false);
    seen.current = new Set();
    fetchProfilesCached([pubkey]);
    let cancelled = false;
    const sub = pool.subscribeMany(GUEST_READ_RELAYS, { kinds: [1], authors: [pubkey], limit: NOTE_LIMIT }, {
      onevent(e: Event) {
        if (cancelled || seen.current.has(e.id)) return;
        // Top-level posts only (skip replies — any "e" tag).
        if (e.tags.some((t) => t[0] === "e")) return;
        seen.current.add(e.id);
        setNotes((prev) => [...prev, e].sort((a, b) => b.created_at - a.created_at).slice(0, NOTE_LIMIT));
      },
      oneose() { if (!cancelled) setLoaded(true); },
    });
    const t = setTimeout(() => { if (!cancelled) setLoaded(true); }, 6000);
    return () => { cancelled = true; clearTimeout(t); try { sub.close(); } catch {} };
  }, [pubkey]);

  const name = profile ? getDisplayName(profile) : pubkey ? shortenNpub(formatNpub(pubkey)) : "Profile";
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  const bio = bioOf(profile);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background" data-testid="guest-profile-preview">
      <div className="flex items-center gap-3 px-3 border-b border-border/40 shrink-0 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2">
        <button onClick={() => navigate("/")} className="p-1.5 -ml-1 text-muted-foreground hover:text-foreground" aria-label="Back" data-testid="guest-profile-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <p className="text-sm font-semibold flex-1 truncate">{name}</p>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/[0.06] border-b border-border/30 shrink-0">
        <ShieldCheck className="w-3.5 h-3.5 text-brand/70 shrink-0" />
        <p className="text-[11px] text-muted-foreground">Guest view · sign in to follow &amp; use your Web of Trust</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {/* Profile header */}
        <div className="flex items-start gap-3 p-4 border-b border-border/30">
          <Avatar className="w-14 h-14 shrink-0">
            {avatar && <AvatarImage src={avatar} alt={name} />}
            <AvatarFallback className="text-base bg-brand/10 text-brand">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold truncate">{name}</p>
            {bio && <p className="text-sm text-muted-foreground mt-1 break-words whitespace-pre-wrap line-clamp-4">{bio}</p>}
          </div>
        </div>
        {/* Recent posts */}
        {!loaded && notes.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> <span className="text-sm">Loading posts…</span>
          </div>
        )}
        {loaded && notes.length === 0 && (
          <div className="text-center py-16 text-sm text-muted-foreground px-6">No recent posts found.</div>
        )}
        {notes.map((n) => (
          <div key={n.id} className="px-4 py-3 border-b border-border/20">
            <GuestPostBody event={n} />
          </div>
        ))}
        {/* A full page of taste implies more behind it; a shorter list would
            read as a wall on nothing (guest-limits' short-list rule). */}
        {loaded && notes.length >= NOTE_LIMIT && (
          <div className="px-4 py-6">
            <GuestWall context={`See more of ${name}'s world`} />
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border/40 px-3 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <Button onClick={() => guestSignIn(navigate)} className="w-full min-h-[44px]" data-testid="guest-profile-signin">
          Sign in to follow &amp; message
        </Button>
      </div>
    </div>
  );
}
