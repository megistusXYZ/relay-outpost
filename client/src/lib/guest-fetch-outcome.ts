/**
 * Three-outcome classification for guest deep-link fetches — found, genuinely
 * not found, or we-never-got-to-ask (RELAY_REACHABILITY.md).
 *
 * Exists because the guest previews treated EOSE as an answer and told a
 * visitor a real post "couldn't be found": a cold guest pool's failed
 * connects fire EOSE instantly (fabricated-EOSE class), so on a slow network
 * every guest deep link raced five WebSocket handshakes against an instant
 * lie. `reached` comes from canReachAny — CONNECTING is the reachability
 * signal, never EOSE — and "not-found" is only ever claimed when both a real
 * EOSE arrived AND somebody was provably reached.
 */
export type GuestFetchOutcome = "loading" | "found" | "not-found" | "unreachable";

export function guestFetchOutcome(s: {
  found: boolean;
  eosed: boolean;
  /** canReachAny's verdict; null while still probing. */
  reached: boolean | null;
  timedOut: boolean;
}): GuestFetchOutcome {
  if (s.found) return "found";
  if (s.reached === false) return "unreachable";
  if (s.eosed && s.reached === true) return "not-found";
  // Deadline: aggregate EOSE can hang FOREVER when one relay in the set never
  // finishes connecting (measured live 2026-08-18 — oneose absent at 12s while
  // reached was true at 0.6s). A reach-proven set that stayed silent for the
  // whole window has answered by silence; without proven reach the deadline
  // stays an honest "we never got to ask".
  if (s.timedOut) return s.reached === true ? "not-found" : "unreachable";
  return "loading";
}
