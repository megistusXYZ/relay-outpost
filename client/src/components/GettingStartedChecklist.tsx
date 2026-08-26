import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { use$ } from "applesauce-react/hooks";
import { Check, X, UserCircle, Users, PenLine, Zap, Rocket, ChevronRight } from "lucide-react";
import { OutpostIcon } from "@/components/icons/OutpostIcon";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { eventStore } from "@/lib/nostr";
import { KIND_METADATA, KIND_FOLLOW_LIST, getProfileContent, parseFollowList } from "@/lib/nostr-helpers";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { isOnboardingComplete, isNewAccount } from "@/lib/local-account";
import { ADOPTION_FLAGS, isDismissed, dismiss, hasPosted } from "@/lib/adoption-flags";

/**
 * A compact, dismissible activation checklist for new users on Home. Catches
 * people who skipped or rushed onboarding by surfacing the five moves that make
 * the app click. Each row detects its own completion live; the whole card
 * self-hides once everything's done or the user dismisses it (per-pubkey).
 *
 * Scope: only shows for accounts *created* in Relay Outpost — imported/long-held
 * keys never see "follow 5 people" / "share your first post".
 *
 * Dedup: this owns "complete your profile" on Home — the ProfileCompletionNudge
 * only renders on the Profile page, so the two never stack.
 */

// What a row's tap does: navigate within the app, or fire a global event
// (e.g. open the composer, which is mounted app-wide in App.tsx).
type TaskAction = { type: "nav"; href: string } | { type: "event"; name: string };

export function GettingStartedChecklist({ className = "" }: { className?: string }) {
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [joinedCount, setJoinedCount] = useState(() => getOutpostRelays().length);

  // Keep the "join an outpost" row live as the user joins/leaves elsewhere.
  useEffect(() => {
    const sync = () => setJoinedCount(getOutpostRelays().length);
    sync();
    window.addEventListener("outpost-relays-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("outpost-relays-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    setDismissed(isDismissed(ADOPTION_FLAGS.gettingStartedChecklist, pubkey));
  }, [pubkey]);

  const metadataEvent = use$(() => (pubkey ? eventStore.replaceable(KIND_METADATA, pubkey) : undefined), [pubkey]);
  const followEvent = use$(() => (pubkey ? eventStore.replaceable(KIND_FOLLOW_LIST, pubkey) : undefined), [pubkey]);
  const content = metadataEvent ? getProfileContent(metadataEvent) : null;
  const followCount = followEvent ? parseFollowList(followEvent).length : 0;

  if (!pubkey) return null;
  // New accounts only — never nag people signing in with an existing key.
  if (!isNewAccount(pubkey)) return null;
  // Only after the onboarding overlay is behind them, so the two never overlap.
  if (!isOnboardingComplete(pubkey)) return null;
  if (dismissed) return null;

  const tasks: Array<{
    key: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    done: boolean;
    cta: string;
    action: TaskAction;
  }> = [
    { key: "profile", icon: UserCircle, label: "Add a photo and a short bio", done: !!(content?.picture && content?.about), cta: "Edit profile", action: { type: "nav", href: "/account?edit=profile" } },
    { key: "follow", icon: Users, label: "Follow 5 people", done: followCount >= 5, cta: "Find people", action: { type: "nav", href: "/search" } },
    { key: "post", icon: PenLine, label: "Share your first post", done: hasPosted(pubkey), cta: "Write a post", action: { type: "event", name: "open-compose" } },
    { key: "outpost", icon: OutpostIcon, label: "Join an outpost", done: joinedCount > 0, cta: "Browse", action: { type: "nav", href: "/outposts" } },
    { key: "wallet", icon: Zap, label: "Connect a Bitcoin wallet", done: !!content?.lud16, cta: "Add wallet", action: { type: "nav", href: "/account?tab=wallet" } },
  ];

  const doneCount = tasks.filter((t) => t.done).length;
  if (doneCount === tasks.length) return null; // all set — get out of the way

  const handleDismiss = () => {
    dismiss(ADOPTION_FLAGS.gettingStartedChecklist, pubkey);
    setDismissed(true);
  };

  const runAction = (action: TaskAction) => {
    if (action.type === "nav") setLocation(action.href);
    else window.dispatchEvent(new CustomEvent(action.name));
  };

  return (
    <div
      className={`rounded-xl border border-brand/20 bg-gradient-to-br from-brand/[0.06] to-brand/[0.03] p-4 ${className}`}
      data-testid="card-getting-started"
    >
      <div className="mb-3 flex items-center gap-2">
        <Rocket className="h-4 w-4 text-brand/80" />
        <h2 className="text-sm font-semibold text-foreground/90">Get started</h2>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">{doneCount}/{tasks.length}</span>
        <button
          onClick={handleDismiss}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-foreground/5 hover:text-foreground/70"
          aria-label="Dismiss getting started checklist"
          data-testid="button-dismiss-getting-started"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="space-y-0.5">
        {tasks.map((t) => {
          const Icon = t.icon;
          const checkmark = (
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                t.done ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-500" : "border-border/50 text-transparent"
              }`}
            >
              <Check className="h-3 w-3" />
            </span>
          );

          // Done rows are static; incomplete rows are a single full-width tap
          // target (≥44px) so the whole row — not just a tiny link — runs the action.
          if (t.done) {
            return (
              <li key={t.key} className="flex min-h-11 items-center gap-3 px-1.5" data-testid={`task-${t.key}`}>
                {checkmark}
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                <span className="flex-1 text-[13px] text-muted-foreground/50 line-through">{t.label}</span>
              </li>
            );
          }

          return (
            <li key={t.key} data-testid={`task-${t.key}`}>
              <button
                type="button"
                onClick={() => runAction(t.action)}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1.5 text-left transition-colors hover:bg-brand/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                data-testid={`task-cta-${t.key}`}
                aria-label={`${t.label} — ${t.cta}`}
              >
                {checkmark}
                <Icon className="h-4 w-4 shrink-0 text-brand/70" />
                <span className="flex-1 text-[13px] text-foreground/80">{t.label}</span>
                <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-brand">
                  {t.cta}
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
