import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useFollowAction } from "@/hooks/use-follow-action";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { CURATED_SEED_PUBKEYS } from "@/lib/curated-seed-follows";
import { Check, Plus } from "lucide-react";
import { Link } from "wouter";
import { nip19 } from "nostr-tools";
import type { Event } from "nostr-tools";

interface Props {
  limit?: number;
  className?: string;
}

// Compact suggested-follows panel shown on Home when the signed-in user
// has zero follows. Taps a candidate to publish a single-pubkey append
// to their kind-3 follow list. Intentionally minimal — onboarding has no
// follow picker anymore (new accounts auto-follow one anchor); this strip
// is the organic one-click path out of a quiet feed.
export function SuggestedFollowsStrip({ limit = 8, className }: Props) {
  const { pubkey: myPubkey, follows } = useNostrAuth();

  // Full candidate pool (no slice) — the render slices AFTER dropping
  // unresolved profiles, so the strip stays a full 2×4 as long as enough
  // curated seeds resolve, instead of burning slots on placeholders.
  const candidates = useMemo(() => {
    const followSet = new Set(follows);
    return CURATED_SEED_PUBKEYS.filter(pk => pk !== myPubkey && !followSet.has(pk));
  }, [follows, myPubkey]);

  const [profiles, setProfiles] = useState<Map<string, Event | null>>(new Map());
  const { follow, pending } = useFollowAction();
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (candidates.length === 0) return;
    try { fetchProfilesCached(candidates); } catch {}
    const tick = () => {
      setProfiles(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const pk of candidates) {
          const ev = (eventStore.getReplaceable?.(KIND_METADATA, pk) ?? null) as Event | null;
          const cur = next.get(pk);
          if (ev && ev !== cur) {
            next.set(pk, ev);
            changed = true;
          } else if (!next.has(pk)) {
            next.set(pk, null);
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

  // Following goes through the shared hook, the one guarded path that loads
  // the user's real list before publishing (never a copy of it: see
  // lib/follow-list-builders.test.ts). This strip only remembers what it followed.
  const handleFollow = useCallback(async (targetPubkey: string) => {
    if (completed.has(targetPubkey)) return;
    if (await follow(targetPubkey)) setCompleted((prev) => new Set(prev).add(targetPubkey));
  }, [follow, completed]);

  // Only profiles that actually resolved get a card — a user should never see
  // an "OP / Operator" placeholder. The strip pops in once real names exist.
  const resolvedCandidates = candidates.filter(pk => profiles.get(pk)).slice(0, limit);

  if (!myPubkey || resolvedCandidates.length === 0) return null;

  return (
    <div className={`w-full max-w-md space-y-3 ${className ?? ""}`} data-testid="container-suggested-follows">
      <div className="text-center space-y-1">
        <p className="text-[10px] font-brand tracking-widest uppercase text-muted-foreground/60">
          A few operators to start with
        </p>
        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
          Follow one or two to prime your feed. You can change who you follow any time.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {resolvedCandidates.map(pk => {
          const profile = profiles.get(pk)!;
          const name = getDisplayName(profile);
          const avatar = getAvatarUrl(profile);
          const done = completed.has(pk);
          const loading = pending.has(pk);
          return (
            <div
              key={pk}
              className="flex flex-col items-center gap-1.5 p-2 rounded-md border border-border/30 bg-background/30"
              data-testid={`suggested-follow-${pk.slice(0, 8)}`}
            >
              {/* Face and name open the profile, so you can see who you'd be
                  following first; Follow stays its own button below. */}
              <Link
                href={`/profile/${nip19.npubEncode(pk)}`}
                className="flex w-full flex-col items-center gap-1.5 rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-brand/40"
                aria-label={`Open ${name}'s profile`}
                data-testid={`link-suggested-profile-${pk.slice(0, 8)}`}
              >
                <Avatar className="w-10 h-10">
                  {avatar && <AvatarImage src={avatar} alt="" />}
                  <AvatarFallback className="text-[10px] bg-muted/50">
                    {name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="text-[10px] font-medium truncate w-full text-center" title={name}>
                  {name}
                </p>
              </Link>
              <Button
                size="sm"
                variant={done ? "secondary" : "outline"}
                disabled={loading || done}
                className="h-6 px-1.5 text-[10px] w-full gap-1"
                onClick={() => handleFollow(pk)}
                data-testid={`button-follow-${pk.slice(0, 8)}`}
              >
                {loading ? (
                  "…"
                ) : done ? (
                  <>
                    <Check className="w-3 h-3" />
                    Followed
                  </>
                ) : (
                  <>
                    <Plus className="w-3 h-3" />
                    Follow
                  </>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
