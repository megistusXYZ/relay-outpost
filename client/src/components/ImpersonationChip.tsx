import { AlertTriangle } from "lucide-react";
import { useImpersonationCheck, type ImpersonationCandidate } from "@/hooks/use-impersonation-check";

const TOOLTIP = "This account's name looks like someone you follow, but it's a different account.";

/**
 * Quiet impersonation warning — a small amber-muted chip shown next to an
 * out-of-network account whose name closely resembles someone the user
 * trusts: "Resembles [Name] · not the same account". Purely informational:
 * it never hides, blocks, or auto-acts (the app's moderation principle), and
 * renders nothing at all when there is no lookalike verdict.
 */
export function ImpersonationChip({
  pubkey,
  displayName,
  nip05,
  enabled = true,
  compact = false,
  className = "",
}: ImpersonationCandidate & {
  /** Compact drops the "· not the same account" tail (tight identity rows). */
  compact?: boolean;
  className?: string;
}) {
  const verdict = useImpersonationCheck({ pubkey, displayName, nip05, enabled });
  if (!verdict) return null;
  return (
    <span
      title={TOOLTIP}
      data-testid={`chip-impersonation-${(pubkey ?? "").slice(0, 8)}`}
      className={`inline-flex items-center gap-1 max-w-full min-w-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-700 dark:text-amber-400 ${className}`}
    >
      <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="truncate">
        Resembles {verdict.match.displayName}
        {!compact && <span className="text-amber-700/70 dark:text-amber-400/70"> · not the same account</span>}
      </span>
    </span>
  );
}
