import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAdmissionQueue } from "@/hooks/use-admission-queue";
import { useReportsQueue } from "@/hooks/use-reports-queue";
import { NEEDS_YOU_CHANGED_EVENT, type NeedsYouValue } from "./NeedsYouContext";

/** Don't re-sweep every relay you belong to on every alt-tab. */
const FOCUS_REFRESH_THROTTLE_MS = 60_000;

/**
 * The Needs-you engine: both operator queues, re-swept on the events the
 * provider documents below. Renders nothing; hands its value up to
 * NeedsYouContext, which loads this as its own chunk once someone is signed in.
 */
export default function NeedsYouEngine({ onChange }: { onChange: (value: NeedsYouValue) => void }) {
  // Both hooks hand back a fresh object every render. This engine's value is
  // handed up to the provider as state, and a value that changes on every
  // render would re-render the provider, which re-renders this engine, which
  // hands up a new value — a loop ("maximum update depth", found by the chats
  // rig). So each object is kept until one of its fields changes.
  const admissionsLive = useAdmissionQueue();
  const reportsLive = useReportsQueue();
  const admissions = useMemo(
    () => admissionsLive,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [admissionsLive.queue, admissionsLive.loading, admissionsLive.sweep, admissionsLive.refresh, admissionsLive.removeLocally],
  );
  const reports = useMemo(
    () => reportsLive,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportsLive.queue, reportsLive.loading, reportsLive.sweep, reportsLive.refresh, reportsLive.removeLocally],
  );
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
  useEffect(() => { onChange(value); }, [value, onChange]);
  return null;
}
