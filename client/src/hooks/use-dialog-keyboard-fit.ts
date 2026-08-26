import { useCallback } from "react";
import type React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";

/** Breathing room (px) between the dialog and the visual-viewport edges. */
const EDGE = 16;

export interface DialogKeyboardFit {
  /** Extra classes for `DialogContent` — top-anchors the dialog on mobile. */
  className: string;
  /** Inline geometry: pins the dialog inside the visual viewport (the area not
   *  covered by the on-screen keyboard). Undefined on desktop. */
  style?: React.CSSProperties;
  /** Spread onto `DialogContent`: scrolls whichever field the user focuses into
   *  the middle of the dialog's scrollport once the keyboard settles. */
  onFocusCapture: React.FocusEventHandler<HTMLDivElement>;
}

/**
 * Keep a Radix dialog usable while the mobile on-screen keyboard is up.
 *
 * A centered (`top-50% translate-y--50%`) dialog is positioned against the
 * LAYOUT viewport, which iOS does not shrink when the keyboard opens — so the
 * dialog stays put and its lower half (inputs, buttons) ends up buried behind
 * the keyboard/AutoFill bar. On mobile (<768px) this hook instead:
 *
 *  - top-anchors the dialog (a top-anchored dialog can never be covered), and
 *  - caps its height to the VISUAL viewport via {@link useKeyboardViewport}
 *    (the same mechanics as the DM thread and the Add-Feed sheet), so the
 *    dialog's own `overflow-y-auto` keeps every field reachable, and
 *  - scrolls the focused input into view once the keyboard settles.
 *
 * Desktop is untouched (`className` empty, `style` undefined).
 *
 * Usage: `const kbFit = useDialogKeyboardFit(open)` then
 * `<DialogContent className={cn("… overflow-y-auto", kbFit.className)} style={kbFit.style} onFocusCapture={kbFit.onFocusCapture}>`.
 */
export function useDialogKeyboardFit(open: boolean): DialogKeyboardFit {
  const isMobile = useIsMobile();
  // Only active while the dialog is open on mobile; the hook itself also
  // returns INACTIVE (height: null) at >=768px.
  const kb = useKeyboardViewport(open && isMobile);

  const onFocusCapture = useCallback<React.FocusEventHandler<HTMLDivElement>>((e) => {
    if (window.innerWidth >= 768) return;
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    if (!isField) return;
    // Give the keyboard/visual-viewport time to settle before measuring.
    window.setTimeout(() => {
      if (document.activeElement === el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 300);
  }, []);

  return {
    className: isMobile ? "top-4 translate-y-0" : "",
    style: isMobile && kb.height != null
      ? { top: kb.offsetTop + EDGE, maxHeight: kb.height - EDGE * 2 }
      : undefined,
    onFocusCapture,
  };
}
