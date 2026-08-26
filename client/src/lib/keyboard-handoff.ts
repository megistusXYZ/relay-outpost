/**
 * iOS keyboard hand-off. Mobile Safari only opens the on-screen keyboard when
 * `focus()` runs inside a user gesture — a route navigation ends that gesture,
 * so focusing an input on the destination page (in an effect) won't open the
 * keyboard. The trick: focus a hidden, persistent input synchronously in the
 * tap handler (opening the keyboard *now*), then navigate; when the real input
 * mounts and focuses, the already-open keyboard simply transfers to it.
 *
 * Call `primeKeyboard()` in the search-icon tap; the destination input's own
 * autofocus completes the hand-off. No-op / harmless on desktop.
 */
let primer: HTMLInputElement | null = null;

function getPrimer(): HTMLInputElement | null {
  if (typeof document === "undefined") return null;
  if (primer && document.body.contains(primer)) return primer;
  primer = document.createElement("input");
  primer.type = "text";
  // NOT readOnly — iOS suppresses the keyboard for readonly inputs, which would
  // defeat the purpose. It's 1px/opacity-0/off-screen so it can't be typed into,
  // and focus transfers to the real input as soon as the destination page mounts.
  primer.setAttribute("aria-hidden", "true");
  primer.setAttribute("inputmode", "search");
  primer.tabIndex = -1;
  // Visible enough to be focusable + open the keyboard, but off-screen and inert.
  // 16px font-size avoids iOS zoom-on-focus.
  primer.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;margin:0;z-index:-1;";
  document.body.appendChild(primer);
  return primer;
}

/** Focus a hidden input to open the mobile keyboard, from inside a tap gesture. */
export function primeKeyboard(): void {
  try {
    const el = getPrimer();
    el?.focus({ preventScroll: true } as FocusOptions);
  } catch {}
}
