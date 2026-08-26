import { useEffect, useState } from "react";

/**
 * Shared video preferences, X-style:
 *  - Mute memory: once the user unmutes (or mutes) a video, every player respects
 *    that choice across the feed and across sessions (persisted to localStorage).
 *  - One video at a time: when a video starts playing, the previously playing one
 *    is paused, so you never get two audio tracks at once.
 */

const MUTE_KEY = "videoMuted";
const AUTOPLAY_KEY = "autoplayMedia";
/** Same-tab notification — localStorage never tells the writer's own tab. */
export const AUTOPLAY_CHANGED_EVENT = "ro:autoplay-changed";

/**
 * Auto-play videos in feeds. Default ON as of the media feed.
 *
 * This reverses the earlier calm default deliberately. That default was set
 * when video was a small inline element; now a vertical clip fills the screen,
 * and a 700px static black rectangle is not calm, it is broken. Muted video
 * startles nobody — the principle's intent is better served by playing than by
 * a dead block.
 *
 * Fail-open, like the IA and media-feed flags: only the literal "false" turns
 * it off, so anyone who explicitly opted out keeps their choice while an unset
 * or damaged value reads as on. Settings writes String(enabled) and NIP-78
 * syncs it as a boolean, so both sides of that already agree.
 *
 * THIS IS NOT THE WHOLE ANSWER. It is only the user's setting — one of the
 * inputs to lib/autoplay-policy.ts, which also refuses under reduced motion,
 * save-data, 2G, a low-end device, and an unrevealed content warning. Read the
 * policy, not this flag, when deciding whether a video may start.
 */
export function isAutoplayMediaEnabled(): boolean {
  try { return localStorage.getItem(AUTOPLAY_KEY) !== "false"; } catch { return true; }
}

/**
 * The setting as a REACTIVE value.
 *
 * localStorage does not notify the tab that wrote it, so a component reading
 * `isAutoplayMediaEnabled()` once keeps whatever was true when it mounted. In a
 * feed that mostly self-corrects — rows unmount and remount as you scroll. In a
 * thread it does not: rows mount once and stay, so flipping the toggle changed
 * nothing for any post already on screen. Settings dispatches on change and
 * this listens, so the verdict moves when the switch does.
 */
export function useAutoplayMediaSetting(): boolean {
  const [enabled, setEnabled] = useState(isAutoplayMediaEnabled);
  useEffect(() => {
    const read = () => setEnabled(isAutoplayMediaEnabled());
    window.addEventListener(AUTOPLAY_CHANGED_EVENT, read);
    // storage fires for OTHER tabs; keeping it means two open tabs agree.
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(AUTOPLAY_CHANGED_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return enabled;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) !== "false"; // default muted
  } catch {
    return true;
  }
}

let _muted = readMuted();
const muteListeners = new Set<(m: boolean) => void>();

export function getVideoMuted(): boolean {
  return _muted;
}

export function setVideoMuted(m: boolean): void {
  if (m === _muted) return;
  _muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "true" : "false");
  } catch {}
  muteListeners.forEach((l) => l(m));
}

/** Subscribe a React component to the shared mute preference. */
export function useVideoMuted(): [boolean, (m: boolean) => void] {
  const [m, setM] = useState(_muted);
  useEffect(() => {
    const l = (v: boolean) => setM(v);
    muteListeners.add(l);
    setM(_muted); // resync in case it changed between render and subscribe
    return () => {
      muteListeners.delete(l);
    };
  }, []);
  return [m, setVideoMuted];
}

// ── One video at a time ─────────────────────────────────────────────────────
let _active: HTMLVideoElement | null = null;

/** Mark a video as the active one, pausing whatever was playing before it. */
export function setActiveVideo(el: HTMLVideoElement): void {
  if (_active && _active !== el && !_active.paused) {
    try {
      _active.pause();
    } catch {}
  }
  _active = el;
}

/** Release the active slot if this element holds it (call on unmount). */
export function clearActiveVideo(el: HTMLVideoElement): void {
  if (_active === el) _active = null;
}
