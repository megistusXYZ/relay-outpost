/**
 * "Circle" — a Top-8-style grid for the identity rail, populated by the
 * profile's MUTUALS: people they follow who follow them back. Two-way ties
 * can't be manufactured (a spam account following celebrities gets no
 * follow-backs), so a fake account's Circle stays empty while a real one fills
 * for EVERY viewer — guests included. The caller (Profile.tsx) computes the
 * intersection and floats mutuals the signed-in viewer also follows to the
 * front; this component only renders the list.
 *
 * Only people whose kind-0 has actually RESOLVED with a real avatar + name are
 * shown — never a bare npub placeholder — and the section renders only with a
 * populated grid (≥4 resolved): one lonely avatar under a CIRCLE header read
 * as broken.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { AuthorHoverCard } from "@/components/nostr-post/author-hover";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getAvatarUrl, getDisplayName, KIND_METADATA } from "@/lib/nostr-helpers";

/** Real display name (not the npub fallback) from a resolved kind-0. */
function realName(profile: Event): string | null {
  try {
    const c = JSON.parse(profile.content || "{}");
    const n = (c.display_name || c.name || "").trim();
    return n || null;
  } catch {
    return null;
  }
}

/**
 * One face. No caption.
 *
 * The name is carried by AuthorHoverCard — the same preview the feed, threads,
 * polls and Concord chat already use, so a person looks the same everywhere
 * they appear. It self-disables on touch (`supportsHover`), which means on a
 * phone the identification path is the tap: the face goes to the profile.
 * `title` and `aria-label` still carry the name for pointer tooltips and
 * screen readers, so nothing is identified by pixels alone.
 */
function CirclePerson({ pubkey, profile }: { pubkey: string; profile: Event }) {
  const [, navigate] = useLocation();
  const name = realName(profile) ?? getDisplayName(profile);
  const avatar = getAvatarUrl(profile);
  const npub = useMemo(() => { try { return nip19.npubEncode(pubkey); } catch { return ""; } }, [pubkey]);
  return (
    <AuthorHoverCard pubkey={pubkey} profile={profile}>
      <button
        onClick={() => npub && navigate(`/profile/${npub}`)}
        className="block shrink-0 rounded-full ring-offset-2 ring-offset-card transition-shadow hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none"
        title={name}
        aria-label={name}
        data-testid="identity-circle-person"
      >
        <Avatar className="w-12 h-12 border border-border/40">
          {avatar && <AvatarImage src={avatar} alt={name} />}
          <AvatarFallback className="text-[11px] bg-brand/10 text-brand font-semibold">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </button>
    </AuthorHoverCard>
  );
}

export function IdentityCircleCard({ pubkeys, horizontal }: { pubkeys: string[]; horizontal?: boolean }) {
  // Resolve profiles for the candidates; only those with a real avatar + name
  // are eligible (never a bare npub). Poll the store like the suggested-follows
  // strip does, so entries pop in as they resolve.
  const [resolved, setResolved] = useState<Map<string, Event>>(new Map());
  const candidates = useMemo(() => pubkeys.slice(0, 24), [pubkeys]);

  useEffect(() => {
    if (candidates.length === 0) return;
    try { fetchProfilesCached(candidates); } catch {}
    const tick = () => {
      setResolved((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const pk of candidates) {
          if (next.has(pk)) continue;
          const ev = (eventStore.getReplaceable?.(KIND_METADATA, pk) ?? null) as Event | null;
          if (ev && getAvatarUrl(ev) && realName(ev)) {
            next.set(pk, ev);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [candidates]);

  const shown = candidates.filter((pk) => resolved.has(pk)).slice(0, 8);
  // A full grid row or nothing — a 1–3 person "circle" reads as a glitch.
  if (shown.length < 4) return null;

  // On a phone the rail stacks above the timeline, so a 2-row grid of eight
  // would push the first post off screen. One scrollable row keeps the proof
  // where the follow/message decision is made.
  if (horizontal) {
    // Five faces fit a 375px screen, so at six or more the row runs off the edge
    // with nothing to say so — the scrollbar is hidden and the cut lands in the
    // gap. A soft fade on the trailing edge is the signal, conditional because
    // fading a row that already fits would claim there is more to see.
    const overflows = shown.length > 5;
    return (
      <div
        className="-mx-1 flex items-center gap-3 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={
          overflows
            ? {
                maskImage: "linear-gradient(to right, #000 calc(100% - 2rem), transparent)",
                WebkitMaskImage: "linear-gradient(to right, #000 calc(100% - 2rem), transparent)",
              }
            : undefined
        }
        data-testid="identity-circle-strip"
      >
        {shown.map((pk) => <CirclePerson key={pk} pubkey={pk} profile={resolved.get(pk)!} />)}
      </div>
    );
  }

  // Wrap rather than a fixed column count: with the captions gone the tile is
  // just the avatar, so the number that fits is a function of the rail's width,
  // not a number to hard-code.
  return (
    <div className="flex flex-wrap gap-2.5">
      {shown.map((pk) => <CirclePerson key={pk} pubkey={pk} profile={resolved.get(pk)!} />)}
    </div>
  );
}
