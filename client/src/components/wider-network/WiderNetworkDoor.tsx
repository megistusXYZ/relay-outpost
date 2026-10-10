/**
 * The door: one card that stands wherever the wider network would be while
 * it is off (owner, 2026-10-10) — Discover, the public community starters,
 * Home's For you and Trending. Never nothing: a hidden surface reads as "the
 * app is empty"; a door says there is more, and that going through it is
 * the person's choice. Opens the one sheet (WiderNetworkSheet).
 */
import { Globe, ChevronRight } from "lucide-react";
import { openWiderNetworkSheet } from "./open-sheet";

export function WiderNetworkDoor({ compact = false, testId = "wider-network-door" }: { compact?: boolean; testId?: string }) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={openWiderNetworkSheet}
        className="group flex w-full items-center gap-3 px-3 min-h-[56px] py-2.5 text-left rounded-xl border border-border/40 transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.06]"
        data-testid={testId}
      >
        <Globe className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">The wider network</span>
          <span className="block text-xs leading-snug text-muted-foreground">Everyone on Nostr. Off until you say so.</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" aria-hidden="true" />
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-border/40 px-5 py-6 text-center" data-testid={testId}>
      <Globe className="w-7 h-7 mx-auto text-muted-foreground" aria-hidden="true" />
      <h3 className="mt-3 text-base font-semibold tracking-tight">The wider network</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground [text-wrap:balance] max-w-[32ch] mx-auto">
        People and posts from everywhere on Nostr. It's off for now, so your space is just your people and your communities.
      </p>
      <button
        type="button"
        onClick={openWiderNetworkSheet}
        className="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        data-testid={`${testId}-open`}
      >
        See what's out there
      </button>
    </div>
  );
}

/** A settings-style row that says the state and opens the sheet. Settings and the Relays page. */
export function WiderNetworkRow({ on, testId = "wider-network-row" }: { on: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={openWiderNetworkSheet}
      className="group flex w-full items-center gap-3 px-3 min-h-[56px] py-2.5 text-left rounded-xl transition-colors hover:bg-primary/[0.04] active:bg-primary/[0.06]"
      data-testid={testId}
    >
      <Globe className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">The wider network</span>
        <span className="block text-xs leading-snug text-muted-foreground">{on ? "On — people and posts from everywhere on Nostr." : "Off — your space is your people and your communities."}</span>
      </span>
      <span className={`text-xs font-medium ${on ? "text-success" : "text-muted-foreground"}`} data-testid={`${testId}-state`}>{on ? "On" : "Off"}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" aria-hidden="true" />
    </button>
  );
}
