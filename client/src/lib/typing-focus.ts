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

/** True while a typing field has focus. */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(() => typeof document !== "undefined" && isTypingField(document.activeElement));
  useEffect(() => {
    const update = () => setTyping(isTypingField(document.activeElement));
    // focusout fires before focus lands on the next field: read where it
    // landed on the next tick, so moving between two boxes doesn't flash the bar.
    const onOut = () => setTimeout(update, 0);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  return typing;
}
