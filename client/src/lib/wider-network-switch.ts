/**
 * Flipping the wider-network switch (owner, 2026-10-10; lib/network-mode.ts).
 * The local switch flips first so the app answers at once; then the account's
 * relay list is republished for the new mode (lib/wider-network-relays.ts).
 * If the relays can't be reached the switch flips back and the caller tells
 * the person — a switch that says "on" while the network still thinks "off"
 * would lie on both sides. Pure apart from its two injected effects.
 */
import type { RelayListPublishResult } from "./wider-network-relays";

export interface FlipDeps {
  set: (on: boolean) => void;
  publish: (on: boolean) => Promise<RelayListPublishResult>;
}

export type FlipOutcome = { ok: true } | { ok: false; reason: "unanswered" | "failed" };

export async function flipWiderNetwork(on: boolean, deps: FlipDeps): Promise<FlipOutcome> {
  deps.set(on);
  let result: RelayListPublishResult;
  try {
    result = await deps.publish(on);
  } catch {
    result = "failed";
  }
  if (result === "published") return { ok: true };
  deps.set(!on);
  return { ok: false, reason: result };
}
