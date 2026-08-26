/**
 * Shared sender/member identity for Concord surfaces: reactively resolves a
 * pubkey's display name + avatar from the app's profile store (same pattern as
 * CommsTab), triggering a cached fetch on first use. Replaces the npub-short
 * placeholder identity from Slice 2.
 */
import { useEffect } from "react";
import { use$ } from "applesauce-react/hooks";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getAvatarUrl, getDisplayName, getProfileContent, KIND_METADATA, shortenNpub, formatNpub } from "@/lib/nostr-helpers";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export function useConcordProfile(pubkey: string): {
  name: string;
  avatar?: string;
  hasProfile: boolean;
  /** Claimed NIP-05, unverified — verification happens where it's rendered. */
  nip05?: string;
  /** display_name || name, with NO npub fallback (see below). */
  claimedName?: string;
} {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  useEffect(() => { if (pubkey && !profile) fetchProfilesCached([pubkey]); }, [pubkey, profile]);
  const content = profile ? (getProfileContent(profile) as { nip05?: string; name?: string; display_name?: string }) : undefined;
  return {
    name: profile ? getDisplayName(profile) : shortenNpub(formatNpub(pubkey)),
    avatar: profile ? getAvatarUrl(profile) : undefined,
    // Whether a real kind-0 resolved — callers use this to keep npub fallbacks
    // muted/neutral (e.g. the sender-color palette only applies to real names).
    hasProfile: !!profile,
    // Both come off the kind-0 already in the store, so they cost no network.
    // claimedName deliberately omits the npub fallback that `name` has: it feeds
    // impersonation checking, and comparing an npub against trusted names is
    // meaningless.
    nip05: content?.nip05,
    claimedName: content?.display_name || content?.name,
  };
}

/** Avatar + display name for a Concord member/sender. */
export function ConcordIdentity({ pubkey, size = 28, showName = true, className = "" }: {
  pubkey: string; size?: number; showName?: boolean; className?: string;
}) {
  const { name, avatar } = useConcordProfile(pubkey);
  const px = `${size}px`;
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      <Avatar className="shrink-0 border border-border/30" style={{ width: px, height: px }}>
        {avatar && <AvatarImage src={avatar} alt={name} />}
        <AvatarFallback className="text-[10px] bg-brand/10 text-brand font-semibold">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {showName && <span className="text-sm font-medium truncate">{name}</span>}
    </div>
  );
}
