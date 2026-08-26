import { useEffect, useState } from "react";

export interface KeyboardViewport {
  /** Height (px) to give a fixed full-screen chat overlay so it exactly fills
   *  the space above the on-screen keyboard, or null on desktop / when inactive
   *  (let CSS handle it). */
  height: number | null;
  /** Top offset (px) to anchor the overlay to the visual viewport — non-zero
   *  when the browser shifts the visual viewport (iOS) so the composer stays
   *  docked to the keyboard instead of stranding at the top of the screen. */
  offsetTop: number;
}

const INACTIVE: KeyboardViewport = { height: null, offsetTop: 0 };

/**
 * Track the visual viewport so a `position: fixed` chat overlay can ride just
 * above the on-screen keyboard and snap back cleanly when it closes — the native
 * iMessage/Twitter behaviour.
 *
 * The layout viewport does not shrink when the keyboard opens (notably iOS
 * Safari / installed PWAs), so a plain full-height fixed overlay leaves its
 * bottom-anchored composer stranded behind the keyboard. We size the overlay to
 * `visualViewport.height` AND anchor it at `visualViewport.offsetTop`, and reset
 * window scroll on every change to defeat iOS pushing the fixed layer out of
 * view (which is what leaves the composer marooned at the top of the screen).
 *
 * Mobile only (`innerWidth < 768`); desktop / the two-pane layout returns
 * INACTIVE so CSS drives it.
 *
 * @param active whether a keyboard-bearing surface is currently open (e.g. a DM
 *   thread or channel room). When false, returns INACTIVE and detaches.
 */
export function useKeyboardViewport(active: boolean): KeyboardViewport {
  const [vp, setVp] = useState<KeyboardViewport>(INACTIVE);

  useEffect(() => {
    if (!active) {
      setVp(INACTIVE);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    let raf = 0;
    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (window.innerWidth >= 768) {
          setVp(INACTIVE);
          return;
        }
        // Keep the layout viewport pinned to the top so a `fixed` overlay stays
        // aligned with the visual viewport instead of being shoved off-screen.
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
        // Dedupe: iOS fires a burst of resize/scroll events per keystroke (the
        // predictive/autocorrect bar jitters) that report the SAME dimensions.
        // Re-committing identical values re-lays-out the fixed overlay every
        // time — a repaint storm that (with backdrop-filter bubbles) flickers.
        const h = Math.round(vv.height);
        const o = Math.round(vv.offsetTop);
        setVp((prev) => (prev.height === h && prev.offsetTop === o ? prev : { height: h, offsetTop: o }));
      });
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, [active]);

  return vp;
}
