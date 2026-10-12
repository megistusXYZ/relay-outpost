import type { Event } from "nostr-tools";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { personLook, type PersonTile } from "@/lib/person-look";
import { usePetnamesVersion } from "@/lib/petnames";

/**
 * A person's avatar as it looks to you, everywhere: your photo for them, else
 * your icon tile, else their real picture, else initials (lib/person-look.ts).
 * Re-renders when a custom photo finishes loading or a name changes.
 */
export function PersonAvatar({ pubkey, profile, name, picture, className = "", fallbackClassName = "bg-brand/10 text-brand font-bold text-xs", alt, testId }: {
  pubkey: string;
  profile?: Event;
  /** For surfaces that hold the profile's fields rather than its event. */
  name?: string;
  picture?: string;
  /** Size, ring and border classes; applied to the tile too. */
  className?: string;
  fallbackClassName?: string;
  alt?: string;
  testId?: string;
}) {
  usePetnamesVersion();
  const look = personLook(profile, pubkey, undefined, { name, picture });
  if (look.tile) return <PersonTileMark tile={look.tile} name={look.name} className={className} testId={testId} />;
  return (
    <Avatar className={className} data-testid={testId}>
      {look.avatarUrl && <AvatarImage src={look.avatarUrl} alt={alt ?? look.name} />}
      <AvatarFallback className={fallbackClassName}>{look.name.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/** Your icon for them: replaces the picture entirely (a half-replaced avatar reads as broken). */
export function PersonTileMark({ tile, name, className = "", testId }: { tile: PersonTile; name: string; className?: string; testId?: string }) {
  return (
    <span
      className={`rounded-full flex items-center justify-center select-none shrink-0 ${className}`}
      style={{ backgroundColor: tile.color ?? "hsl(var(--muted))" }}
      role="img"
      aria-label={name}
      data-testid={testId ? `${testId}-tile` : undefined}
    >
      {tile.emoji ?? name.slice(0, 1).toUpperCase()}
    </span>
  );
}
