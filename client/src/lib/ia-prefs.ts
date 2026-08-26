/**
 * The IA-collapse flag: 8 nav destinations → 4 (Chats · Activity · Discover · You).
 *
 * DEFAULT ON as of the Stage-1 flip. It shipped default-OFF and stayed dark
 * while each piece landed; now that the whole set is in — the re-points, the
 * sectioned Chats list, positive-only verification, the landing rule and the
 * one-time "where things went" notice — it is the navigation, and the flag has
 * become the kill-switch it was always going to turn into.
 *
 * Semantics INVERTED with the default: only a literal "0" turns it off;
 * unset, "1", and anything corrupt or half-written read as ON. Same
 * fail-open shape as public-nostr and the Concord flag, and for the same
 * reason — an absent value must never be mistaken for a deliberate choice.
 * Reading it the other way round would silently hand the old eight-item nav
 * to anyone whose storage was cleared.
 *
 * Why a flag instead of a branch: the collapse touches nav-destinations,
 * MobileFooter, the App routes, Messages, ChatList, Profile and the trust
 * components — files that change weekly. Holding those on a long-lived branch
 * rots. This way each piece merged to main small and inert, `main` stayed
 * deployable throughout, the launch was one boolean — and so is the rollback.
 */
import { useSyncExternalStore } from "react";

const KEY = "ro_ia_collapsed";
const CHANGED = "ia-prefs-changed";
/** The ONLY value that turns the simplified navigation off. */
const OFF = "0";

export function isIaCollapsed(): boolean {
  try { return localStorage.getItem(KEY) !== OFF; } catch { return true; }
}

export function setIaCollapsed(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
  try { window.dispatchEvent(new Event(CHANGED)); } catch {}
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Reactive read of the IA-collapse flag. Server snapshot is "0" — off. */
export function useIaCollapsed(): boolean {
  return useSyncExternalStore(subscribe, () => (isIaCollapsed() ? "1" : "0"), () => "1") === "1";
}
