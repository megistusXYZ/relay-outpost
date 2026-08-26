/**
 * The signer for whoever is signed in — whatever way they signed in.
 *
 * `window.nostr` is ONLY present for people using a NIP-07 browser extension.
 * Local-key users, PWA users and bunker users have no such object, so any code
 * that reaches for it directly does nothing for them — and, because the usual
 * shape is `if (!window.nostr) return false`, does nothing SILENTLY.
 *
 * That has bitten this codebase twice now:
 *
 *  - nip29.ts wrote the same helper inline after local-key/PWA users "silently
 *    failed every NIP-29 action".
 *  - outpost-relays.ts kept the raw `window.nostr` through that sweep, so
 *    publishCommunitySubscriptions / hydrateCommunitySubscriptions /
 *    updateNip65RelayList all returned false for anyone without an extension.
 *    Their joined communities lived in localStorage and nowhere else, and an
 *    account switch (or clearing site data) took them. Found 2026-08-03 when a
 *    real join published no kind-10073 at all.
 *
 * One copy, so the next module cannot miss it. Prefer this over
 * `(window as any).nostr` anywhere a user action needs signing.
 */
import { getGlobalSigner } from "./nip42-auth";

/** Minimal shape both an app signer and a NIP-07 extension satisfy. */
export interface SessionSigner {
  signEvent: (template: any) => Promise<any>;
  getPublicKey: () => Promise<string>;
}

/**
 * The active signer, or null if nobody is signed in.
 *
 * Order matters: the app's own signer wins, because it tracks the account the
 * UI is actually showing. An extension may be installed and unlocked as a
 * DIFFERENT identity, and signing as the wrong person is worse than not
 * signing at all.
 */
export function resolveSessionSigner(): SessionSigner | null {
  const app = getGlobalSigner() as SessionSigner | null;
  if (app) return app;
  if (typeof window !== "undefined" && (window as any).nostr) {
    return (window as any).nostr as SessionSigner;
  }
  return null;
}

/** The signed-in pubkey, or null. Never throws. */
export async function resolveSessionPubkey(): Promise<string | null> {
  const signer = resolveSessionSigner();
  if (!signer) return null;
  try {
    return (await signer.getPublicKey()) || null;
  } catch {
    return null;
  }
}
