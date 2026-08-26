import { useEffect, useState } from "react";
import { Link } from "wouter";
import { X, Sparkles, ChevronRight } from "lucide-react";
import { ADOPTION_FLAGS, isDismissed, dismiss } from "@/lib/adoption-flags";

/**
 * A small, dismissible reminder on the user's OWN profile to fill in the fields
 * that make them discoverable and tippable — a photo, a bio, and a Bitcoin
 * (lightning) address. Auto-hides once all three exist; dismissal persists
 * per-pubkey. Lives only on the Profile page so it never stacks with the Home
 * getting-started checklist (which owns "complete your profile" there).
 */
export function ProfileCompletionNudge({
  pubkey,
  content,
  className = "",
}: {
  pubkey: string;
  content: { picture?: string; about?: string; lud16?: string } | null | undefined;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(isDismissed(ADOPTION_FLAGS.profileCompletionNudge, pubkey));
  }, [pubkey]);

  if (!pubkey || dismissed) return null;

  const missing: string[] = [];
  if (!content?.picture) missing.push("a photo");
  if (!content?.about) missing.push("a short bio");
  if (!content?.lud16) missing.push("a Bitcoin address for tips");
  if (missing.length === 0) return null;

  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;

  const handleDismiss = () => {
    dismiss(ADOPTION_FLAGS.profileCompletionNudge, pubkey);
    setDismissed(true);
  };

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-brand/20 bg-gradient-to-br from-brand/[0.06] to-brand/[0.03] px-4 py-3 ${className}`}
      data-testid="card-profile-completion"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-brand/80" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground/85">Finish your profile</p>
        <p className="text-[12px] leading-relaxed text-muted-foreground/70">
          Add {list} so people can recognize you{!content?.lud16 ? " and send you tips" : ""}.
        </p>
      </div>
      <Link
        href="/settings"
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand/10 px-2.5 py-1.5 text-[12px] font-medium text-brand transition-colors hover:bg-brand/15"
        data-testid="button-complete-profile"
      >
        Edit
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
      <button
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground/40 transition-colors hover:text-foreground/70"
        aria-label="Dismiss"
        data-testid="button-dismiss-profile-completion"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
