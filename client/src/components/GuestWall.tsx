/**
 * The membership wall a signed-out visitor meets past the taste.
 *
 * One component for every gated surface so the pitch never forks: calm, in
 * the brand voice, honest about the cost (an account takes a minute, no email
 * or phone), never a scary interstitial. It ENDS a scroll or REPLACES a
 * members-only surface — it never covers content a shared link pointed at.
 */
import { Link } from "wouter";
import { BookOpen } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";

export function GuestWall({
  context,
  className = "",
}: {
  /** One line naming what membership unlocks HERE ("Keep exploring the feed"). */
  context: string;
  className?: string;
}) {
  return (
    <div
      className={`glass-card rounded-2xl border border-primary/20 px-6 py-8 text-center ${className}`}
      data-testid="guest-wall"
    >
      {/* The brand mark, not a generic sparkle (owner call, 2026-08-14):
          this card is often the first Relay Outpost surface a visitor sees. */}
      <span className="mx-auto mb-3 flex w-10 h-10 items-center justify-center rounded-full bg-primary/10">
        <BrandMark className="w-6 h-6 text-brand" aria-hidden="true" />
      </span>
      <h3 className="text-base font-semibold">{context}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
        Your community starts here. An account takes a minute — no email or phone number required.
      </p>
      <div className="mt-4 flex items-center justify-center gap-2">
        <Link
          href="/login"
          className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-[hsl(262_72%_52%)] hover:bg-[hsl(262_72%_46%)] text-white text-sm font-semibold shadow-sm transition-colors"
          data-testid="guest-wall-cta"
        >
          Get started
        </Link>
        <Link
          href="/help"
          className="inline-flex items-center gap-1.5 justify-center h-9 px-4 rounded-full border border-border/60 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          data-testid="guest-wall-guides"
        >
          <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
          What is this?
        </Link>
      </div>
    </div>
  );
}
