/**
 * Media from people outside your space stays blurred until tapped (owner,
 * 2026-10-10). The feed's blur used to fire only on a NIP-36 content-warning
 * tag, so a stranger's unlabelled picture loaded in full — the single most
 * likely "delete the app" moment for someone who just opened the wider
 * network. This rule is wider: a picture from someone you don't follow and
 * your network doesn't vouch for is blurred, and a picture its author
 * labelled sensitive (hashtags, caption — lib/discover-tiles' rule) is
 * blurred even from someone you follow. One tap reveals, as with any
 * content warning.
 *
 * ABSENCE = OFF: everyone who already has an account sees no change. Signup
 * turns it on for a new account; the first opt-in turns it on again. Pure.
 */
import { useSyncExternalStore } from "react";
import { isSensitiveMedia } from "./discover-tiles";

export const BLUR_OUTSIDE_KEY = "relay-outpost-blur-outside-space";

export function blurOutsideEnabled(stored: string | null | undefined): boolean {
  return stored === "1";
}

export function readBlurOutside(): boolean {
  try { return blurOutsideEnabled(localStorage.getItem(BLUR_OUTSIDE_KEY)); } catch { return false; }
}

const CHANGED = "relay-outpost:blur-outside-changed";

export function writeBlurOutside(on: boolean): void {
  try { localStorage.setItem(BLUR_OUTSIDE_KEY, on ? "1" : "0"); } catch {}
  try { window.dispatchEvent(new Event(CHANGED)); } catch {}
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener("nip78-settings-applied", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("nip78-settings-applied", onChange);
  };
}

/** Reactive read for components. Server snapshot: off. */
export function useBlurOutside(): boolean {
  return useSyncExternalStore(subscribe, () => (readBlurOutside() ? "1" : "0"), () => "0") === "1";
}

export interface OutsideBlurInput {
  enabled: boolean;
  viewer: string | null | undefined;
  author: string;
  follows: ReadonlySet<string>;
  tierOf: (pubkey: string) => string;
  event: { tags: string[][]; content: string };
}

/** The plain-words reason to blur this author's media, or null to show it. */
export function outsideSpaceBlurReason(o: OutsideBlurInput): string | null {
  if (!o.enabled) return null;
  if (isSensitiveMedia(o.event)) return "Sensitive";
  if (o.author === o.viewer) return null;
  if (o.follows.has(o.author)) return null;
  const tier = o.tierOf(o.author);
  if (tier === "strong" || tier === "moderate") return null;
  return "From outside your space";
}
