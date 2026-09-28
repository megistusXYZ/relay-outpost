/**
 * "Look around first" on the landing: straight to Discover, which visitors may
 * read (lib/guest-limits.ts guestCanBrowse). The launch overlay stands aside on
 * Discover pages, so this is how a visitor sees what's here before signing up.
 * Through the router, so the app's history index (Back behaviour) stays intact.
 */
import { useLocation } from "wouter";

export function LookAroundLink() {
  const [, navigate] = useLocation();
  return (
    <a
      href="/discover"
      onClick={(e) => { e.preventDefault(); navigate("/discover"); }}
      className="inline-flex min-h-11 items-center px-3 text-sm text-white/70 underline decoration-white/25 underline-offset-4 hover:text-white hover:decoration-white/60 transition-colors"
      data-testid="link-look-around"
    >
      Look around first
    </a>
  );
}
