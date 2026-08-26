import { useMemo, useEffect } from "react";
import { nip19 } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { getProfileContent } from "@/lib/nostr-helpers";
import { Link } from "wouter";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { User } from "lucide-react";
import { AuthorHoverCard, TrustTierDot } from "@/components/NostrPost";

function shortenNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return npub.slice(0, 12) + "..." + npub.slice(-6);
  } catch {
    return pubkey.slice(0, 8) + "..." + pubkey.slice(-6);
  }
}

interface ProfileLinkProps {
  pubkey: string;
  displayName?: string;
  className?: string;
  fallbackClassName?: string;
  showAvatar?: boolean;
  avatarSize?: "sm" | "md";
}

export function ProfileLink({ pubkey: rawPubkey, displayName: overrideName, className, fallbackClassName, showAvatar = true, avatarSize = "sm" }: ProfileLinkProps) {
  const hexPubkey = useMemo(() => {
    if (/^[0-9a-f]{64}$/i.test(rawPubkey)) return rawPubkey;
    try {
      if (rawPubkey.startsWith("npub")) {
        const decoded = nip19.decode(rawPubkey);
        if (decoded.type === "npub") return decoded.data as string;
      }
    } catch {}
    return rawPubkey;
  }, [rawPubkey]);

  const profile = use$(() => hexPubkey ? eventStore.replaceable(0, hexPubkey) : undefined, [hexPubkey]);

  useEffect(() => {
    if (hexPubkey && !profile) {
      fetchProfilesCached([hexPubkey]);
    }
  }, [hexPubkey, profile]);

  const { name, npub, picture } = useMemo(() => {
    let resolvedName = overrideName || "";
    let pic = "";
    if (profile) {
      const content = getProfileContent(profile);
      if (!resolvedName) {
        resolvedName = content?.display_name || content?.name || "";
      }
      pic = content?.picture || "";
    }
    if (!resolvedName) {
      resolvedName = shortenNpub(hexPubkey);
    }
    let npubStr = "";
    try {
      npubStr = nip19.npubEncode(hexPubkey);
    } catch {}
    return { name: resolvedName, npub: npubStr, picture: pic };
  }, [hexPubkey, profile, overrideName]);

  const isResolved = name !== shortenNpub(hexPubkey);
  const sizeClass = avatarSize === "md" ? "w-6 h-6" : "w-4 h-4";

  return (
    <span className="inline-flex items-center gap-1.5 truncate">
      <AuthorHoverCard pubkey={hexPubkey} profile={profile}>
        <Link
          href={npub ? `/profile/${npub}` : "#"}
          className={`inline-flex items-center gap-1.5 truncate hover:underline transition-colors ${
            isResolved
              ? className || "text-foreground font-medium"
              : fallbackClassName || className || "text-brand font-mono"
          }`}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          data-testid={`profile-link-${hexPubkey.slice(0, 8)}`}
        >
          {showAvatar && (
            <Avatar className={`${sizeClass} flex-shrink-0`}>
              {picture ? (
                <AvatarImage src={picture} alt={name} />
              ) : null}
              <AvatarFallback className="bg-brand/20 text-brand">
                <User className="w-2.5 h-2.5" />
              </AvatarFallback>
            </Avatar>
          )}
          <span className="truncate">{name}</span>
        </Link>
      </AuthorHoverCard>
      <TrustTierDot pubkey={hexPubkey} />
    </span>
  );
}
