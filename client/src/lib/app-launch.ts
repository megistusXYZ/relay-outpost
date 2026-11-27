/**
 * Whether the iPhone or iPad home-screen app has had a session yet. That app
 * keeps its own storage, apart from Safari, so its first launch has no
 * session even for someone signed in a minute ago in the browser. The
 * sign-in screen uses this to start at "reconnect" that once.
 *
 * Only there. A desktop or Android installed app shares the browser's
 * storage: it is signed in whenever the tab is, and signed out it shows the
 * same sign-in screen as the tab.
 */
import { isIOSHomeScreenApp } from "./platform";

const APP_SIGNED_IN_KEY = "ro_app_signed_in";

interface LaunchEnv {
  /** The iPhone or iPad home-screen app (lib/platform.ts). */
  iosApp?: boolean;
  storage?: Storage;
}

function storageOf(env: LaunchEnv): Storage | null {
  if (env.storage) return env.storage;
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

/** The home-screen app, never signed in here before. */
export function isFirstAppLaunch(env: LaunchEnv = {}): boolean {
  if (!(env.iosApp ?? isIOSHomeScreenApp())) return false;
  try { return storageOf(env)?.getItem(APP_SIGNED_IN_KEY) !== "1"; } catch { return true; }
}

/** Record a session in the home-screen app (a browser tab doesn't count). */
export function markAppSignedIn(env: LaunchEnv = {}): void {
  if (!(env.iosApp ?? isIOSHomeScreenApp())) return;
  try { storageOf(env)?.setItem(APP_SIGNED_IN_KEY, "1"); } catch { /* storage blocked */ }
}
