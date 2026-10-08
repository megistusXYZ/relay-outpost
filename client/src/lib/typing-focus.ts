/**
 * Whether the keyboard is up for typing (lib/typing-focus.test.ts). On a phone
 * the bottom bar steps aside while it is: it rode up on the keyboard and
 * covered the box being typed in (owner, 2026-10-07).
 */
import { useEffect, useState } from "react";

// Input types that bring up a keyboard. Everything else (checkbox, range,
// file, color, date pickers…) is a control, not typing.
const TYPED = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);

/** Does focusing this element bring up the keyboard? */
export function isTypingField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return TYPED.has((el.getAttribute("type") || "").toLowerCase()) && !el.readOnly && !el.disabled;
  // An editable region (or text inside one). The attribute, not
  // isContentEditable, which some environments leave undefined.
  const host = el.closest("[contenteditable]");
  return !!host && host.getAttribute("contenteditable") !== "false";
}

/** How long the bottom bar waits after typing ends before it returns. */
export const BAR_RETURN_MS = 350;

/** True while a typing field has focus (and briefly after: BAR_RETURN_MS). */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(() => typeof document !== "undefined" && isTypingField(document.activeElement));
  useEffect(() => {
    // Out of the way at once when typing starts; back only after the tap that
    // ended it has landed. Back at once, the page's bottom spacing changed
    // mid-tap and the tapped button moved from under the finger
    // (ops-publisher-e2e: "Sign" under a text box never signed). Focus moving
    // to a button ends typing through focusin, not only focusout — both wait.
    // Moving between two boxes never brings it back in between.
    let back: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(back);
      if (isTypingField(document.activeElement)) { setTyping(true); return; }
      back = setTimeout(() => setTyping(isTypingField(document.activeElement)), BAR_RETURN_MS);
    };
    document.addEventListener("focusin", settle);
    document.addEventListener("focusout", settle);
    return () => {
      clearTimeout(back);
      document.removeEventListener("focusin", settle);
      document.removeEventListener("focusout", settle);
    };
  }, []);
  return typing;
}
