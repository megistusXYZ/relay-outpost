/**
 * What a second tap on a footer tab asks the page it's on to do
 * (lib/footer-nav.ts decides; this carries the ask).
 *
 * The footer doesn't know how Discover focuses its search box or how Chats
 * finds its first unread, so it says which tab was tapped and what for, and
 * the page answers. Delivery is synchronous on purpose: iOS only opens the
 * keyboard for a focus() made while the tap is still being handled, so the
 * page has to hear about it before the tap handler returns.
 */
import type { NavDestinationId } from "./nav-destinations";

export type TabRetapAsk = "focus-search" | "first-unread";

const EVENT = "ro:tab-retap";
type Detail = { tab: NavDestinationId; ask: TabRetapAsk };

export function emitTabRetap(tab: NavDestinationId, ask: TabRetapAsk): void {
  window.dispatchEvent(new CustomEvent<Detail>(EVENT, { detail: { tab, ask } }));
}

/** Listen for one tab's ask. Returns the unsubscribe. */
export function onTabRetap(tab: NavDestinationId, ask: TabRetapAsk, handler: () => void): () => void {
  const listener = (e: Event) => {
    const d = (e as CustomEvent<Detail>).detail;
    if (d?.tab === tab && d.ask === ask) handler();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
