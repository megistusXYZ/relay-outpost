/**
 * The "You" destination's icon — the account's own avatar.
 *
 * Every other destination is a PLACE and wears a symbol. "You" is a person, so
 * it shows that person. On an icon-only rail especially, a face is a far
 * stronger "this is your account" affordance than a generic glyph that looks
 * identical for everyone.
 *
 * One component, both nav surfaces (mobile footer + desktop rail), because the
 * last time this app kept two copies of a nav rule they drifted and shipped a
 * defect for four PRs (see the active-state matcher, PR #505). Adding a third
 * surface means importing this, not re-deriving it.
 *
 * FALLS BACK, never substitutes: no picture renders the CircleUser glyph, not
 * initials. At this size two letters are a smudge, and an account with no
 * avatar is the common case for a brand-new user — precisely who the fallback
 * has to look right for. AvatarFallback renders that same glyph, so a broken or
 * slow image lands on the identical mark instead of flashing a gap.
 */
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { NAV_ICONS } from "@/lib/nav-destinations";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export function YouAvatarIcon({
  className = "",
  glyphClassName = "",
  active = false,
}: {
  /** Sizing — applied to both the avatar and the fallback glyph. */
  className?: string;
  /** Colour/opacity that only makes sense on the SVG glyph. */
  glyphClassName?: string;
  active?: boolean;
}) {
  const { profile } = useNostrAuth();
  const picture = profile?.picture;
  const Glyph = NAV_ICONS.you;

  if (!picture) return <Glyph className={`${className} ${glyphClassName}`} />;

  return (
    <Avatar
      className={`${className} border transition-colors ${
        active ? "border-primary/60" : "border-transparent"
      }`}
    >
      <AvatarImage src={picture} alt="" />
      <AvatarFallback className="bg-transparent p-0">
        <Glyph className={`${className} ${glyphClassName}`} />
      </AvatarFallback>
    </Avatar>
  );
}
