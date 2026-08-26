import { useCallback, useRef, useState } from "react";
import type { Event } from "nostr-tools";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { publishEvent } from "@/lib/nostr";
import { KIND_FOLLOW_LIST } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { loadFollowBase, cacheFollowEvent } from "@/lib/follow-list";

/**
 * Shared one-click follow action, extracted from SuggestedFollowsStrip so there
 * is ONE guarded implementation rather than a growing set of copies (kind-3
 * wipe is a known footgun — every follow path MUST append to the authoritative
 * current list via loadFollowBase, never publish on an empty base).
 *
 * Returns `follow(pubkey)`, the in-flight `pending` set, an `isFollowing`
 * predicate (driven by the live follow list), and `canFollow` (signed in with a
 * signer). Optimistic: updates local follows immediately, rolls back on failure.
 */
export function useFollowAction() {
  const { pubkey: myPubkey, signer, follows, updateFollows } = useNostrAuth();
  const { toast } = useToast();
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inFlightRef = useRef(false);

  const isFollowing = useCallback(
    (pk: string) => (follows ?? []).includes(pk),
    [follows],
  );

  const follow = useCallback(async (targetPubkey: string): Promise<boolean> => {
    if (!myPubkey || !signer) return false;
    if (pending.has(targetPubkey) || isFollowing(targetPubkey)) return false;
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending((prev) => new Set(prev).add(targetPubkey));
    let optimistic = false;
    try {
      // Authoritative current kind-3 + wipe guard (shared safeguard): never
      // publish a follow list built on an empty/unloaded base.
      const { base: fresh, blocked } = await loadFollowBase(myPubkey, follows?.length ?? 0);
      if (blocked) {
        toast({ title: "Couldn't load your follow list", description: "Try again in a moment.", variant: "destructive" });
        return false;
      }
      const existingTags: string[][] = fresh ? [...fresh.tags] : [];
      const alreadyTagged = existingTags.some((t) => t[0] === "p" && t[1] === targetPubkey);
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
        return false;
      }
      updateFollows((prev) => (prev.includes(targetPubkey) ? prev : [...prev, targetPubkey]));
      optimistic = true;
      const ok = await publishEvent(signed);
      cacheFollowEvent(signed as Event, { force: true });
      if (!ok) {
        toast({ title: "Follow saved — relays didn't confirm", description: "We'll retry in the background." });
      }
      return true;
    } catch {
      if (optimistic) updateFollows((prev) => prev.filter((pk) => pk !== targetPubkey));
      toast({ title: "Couldn't publish follow", variant: "destructive" });
      return false;
    } finally {
      setPending((prev) => {
        const n = new Set(prev);
        n.delete(targetPubkey);
        return n;
      });
      inFlightRef.current = false;
    }
  }, [myPubkey, signer, follows, pending, isFollowing, updateFollows, toast]);

  return { follow, pending, isFollowing, canFollow: !!myPubkey && !!signer };
}
