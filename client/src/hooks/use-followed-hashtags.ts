import { useCallback, useEffect, useState } from "react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  getFollowedHashtags,
  followHashtag,
  unfollowHashtag,
  normalizeHashtag,
  INTERESTS_CHANGED_EVENT,
} from "@/lib/interests";

/**
 * Reactive view of the user's PORTABLE followed hashtags (kind-10015 interests),
 * distinct from custom feeds (kind-30078). Reads from the durable cache and
 * refreshes on the `interests-changed` window event that every write fires.
 * All writes go through the wipe-guarded interests.ts helpers.
 */
export function useFollowedHashtags() {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [hashtags, setHashtags] = useState<string[]>(() => (pubkey ? getFollowedHashtags(pubkey) : []));
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setHashtags(pubkey ? getFollowedHashtags(pubkey) : []);
  }, [pubkey]);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(INTERESTS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INTERESTS_CHANGED_EVENT, onChange);
  }, [refresh]);

  const isFollowed = useCallback(
    (tag: string) => hashtags.includes(normalizeHashtag(tag)),
    [hashtags],
  );

  const follow = useCallback(async (tag: string) => {
    const norm = normalizeHashtag(tag);
    if (!pubkey || !signer || !norm || pending) return;
    setPending(norm);
    try {
      const res = await followHashtag(pubkey, signer, norm);
      if (res.blocked) {
        toast({
          title: "Couldn't load your hashtags",
          description: "Try again in a moment — your existing hashtags are safe.",
          variant: "destructive",
        });
      } else if (res.ok) {
        setHashtags(res.hashtags);
        toast({ title: `Following #${norm}`, description: "Added to your hashtags, shared across your Nostr apps." });
      } else {
        toast({ title: "Couldn't follow hashtag", variant: "destructive" });
      }
    } catch {
      toast({ title: "Couldn't follow hashtag", variant: "destructive" });
    } finally {
      setPending(null);
    }
  }, [pubkey, signer, pending, toast]);

  const unfollow = useCallback(async (tag: string) => {
    const norm = normalizeHashtag(tag);
    if (!pubkey || !signer || !norm || pending) return;
    setPending(norm);
    try {
      const res = await unfollowHashtag(pubkey, signer, norm);
      if (res.blocked) {
        toast({
          title: "Couldn't load your hashtags",
          description: "Try again in a moment — your existing hashtags are safe.",
          variant: "destructive",
        });
      } else if (res.ok) {
        setHashtags(res.hashtags);
      } else {
        toast({ title: "Couldn't unfollow hashtag", variant: "destructive" });
      }
    } catch {
      toast({ title: "Couldn't unfollow hashtag", variant: "destructive" });
    } finally {
      setPending(null);
    }
  }, [pubkey, signer, pending, toast]);

  return { hashtags, isFollowed, follow, unfollow, pending, canFollow: !!pubkey && !!signer };
}
