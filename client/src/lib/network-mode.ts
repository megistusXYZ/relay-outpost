/**
 * "Your space" / "The wider network" — one switch per account.
 *
 * A brand-new account starts with the wider network OFF (owner, 2026-10-10):
 * it reads its own communities and the people it follows, nothing from public
 * relays, until it flips the switch. The stored value is the per-account
 * `ro_public_nostr:<pk>` flag that signup has always written (lib/public-nostr.ts
 * is the storage layer); this module is what the rest of the app reads.
 *
 * ABSENCE MEANS ON. Every account that predates the switch has no stored
 * value, and nothing may change for them. The only writer of "0" is signup.
 *
 * No imports from nostr.ts: relay selection imports this, not the other way.
 */
import { useSyncExternalStore } from "react";
import { isPublicNostrEnabled, setPublicNostr } from "./public-nostr";

export const WIDER_NETWORK_CHANGED = "relay-outpost:wider-network-changed";

/** Is this account's wider network on? Unset, garbage or signed-out → on. */
export function isWiderNetworkOn(pubkey: string | null | undefined): boolean {
  return isPublicNostrEnabled(pubkey);
}

/** Flip the switch for one account. Writes locally and tells the app; never publishes. */
export function setWiderNetwork(pubkey: string, on: boolean): void {
  setPublicNostr(pubkey, on);
  try { window.dispatchEvent(new Event(WIDER_NETWORK_CHANGED)); } catch {}
}

// Relay selection runs deep in modules that have no pubkey in hand, the same
// way the outbox keeps its viewer (setOutboxViewer). Set from the auth context.
let viewer: string | null = null;
export function setNetworkModeViewer(pubkey: string | null): void {
  viewer = pubkey;
}
export function isWiderNetworkOnForViewer(): boolean {
  return isWiderNetworkOn(viewer);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(WIDER_NETWORK_CHANGED, onChange);
  window.addEventListener("public-nostr-changed", onChange);
  window.addEventListener("storage", onChange);
  // A remote settings apply writes storage directly, which fires no same-tab event.
  window.addEventListener("nip78-settings-applied", onChange);
  return () => {
    window.removeEventListener(WIDER_NETWORK_CHANGED, onChange);
    window.removeEventListener("public-nostr-changed", onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("nip78-settings-applied", onChange);
  };
}

/** Reactive read for components. Server snapshot: on. */
export function useWiderNetwork(pubkey: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (isWiderNetworkOn(pubkey) ? "1" : "0"),
    () => "1",
  ) === "1";
}
