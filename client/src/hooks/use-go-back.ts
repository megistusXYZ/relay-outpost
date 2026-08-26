import { useCallback } from "react";
import { useLocation } from "wouter";
import { canGoBackInApp } from "@/lib/app-history";

/**
 * The ONE sanctioned back-navigation decision.
 *
 * All back controls MUST go through this (via the `useGoBack` hook) — never call
 * `setLocation` (a wouter PUSH) as a back. A PUSH mints a fresh scroll token with
 * no saved position, so the shared scroll restorer runs `scrollTo(0, 0)` and
 * drops the user at the top: that was the "in-app back button lands at the top"
 * bug this replaces.
 *
 * Behavior:
 *   - `canGoBackInApp()` (the PREVIOUS history entry is provably ours — see
 *     lib/app-history.ts) → `window.history.back()`. This is the EXACT same
 *     popstate path the native swipe-back gesture uses, so `use-scroll-restore`
 *     fires identically and the user lands on the same item at the same scroll
 *     position.
 *   - otherwise → PUSH to `fallbackPath` (a sensible parent route), defaulting
 *     to "/" — unless we are ALREADY there, in which case Back does nothing,
 *     which is what Back at an app's root does everywhere else.
 *
 * NEVER `history.length` — that was the original implementation and the PWA
 * blank-screen bug. `length` counts the whole tab session (pre-app entries,
 * forward entries; it never shrinks), so it said "there is an entry to pop"
 * when the entry behind us belonged to another site — or, in an installed
 * PWA, to nothing at all.
 *
 * Kept as a plain function (not just inline in the hook) so the decision is
 * unit-testable in a node env without a React renderer; `canGoBack` is
 * injectable for the same reason.
 */
export function performGoBack(
  navigate: (to: string) => void,
  fallbackPath: string = "/",
  canGoBack: boolean = typeof window !== "undefined" && canGoBackInApp(),
): void {
  if (canGoBack) {
    window.history.back();
    return;
  }
  // Back at the app's own root is a no-op, not a self-push: pushing the page
  // onto itself would grow the stack and make the NEXT back a trip through a
  // duplicate of where you already are.
  const here = typeof window !== "undefined" ? window.location.pathname : null;
  if (here !== fallbackPath) navigate(fallbackPath);
}

/**
 * Returns a stable `goBack(fallbackPath?)`. Pass each call site's own deep-link
 * parent as `fallbackPath` (e.g. a thread's inbox, an article list) so a
 * cold-loaded detail page still has a good target. Safe in deps / callbacks /
 * effect cleanups.
 */
export function useGoBack(): (fallbackPath?: string) => void {
  const [, setLocation] = useLocation();
  return useCallback(
    (fallbackPath?: string) => performGoBack(setLocation, fallbackPath),
    [setLocation],
  );
}
