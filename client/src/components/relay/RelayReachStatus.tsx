import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RelayLogo, type RelayReach } from "./RelayLogo";

/**
 * What a relay told us, in the four outcomes RELAY_REACHABILITY.md describes,
 * plus the moment before we know.
 */
export type RelayReachState = "connecting" | RelayReach;

/** The shape returned by `client/src/lib/relay-reach.ts`. */
interface ReachedLike {
  reached: boolean;
  refusedReason?: string;
}

/**
 * Maps a Reached<T> result to a status. `isEmpty` is the caller's own test of
 * the payload (for a list, `r.data.length === 0`). Pass `undefined` for the
 * result while the request is still in flight.
 */
export function reachState(result: ReachedLike | undefined, isEmpty: boolean): RelayReachState {
  if (!result) return "connecting";
  if (!result.reached) return "unreachable";
  if (result.refusedReason) return "refused";
  return isEmpty ? "empty" : "ok";
}

const TEXT: Record<RelayReachState, string> = {
  connecting: "Connecting",
  ok: "Connected",
  empty: "Connected. Nothing here yet",
  unreachable: "Could not reach this relay",
  refused: "This relay declined the request",
};

export interface RelayReachStatusProps {
  status: RelayReachState;
  /** Overrides the default sentence, for example with the relay's own refusal reason. */
  text?: string;
  /** Icon only. The sentence is still exposed to screen readers. */
  compact?: boolean;
  /**
   * For a whole pane rather than a line: the logo above the sentence, then a
   * note and an action, laid out the way <RelayEmpty /> is so the two can
   * stand in the same place.
   */
  stacked?: boolean;
  /** Stacked only: what this means for the person, under the sentence. */
  hint?: ReactNode;
  /** Stacked only: usually "Try again". */
  action?: ReactNode;
  size?: number;
  className?: string;
  /** A test id on the outer element, for browser checks. */
  testId?: string;
}

export function RelayReachStatus({ status, text, compact = false, stacked = false, hint, action, size, className, testId }: RelayReachStatusProps) {
  const sentence = text ?? TEXT[status];
  const logo = (px: number, label: string) => (
    <RelayLogo
      state={status === "connecting" ? "work" : "icon"}
      reach={status === "connecting" ? undefined : status}
      size={px}
      label={label}
    />
  );
  if (stacked) {
    return (
      <div role="status" aria-live="polite" className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)} data-testid={testId} data-status={status}>
        {logo(size ?? 44, "")}
        <div className="text-base font-semibold text-foreground">{sentence}</div>
        {hint ? <p className="max-w-xs text-sm text-muted-foreground">{hint}</p> : null}
        {action}
      </div>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}
      data-testid={testId}
      data-status={status}
    >
      {logo(size ?? 18, compact ? sentence : "")}
      {compact ? null : <span>{sentence}</span>}
    </span>
  );
}
