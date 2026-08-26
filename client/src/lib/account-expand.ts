/**
 * One-shot "arrive expanded" signal for the account page's collapsible header.
 *
 * Tapping Account inside the Stories menu is explicit intent to SEE the
 * account — landing on the condensed banner is friction. The menu sets this
 * marker right before navigating; MyOutpost peeks it in its initial-state
 * computation (so the very first paint is already expanded — no flash) and
 * clears it on mount. sessionStorage is used instead of navigation state or a
 * query param because it survives the menu's close-on-navigate flow, never
 * dirties the URL, and dies with the tab.
 *
 * Peek/clear are split (rather than a single consume) so React StrictMode's
 * double-invoked initializers both see the same value; the mount effect's
 * double-run clears idempotently.
 */
const KEY = "ro_account_header_expand_once";

/** Called by the menu right before navigating to /account or /account/menu. */
export function requestAccountHeaderExpand(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {}
}

/** Non-destructive read — safe to call from a useState initializer. */
export function peekAccountHeaderExpand(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Remove the marker (call once on mount after peeking). */
export function clearAccountHeaderExpand(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
