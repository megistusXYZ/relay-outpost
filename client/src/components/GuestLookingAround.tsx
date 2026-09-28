/**
 * For a visitor reading Discover or News before signing up
 * (lib/guest-limits.ts guestCanBrowse): what an account adds, and the way in.
 * Read-only pages give a visitor nothing to act on, so this is their next step.
 */
import { useLocation } from "wouter";

export function GuestLookingAround() {
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-brand/25 bg-brand/[0.06] p-4 sm:flex-row sm:items-center" data-testid="guest-looking-around">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">You're looking around</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Create a free account to follow people, reply, join communities and chat. No email or phone number needed.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/login")}
        className="min-h-11 shrink-0 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        data-testid="guest-get-started"
      >
        Get started
      </button>
    </div>
  );
}
