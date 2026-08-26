import { useEffect, useState } from "react";

/**
 * Live handle on the top bar's #header-identity-slot element.
 *
 * The header bar — and this slot with it — is NOT always mounted: on desktop
 * it unmounts entirely while the sidebar is expanded and no audio player is
 * docked (HeaderBar in App.tsx returns null), and it (re)mounts when the
 * sidebar collapses, the viewport crosses the mobile breakpoint, or audio
 * docks. Pages that portal their identity into the slot must therefore track
 * it live: a one-shot getElementById on mount returns null on desktop (or a
 * detached node after a mobile→desktop resize) and the identity silently
 * vanishes — that was the "profile has no banner on desktop" bug.
 *
 * Returns the slot element while it is mounted, null otherwise. Callers
 * render their identity inline on the page whenever this is null.
 */
export function useHeaderIdentitySlot(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const update = () => {
      setEl((prev) => {
        const next = document.getElementById("header-identity-slot");
        return next === prev ? prev : next;
      });
    };
    update();
    // The slot mounts/unmounts with the header bar, so watch the tree instead
    // of polling. The callback is cheap (getElementById + bail-out setState),
    // and React skips re-renders when the element hasn't changed.
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return el;
}
