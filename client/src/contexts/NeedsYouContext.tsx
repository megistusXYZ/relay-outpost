/**
 * The operator's decision queues, swept ONCE for the whole app.
 *
 * Both queues were mounted only inside the Activity page, which meant the
 * operator learned somebody was at the door by opening Activity on a hunch.
 * The number they needed already existed — `queue.length`, in both hooks — and
 * nothing consumed it. A doorman nobody is told about is the mechanism-nothing-
 * reaches defect wearing its politest disguise: everything works, and a
 * stranger still waits three days.
 *
 * WHY A PROVIDER AND NOT A HOOK PER SURFACE. Three nav surfaces render the
 * badge (MobileFooter, DesktopStoriesRail, OrbitMenu) and the Activity page
 * renders the rows. Four independent mounts of these hooks would be four
 * independent relay sweeps of every outpost you belong to. One provider is also
 * the rule this repo already had to learn once for the operator feedback badge:
 * a count with more than one source is a count that will disagree with itself.
 *
 * WHY THIS DOES NOT VIOLATE THE HOOKS' OWN "never on a timer" RULE.
 * `use-admission-queue.ts` says an operator queue that "silently re-polls every
 * relay you belong to is a background cost nobody asked for". That guards
 * against RE-polling, and this does not re-poll: the effect keys on `[pubkey,
 * nonce]`, so mounting it here runs it once per session instead of once per
 * Activity visit — strictly fewer sweeps than the status quo for anyone who
 * opens Activity more than once, and one extra for anyone who never does.
 * Someone with no outpost relays pays nothing at all; the loop has no
 * iterations.
 *
 * SCOPE, stated because it is invisible on screen: both queues are NIP-29 only.
 * A Concord community emits no 39000/39001/9021 — it has no knock event,
 * because its invite link is the door. So this count is structurally zero for a
 * Concord-only operator, and that is correct rather than broken.
 */
import { createContext, useCallback, useContext, useState, lazy, Suspense, type ReactNode } from "react";
import type { useAdmissionQueue } from "@/hooks/use-admission-queue";
import type { useReportsQueue } from "@/hooks/use-reports-queue";
import type { RelayReportsValue } from "@/hooks/use-relay-reports-queue";
import { useNostrAuth } from "@/contexts/NostrAuthContext";

/**
 * "Something happened that the operator queues should re-read."
 *
 * A window event rather than a context call, because the write sites are not
 * all under this provider — `relay-ops/CommunityTab` is a separate console —
 * and a badge that only updates from surfaces that happen to sit inside the
 * tree is the reach problem again, one level up.
 */
export const NEEDS_YOU_CHANGED_EVENT = "needs-you-changed";

/** Fire after admitting, adding or removing someone. */
export function notifyNeedsYouChanged(): void {
  try { window.dispatchEvent(new CustomEvent(NEEDS_YOU_CHANGED_EVENT)); } catch {}
}

export type AdmissionQueueValue = ReturnType<typeof useAdmissionQueue>;
export type ReportsQueueValue = ReturnType<typeof useReportsQueue>;

export interface NeedsYouValue {
  admissions: AdmissionQueueValue;
  reports: ReportsQueueValue;
  /** Reports about what's on the relays you run (not just their groups). */
  relayReports: RelayReportsValue;
  /** Rows across both queues — what the nav badge adds to its unread count. */
  count: number;
  /**
   * Decisions waiting on the relays you run: join requests and reports in
   * their groups, plus reports about their posts and people. The Relays
   * badge; `relaysCountFor` is the same number for one relay (the switcher).
   */
  relaysCount: number;
  relaysCountFor: (relayUrl: string) => number;
  /** Re-sweep both queues now. */
  refresh: () => void;
}

const NeedsYouContext = createContext<NeedsYouValue | null>(null);

// The two queue sweeps (and the NIP-29 library behind them) load as their own
// chunk once someone is signed in; a visitor has no queues and no badge.
const NeedsYouEngine = lazy(() => import("./needs-you-engine"));

export function NeedsYouProvider({ children }: { children: ReactNode }) {
  const { pubkey } = useNostrAuth();
  const [value, setValue] = useState<NeedsYouValue | null>(null);
  const onChange = useCallback((next: NeedsYouValue) => setValue(next), []);
  return (
    <NeedsYouContext.Provider value={pubkey ? value : null}>
      {pubkey && (
        <Suspense fallback={null}>
          <NeedsYouEngine onChange={onChange} />
        </Suspense>
      )}
      {children}
    </NeedsYouContext.Provider>
  );
}

/**
 * Returns null OUTSIDE the provider rather than throwing.
 *
 * The nav surfaces render in shells that do not always sit under it (and in
 * tests that mount a footer on its own). A missing provider must degrade to
 * "no badge", never to a crashed navigation bar — the failure mode of throwing
 * here is losing the whole app chrome to fix a count.
 */
export function useNeedsYou(): NeedsYouValue | null {
  return useContext(NeedsYouContext);
}

/** Just the badge number, safe anywhere. */
export function useNeedsYouCount(): number {
  return useContext(NeedsYouContext)?.count ?? 0;
}

/** The Relays badge: decisions waiting on relays you run. */
export function useRelaysNeedYou(): { total: number; forRelay: (relayUrl: string) => number } {
  const v = useContext(NeedsYouContext);
  return { total: v?.relaysCount ?? 0, forRelay: v?.relaysCountFor ?? (() => 0) };
}
