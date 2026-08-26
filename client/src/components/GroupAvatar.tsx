/**
 * Group-chat avatar. A group reads as a GROUP — never as one of its members —
 * so the same visual shows to everyone:
 *   1. a custom group picture (metadata.picture) if set, else
 *   2. an overlapping facepile of member photos (2–3), else
 *   3. purple initials of the group name.
 *
 * The facepile is the differentiator from a 1:1 DM (single round avatar): even
 * a 2-person group shows two overlapping faces. Member profiles resolve
 * reactively from the app profile store via `useConcordProfile`, so faces fill
 * in as metadata arrives. Sizing is driven by a single `size` (px) so the
 * footprint matches the list avatar (40) or the compact header strip (28).
 */
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useConcordProfile } from "@/components/concord/ConcordIdentity";
import { facepileMembers } from "@/lib/concord/concord-roster";
import { cn } from "@/lib/utils";

function MemberFace({ pubkey, size, className, style }: {
  pubkey: string;
  size: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { name, avatar } = useConcordProfile(pubkey);
  return (
    <Avatar className={cn("shrink-0", className)} style={{ width: `${size}px`, height: `${size}px`, ...style }}>
      {avatar && <AvatarImage src={avatar} alt={name} />}
      <AvatarFallback className="bg-brand/20 text-brand font-semibold" style={{ fontSize: `${Math.round(size * 0.4)}px` }}>
        {name.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export function GroupAvatar({
  members,
  picture,
  name,
  myPubkey,
  size = 40,
  className,
}: {
  /** Member pubkeys (from the roster snapshot). May include your own. */
  members: readonly string[];
  /** Custom group image (metadata.picture) — wins over the facepile when set. */
  picture?: string;
  /** Group name — drives the initials fallback when there are no faces. */
  name: string;
  /** Signed-in pubkey, so the facepile favours OTHER members when capped. */
  myPubkey?: string | null;
  /** Footprint in px (list = 40, header = 28). */
  size?: number;
  className?: string;
}) {
  // 1. Custom group picture — a single round avatar, group initials fallback.
  if (picture) {
    return (
      <Avatar className={cn("border border-primary/25", className)} style={{ width: `${size}px`, height: `${size}px` }}>
        <AvatarImage src={picture} alt={name} />
        <AvatarFallback className="bg-brand/20 text-brand font-bold" style={{ fontSize: `${Math.round(size * 0.3)}px` }}>
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }

  const faces = facepileMembers(members, myPubkey, 3);

  // 3. No known members yet — purple initials of the group name.
  if (faces.length === 0) {
    return (
      <Avatar className={cn("border border-primary/25", className)} style={{ width: `${size}px`, height: `${size}px` }}>
        <AvatarFallback className="bg-brand/20 text-brand font-bold" style={{ fontSize: `${Math.round(size * 0.3)}px` }}>
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }

  // A lone known member still reads as a group (name + subtitle carry that);
  // render the single face at full footprint.
  if (faces.length === 1) {
    return <MemberFace pubkey={faces[0]} size={size} className={cn("border border-primary/25", className)} />;
  }

  // 2. Facepile — overlapping faces sized so the cluster ≈ the list footprint.
  const faceSize = Math.round(size * 0.72);
  return (
    <div
      className={cn("flex items-center -space-x-2 shrink-0", className)}
      style={{ height: `${size}px` }}
      aria-label="Group members"
    >
      {faces.map((pk, i) => (
        <MemberFace
          key={pk}
          pubkey={pk}
          size={faceSize}
          className="border-2 border-background"
          style={{ zIndex: faces.length - i }}
        />
      ))}
    </div>
  );
}
