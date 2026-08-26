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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAdmissionQueue } from "@/hooks/use-admission-queue";
import { useReportsQueue } from "@/hooks/use-reports-queue";

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

/** Don't re-sweep every relay you belong to on every alt-tab. */
const FOCUS_REFRESH_THROTTLE_MS = 60_000;

type AdmissionQueueValue = ReturnType<typeof useAdmissionQueue>;
type ReportsQueueValue = ReturnType<typeof useReportsQueue>;

interface NeedsYouValue {
  admissions: AdmissionQueueValue;
  reports: ReportsQueueValue;
  /** Rows across both queues — what the nav badge adds to its unread count. */
  count: number;
  /** Re-sweep both queues now. */
  refresh: () => void;
}

const NeedsYouContext = createContext<NeedsYouValue | null>(null);

export function NeedsYouProvider({ children }: { children: ReactNode }) {
  const admissions = useAdmissionQueue();
  const reports = useReportsQueue();
  const count = admissions.queue.length + reports.queue.length;

  const admissionsRefresh = admissions.refresh;
  const reportsRefresh = reports.refresh;
  const refresh = useCallback(() => {
    admissionsRefresh();
    reportsRefresh();
  }, [admissionsRefresh, reportsRefresh]);

  /**
   * WHY THIS EXISTS AT ALL — it is the correction of a regression this provider
   * introduced.
   *
   * Both hooks key their effect on `[pubkey, nonce]`, and this provider sits
   * above the router, so it never remounts. Before it existed the queues were
   * mounted BY the Activity page, and opening Activity re-mounted them — that
   * was the refresh, and hoisting them silently deleted it. The badge shipped
   * and then held its boot value for the rest of the session: a stranger who
   * knocked ten minutes after the tab opened stayed invisible until a reload.
   *
   * THE STARTUP RACE IS THE WORSE HALF. Both sweeps read `getOutpostRelays()`,
   * a bare localStorage read, the moment `pubkey` appears.
   * `NostrAuthContext` defers `loadSettingsFromRelay` behind a 2000ms timer, and
   * that is what populates the list on a fresh browser or a second device. So
   * the first sweep ran against an empty list — zero iterations — and
   * `sweepNotice` deliberately says nothing about a zero-relay sweep, because
   * for a Concord-only operator that state is permanent and a standing banner
   * would be noise. Correct in isolation; combined, it produced a silent,
   * permanently empty Needs-you for exactly the operator this was built for.
   *
   * `outpost-relays-changed` is what nip78-settings dispatches when that late
   * load lands, so listening for it closes the race at its source rather than
   * papering over it with a timer.
   */
  useEffect(() => {
    const onExternalChange = () => refresh();
    window.addEventListener("outpost-relays-changed", onExternalChange);
    window.addEventListener(NEEDS_YOU_CHANGED_EVENT, onExternalChange);
    return () => {
      window.removeEventListener("outpost-relays-changed", onExternalChange);
      window.removeEventListener(NEEDS_YOU_CHANGED_EVENT, onExternalChange);
    };
  }, [refresh]);

  /**
   * Coming back to the tab re-asks, throttled.
   *
   * This does NOT break the hooks' documented "never on a timer" rule: nothing
   * fires while you are away or idle. It fires when someone returns to look —
   * which is the moment the answer is about to be read, and the cheapest
   * possible time to have made it true.
   */
  const lastFocusRefresh = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastFocusRefresh.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefresh.current = now;
      refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const value = useMemo<NeedsYouValue>(
    () => ({ admissions, reports, count, refresh }),
    [admissions, reports, count, refresh],
  );
  return <NeedsYouContext.Provider value={value}>{children}</NeedsYouContext.Provider>;
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
