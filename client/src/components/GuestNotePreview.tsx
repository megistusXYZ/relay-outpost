// Phase 3: read-only preview of a shared NOTE (/thread/<noteId>) for a logged-out
// visitor. Same slim, signer-less, pubkey-less pattern as GuestChannelPreview.
// The post renders with FULL logged-in fidelity via GuestPostBody (media/video/
// mentions). The reply CONVERSATION is intentionally NOT shown to guests — public
// viewing is read-only of the authored post; engagement (replies) requires sign-in.

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { nip19, type Event } from "nostr-tools";
import { pool, fetchProfilesCached, eventStore } from "@/lib/nostr";
import { getDisplayName, getAvatarUrl, shortenNpub, formatNpub, KIND_METADATA } from "@/lib/nostr-helpers";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { GuestPostBody } from "@/components/GuestPostBody";
import { ThreadEndBlock } from "@/components/nostr-post/ThreadEndBlock";
import { canReachAny } from "@/lib/relay-reach";
import { guestFetchOutcome, type GuestFetchOutcome } from "@/lib/guest-fetch-outcome";

export const GUEST_READ_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.nostr.band", "wss://purplepag.es"];

export function guestSignIn(navigate: (to: string) => void) {
  // Stash the deep link so signing in returns the visitor to this exact content.
  try { sessionStorage.setItem("relay-outpost-post-auth-redirect", window.location.pathname + window.location.search); } catch {}
  navigate("/login");
}

function decodeNoteId(raw: string): { id: string | null; relays: string[]; author?: string } {
  try {
    if (raw.startsWith("nevent")) {
      const d = nip19.decode(raw);
      if (d.type === "nevent") {
        const data = d.data as { id: string; relays?: string[]; author?: string };
        return { id: data.id, relays: data.relays || [], author: data.author };
      }
    } else if (raw.startsWith("note1")) {
      const d = nip19.decode(raw);
      if (d.type === "note") return { id: d.data as string, relays: [] };
    } else if (/^[0-9a-f]{64}$/i.test(raw)) {
      return { id: raw.toLowerCase(), relays: [] };
    }
  } catch {}
  return { id: null, relays: [] };
}

export function GuestAuthorRow({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]) as Event | undefined;
  useEffect(() => { if (!profile) fetchProfilesCached([pubkey]); }, [pubkey, profile]);
  const name = profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey));
  const avatar = profile ? getAvatarUrl(profile) : undefined;
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="w-9 h-9 shrink-0">
        {avatar && <AvatarImage src={avatar} alt={name} />}
        <AvatarFallback className="text-xs bg-brand/10 text-brand">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <p className="text-sm font-semibold truncate">{name}</p>
    </div>
  );
}

export function GuestNotePreview({ noteId }: { noteId: string }) {
  const [, navigate] = useLocation();
  const [note, setNote] = useState<Event | null>(null);
  const [outcome, setOutcome] = useState<GuestFetchOutcome>("loading");
  const [attempt, setAttempt] = useState(0);
  // Reply-author pubkeys — the guest preview doesn't render the conversation,
  // but the people who spoke in it are the adoption hook ("sign in to follow").
  const [participants, setParticipants] = useState<string[]>([]);

  useEffect(() => {
    setNote(null);
    setOutcome("loading");
    setParticipants([]);
    const { id, relays, author } = decodeNoteId(noteId);
    if (!id) { setOutcome("not-found"); return; }
    let cancelled = false;
    // Three-outcome endgame (guest-fetch-outcome.ts): EOSE alone is NOT an
    // answer — a cold guest pool's failed connects EOSE instantly, and this
    // exact preview told a visitor a real post "couldn't be found" (measured
    // live 2026-08-18). CONNECTING is the reachability signal; "not found" is
    // only claimed once somebody was provably reached AND finished answering.
    const signals = { found: false, eosed: false, reached: null as boolean | null, timedOut: false };
    // Terminal-state ladder: before settling on EITHER failure, ask Primal's
    // cache once by id. A share link can point at a post that lives only on
    // the author's own write relays (measured live 2026-08-18: this exact
    // post was on none of the guest relays NOR the author's NIP-65 set, yet
    // Primal's crawler had it) — and the cache is plain wss, reachable even
    // when the guest relay set isn't.
    let primalTried = false;
    const classify = () => {
      if (cancelled || signals.found) return;
      const o = guestFetchOutcome(signals);
      if (o !== "not-found" && o !== "unreachable") { setOutcome(o); return; }
      if (primalTried) { setOutcome(o); return; }
      primalTried = true;
      (async () => {
        try {
          const pc = await import("@/lib/primal-cache");
          const hits = await pc.fetchPrimalEventsById([id]);
          if (hits.length > 0) return hits[0];
        } catch { /* cache miss/down — the outbox rung below still runs */ }
        // Outbox rung: share links now carry the AUTHOR (share-links.ts), so
        // a miss can follow NIP-65 to the author's own write relays — the
        // same recovery the article preview uses.
        if (!author) return null;
        try {
          const lists = await pool.querySync(GUEST_READ_RELAYS, { kinds: [10002], authors: [author], limit: 1 });
          const writes = (lists[0]?.tags ?? [])
            .filter((t: string[]) => t[0] === "r" && t[1] && (!t[2] || t[2] === "write"))
            .map((t: string[]) => t[1])
            .slice(0, 6);
          if (writes.length === 0) return null;
          const evs = await pool.querySync(writes, { ids: [id], limit: 1 });
          return evs[0] ?? null;
        } catch { return null; }
      })()
        .then((hit) => {
          if (cancelled || signals.found) return;
          if (hit) { signals.found = true; setNote(hit); setOutcome("found"); }
          else setOutcome(o);
        })
        .catch(() => { if (!cancelled && !signals.found) setOutcome(o); });
    };
    const allRelays = [...GUEST_READ_RELAYS, ...relays];
    canReachAny(allRelays).then((r) => { signals.reached = r; classify(); }).catch(() => { signals.reached = false; classify(); });
    const sub = pool.subscribeMany(allRelays, { ids: [id], limit: 1 }, {
      onevent(e: Event) { if (!cancelled) { signals.found = true; setNote(e); setOutcome("found"); } },
      oneose() { signals.eosed = true; classify(); },
    });
    // Separately gather who replied (public read) so the block can show faces.
    const seen = new Set<string>();
    const rsub = pool.subscribeMany(allRelays, { kinds: [1], "#e": [id], limit: 60 }, {
      onevent(e: Event) {
        if (cancelled || seen.has(e.pubkey)) return;
        seen.add(e.pubkey);
        setParticipants((prev) => (prev.includes(e.pubkey) ? prev : [...prev, e.pubkey]));
      },
      oneose() {},
    });
    const t = setTimeout(() => { signals.timedOut = true; classify(); }, 8_000);
    return () => { cancelled = true; clearTimeout(t); try { sub.close(); } catch {} try { rsub.close(); } catch {} };
  }, [noteId, attempt]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background" data-testid="guest-note-preview">
      <div className="flex items-center gap-3 px-3 border-b border-border/40 shrink-0 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2">
        <button onClick={() => navigate("/")} className="p-1.5 -ml-1 text-muted-foreground hover:text-foreground" aria-label="Back" data-testid="guest-note-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <p className="text-sm font-semibold flex-1">Post</p>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/[0.06] border-b border-border/30 shrink-0">
        <ShieldCheck className="w-3.5 h-3.5 text-brand/70 shrink-0" />
        <p className="text-[11px] text-muted-foreground">Guest view · sign in to reply, react &amp; use your Web of Trust</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {outcome === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> <span className="text-sm">Loading…</span>
          </div>
        )}
        {/* Two DIFFERENT failures, said differently: the relays answering "no
            such post" is not the same claim as us never getting through — and
            the second one earns a retry, because it usually succeeds. */}
        {outcome === "not-found" && (
          <div className="text-center py-16 text-sm text-muted-foreground px-6" data-testid="guest-note-notfound">
            The relays we can reach as a guest don't have this post.
          </div>
        )}
        {outcome === "unreachable" && (
          <div className="text-center py-16 px-6 space-y-3" data-testid="guest-note-unreachable">
            <p className="text-sm text-muted-foreground">Couldn't reach the network to load this post.</p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)} data-testid="guest-note-retry">
              Try again
            </Button>
          </div>
        )}
        {note && (
          <div className="max-w-xl mx-auto">
            <div className="flex flex-col gap-3">
              <GuestAuthorRow pubkey={note.pubkey} />
              <GuestPostBody event={note} />
            </div>
            <ThreadEndBlock
              rootEvent={note}
              guest
              participantsOverride={[note.pubkey, ...participants]}
              onSignIn={() => guestSignIn(navigate)}
            />
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border/40 px-3 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <Button onClick={() => guestSignIn(navigate)} className="w-full min-h-[44px]" data-testid="guest-note-signin">
          Sign in to reply &amp; see the conversation
        </Button>
      </div>
    </div>
  );
}
