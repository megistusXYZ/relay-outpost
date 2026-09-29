/**
 * Links to other Nostr clients open inside Relay Outpost (owner, 2026-09-29).
 *
 * One app-wide handler instead of a fix per surface: a tap on any link whose
 * URL carries a nostr id (primal.net/e/note1…, njump.me/npub1…, a nostr: URI,
 * …) goes to our own page for it (lib/nostr-routes.ts). It listens in the
 * capture phase so it runs before React: some linkifiers stop the click from
 * bubbling, and a card around the link must not also react to the tap.
 *
 * Cmd/Ctrl/Shift-click and middle-click open OUR page in a new tab. Links we
 * have no page for (nostrRouteFor → null), ordinary links, our own links and
 * downloads are left alone.
 */
import { nostrRefFromUrl } from "./nostr-client-links";
import { nostrRouteFor } from "./nostr-routes";

/** Our page for this link's href, or null when it isn't ours to take. */
export function nativeRouteForHref(href: string, origin: string): string | null {
  if (!href) return null;
  if (/^nostr:/i.test(href)) return nostrRouteFor(href);
  let url: URL;
  try { url = new URL(href, origin); } catch { return null; }
  if (url.origin === origin) return null;
  const ref = nostrRefFromUrl(url.href);
  return ref ? nostrRouteFor(ref) : null;
}

export function installNativeLinks(opts: {
  navigate: (route: string) => void;
  openTab: (url: string) => void;
  origin?: string;
  target?: Window;
}): () => void {
  const target = opts.target ?? window;
  const origin = opts.origin ?? window.location.origin;

  const handle = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    const middle = e.type === "auxclick" && e.button === 1;
    if (!middle && (e.type !== "click" || e.button !== 0)) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || a.hasAttribute("download")) return;
    const route = nativeRouteForHref(a.getAttribute("href") ?? "", origin);
    if (!route) return;
    e.preventDefault();
    e.stopPropagation();
    if (middle || e.metaKey || e.ctrlKey || e.shiftKey) opts.openTab(`${origin}${route}`);
    else opts.navigate(route);
  };

  target.addEventListener("click", handle, true);
  target.addEventListener("auxclick", handle, true);
  return () => {
    target.removeEventListener("click", handle, true);
    target.removeEventListener("auxclick", handle, true);
  };
}
