/**
 * Whether the installed app has had a session yet. On iOS the home-screen
 * app keeps its own storage, apart from Safari, so its first launch has no
 * session even for someone signed in a minute ago in the browser. The
 * sign-in screen uses this to start at "reconnect" that once.
 */
import { isPWAStandalone } from "./platform";

const APP_SIGNED_IN_KEY = "ro_app_signed_in";

interface LaunchEnv {
  standalone?: boolean;
  storage?: Storage;
}

function storageOf(env: LaunchEnv): Storage | null {
  if (env.storage) return env.storage;
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

/** The installed app, never signed in here before. */
export function isFirstAppLaunch(env: LaunchEnv = {}): boolean {
  if (!(env.standalone ?? isPWAStandalone())) return false;
  try { return storageOf(env)?.getItem(APP_SIGNED_IN_KEY) !== "1"; } catch { return true; }
}

/** Record a session in the installed app (a browser tab doesn't count). */
export function markAppSignedIn(env: LaunchEnv = {}): void {
  if (!(env.standalone ?? isPWAStandalone())) return;
  try { storageOf(env)?.setItem(APP_SIGNED_IN_KEY, "1"); } catch { /* storage blocked */ }
}
