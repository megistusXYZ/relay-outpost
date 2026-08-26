// Global guard against accidental clicks while scrolling on touch devices.
//
// On a janky scroll (or an imperfect finger drag) the browser can still fire a
// `click` after what the user intended as a scroll — opening dialogs by mistake.
// This installs capture-phase listeners that mark a gesture as "moved" once the
// pointer travels past a small threshold, or once the browser takes the gesture
// over for scrolling (pointercancel), and swallows the resulting click.
//
// Capture phase + stopPropagation means component onClick handlers never fire
// for these — no per-component changes needed.

const MOVE_THRESHOLD = 10; // px

let startX = 0;
let startY = 0;
let moved = false;
let installed = false;

function onPointerDown(e: PointerEvent) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  startX = e.clientX;
  startY = e.clientY;
  moved = false;
}

function onPointerMove(e: PointerEvent) {
  if (moved) return;
  if (Math.abs(e.clientX - startX) > MOVE_THRESHOLD || Math.abs(e.clientY - startY) > MOVE_THRESHOLD) {
    moved = true;
  }
}

function onPointerCancel() {
  // Browser took the gesture over for scrolling/zooming.
  moved = true;
}

function onClickCapture(e: MouseEvent) {
  if (moved) {
    e.stopPropagation();
    e.preventDefault();
    moved = false;
  }
}

export function installScrollClickGuard() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("click", onClickCapture, true);
}
