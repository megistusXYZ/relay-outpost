import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { eventStore, fetchProfilesCached, publishEvent } from "@/lib/nostr";
import { clientTags, KIND_FOLLOW_LIST, KIND_METADATA, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { loadFollowBase, cacheFollowEvent } from "@/lib/follow-list";
import { CURATED_SEED_PUBKEYS } from "@/lib/curated-seed-follows";
import { Check, Plus } from "lucide-react";
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
  const { pubkey: myPubkey, signer, follows, updateFollows } = useNostrAuth();
  const { toast } = useToast();

  // Full candidate pool (no slice) — the render slices AFTER dropping
  // unresolved profiles, so the strip stays a full 2×4 as long as enough
  // curated seeds resolve, instead of burning slots on placeholders.
  const candidates = useMemo(() => {
    const followSet = new Set(follows);
    return CURATED_SEED_PUBKEYS.filter(pk => pk !== myPubkey && !followSet.has(pk));
  }, [follows, myPubkey]);

  const [profiles, setProfiles] = useState<Map<string, Event | null>>(new Map());
  const [pending, setPending] = useState<Set<string>>(new Set());
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

  const inFlightRef = useRef(false);

  const handleFollow = useCallback(async (targetPubkey: string) => {
    if (!myPubkey || !signer) return;
    if (pending.has(targetPubkey) || completed.has(targetPubkey)) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setPending(prev => new Set(prev).add(targetPubkey));
    let optimisticApplied = false;
    try {
      // Authoritative current kind-3 + wipe guard (shared safeguard). This strip
      // shows at zero follows, but the guard protects the hydration-race case
      // where an existing account briefly looks empty.
      const { base: fresh, blocked } = await loadFollowBase(myPubkey, follows?.length ?? 0);
      if (blocked) {
        toast({ title: "Couldn't load your follow list", description: "Try again in a moment.", variant: "destructive" });
        return;
      }
      const existingTags: string[][] = fresh ? [...fresh.tags] : [];
      const alreadyTagged = existingTags.some(t => t[0] === "p" && t[1] === targetPubkey);
      const newTags = alreadyTagged ? existingTags : [...existingTags, ["p", targetPubkey]];
      const tpl = {
        kind: KIND_FOLLOW_LIST,
        created_at: Math.floor(Date.now() / 1000),
        tags: newTags,
        content: fresh?.content || "",
      };
      const signed = await signWithTimeout(signer, tpl);
      if (!signed) {
        toast({ title: "Couldn't sign follow event", variant: "destructive" });
        return;
      }
      updateFollows(prev => prev.includes(targetPubkey) ? prev : [...prev, targetPubkey]);
      optimisticApplied = true;
      setCompleted(prev => new Set(prev).add(targetPubkey));
      const ok = await publishEvent(signed);
      cacheFollowEvent(signed as Event, { force: true });
      if (!ok) {
        toast({ title: "Follow published locally but relays didn't confirm", description: "We'll retry in the background." });
      }
    } catch (err) {
      if (optimisticApplied) {
        updateFollows(prev => prev.filter(pk => pk !== targetPubkey));
        setCompleted(prev => {
          const n = new Set(prev);
          n.delete(targetPubkey);
          return n;
        });
      }
      toast({ title: "Couldn't publish follow", variant: "destructive" });
    } finally {
      setPending(prev => {
        const n = new Set(prev);
        n.delete(targetPubkey);
        return n;
      });
      inFlightRef.current = false;
    }
  }, [myPubkey, signer, pending, completed, updateFollows, toast]);

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
              <Avatar className="w-10 h-10">
                {avatar && <AvatarImage src={avatar} alt={name} />}
                <AvatarFallback className="text-[10px] bg-muted/50">
                  {name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <p className="text-[10px] font-medium truncate w-full text-center" title={name}>
                {name}
              </p>
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
