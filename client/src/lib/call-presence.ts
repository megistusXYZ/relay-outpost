/**
 * Is a voice/video call in progress? One module-level flag, set by the call
 * context when a room is joined and cleared when it is left, so code outside
 * React (the quiet-update policy) can ask without a hook. A call is never
 * interrupted for an update.
 */
let active = false;

export function setCallActive(next: boolean): void {
  active = next;
}

export function isCallActive(): boolean {
  return active;
}
