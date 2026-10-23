/**
 * What to tell a person so they can install the app, per install method
 * (lib/install-method.ts). One source for the Home card, the Settings dialog
 * and the landing page, so the words never drift apart.
 *
 * Steps carry icon tokens — `{more}` (•••), `{share}`, `{menu}` (⋮) — that
 * components/install/InstallSteps.tsx draws as icons; `stepText` spells them
 * out for tests and screen readers.
 */
import type { InstallMethod } from "./install-method";

export type InstallIcon = "more" | "share" | "menu";

export interface InstallStep {
  /** Plain words with `{more}` / `{share}` / `{menu}` where an icon is drawn. */
  text: string;
}

export interface InstallGuide {
  title: string;
  /**
   * "prompt": one button opens the browser's own install dialog.
   * "open-in-chrome": one button hands this page to Chrome (Android).
   */
  action?: "prompt" | "open-in-chrome";
  /** Offer a copy-link button, for pasting into a real browser. */
  copyLink?: boolean;
  steps: InstallStep[];
  /** One quiet line under the steps. */
  note?: string;
}

export interface InstallGuideContext {
  ipad: boolean;
  android: boolean;
  /** The app whose built-in browser this is (lib/platform.ts), or null. */
  inAppBrowser: string | null;
}

export const ICON_WORDS: Record<InstallIcon, string> = { more: "•••", share: "Share", menu: "⋮" };

/** A step with its icons spelled out, e.g. "Tap ••• (or Share)". */
export function stepText(step: InstallStep): string {
  return step.text.replace(/\{(more|share|menu)\}/g, (_, k: InstallIcon) => ICON_WORDS[k]);
}

export function installGuideFor(method: InstallMethod, ctx: InstallGuideContext): InstallGuide | null {
  switch (method) {
    case "installed":
      return null;
    case "ios-instructions":
      return ctx.ipad
        ? {
            title: "Add it to your Home Screen",
            steps: [
              { text: "Tap {share} at the top, beside the address" },
              { text: "Tap Add to Home Screen (scroll down if you don't see it)" },
              { text: "Tap Add" },
            ],
            note: "Then open Relay Outpost from your Home Screen.",
          }
        : {
            title: "Add it to your Home Screen",
            steps: [
              { text: "Tap {more} at the bottom (or {share})" },
              { text: "Tap Share" },
              { text: "Tap Add to Home Screen, then Add" },
            ],
            note: "Then open Relay Outpost from your Home Screen.",
          };
    case "macos-safari":
      return {
        title: "Add it to your Dock",
        steps: [{ text: "In the menu bar, choose File → Add to Dock" }, { text: "Click Add" }],
        note: "Relay Outpost then opens from your Dock like any app.",
      };
    case "web-install":
    case "bip":
      return { title: "Install Relay Outpost", action: "prompt", steps: [] };
    case "in-app-browser": {
      const app = ctx.inAppBrowser ?? "This app";
      const why = `${app === "an app" ? "Apps like this one open" : `${app} opens`} links in its own browser, which can't install apps.`;
      return ctx.android
        ? {
            title: "Open in Chrome to install",
            action: "open-in-chrome",
            copyLink: true,
            steps: [{ text: "Or tap {menu} or {more} at the top" }, { text: "Choose Open in Chrome (or Open in browser)" }],
            note: why,
          }
        : {
            title: "Open in Safari to install",
            copyLink: true,
            steps: [{ text: "Tap {more} or the menu" }, { text: "Choose Open in Safari (or Open in Browser)" }],
            note: why,
          };
    }
    case "unsupported":
      return ctx.android
        ? {
            title: "Add it to your Home screen",
            steps: [{ text: "Tap {menu} in your browser" }, { text: "Tap Install app or Add to Home screen" }],
          }
        : {
            title: "Install Relay Outpost",
            steps: [{ text: "Open your browser's menu" }, { text: "Choose Install app (or Install Relay Outpost)" }],
            note: "Don't see it? Chrome, Edge and Safari can install it.",
          };
  }
}

/**
 * Android's link that opens this page in Chrome, out of another app's browser.
 * A fragment stays in the page part: Android reads the intent from the last #.
 */
export function chromeIntentUrl(loc: { host: string; pathname: string; search: string; hash: string }): string {
  return `intent://${loc.host}${loc.pathname}${loc.search}${loc.hash}#Intent;scheme=https;package=com.android.chrome;end`;
}

/**
 * Home's one-time install card: after onboarding, on a phone or tablet, until
 * it's installed or dismissed. Quiet where it has nothing to offer.
 */
export function offerInstallCard(s: {
  method: InstallMethod; mobile: boolean; onboarded: boolean; dismissed: boolean;
}): boolean {
  if (!s.mobile || !s.onboarded || s.dismissed) return false;
  return s.method !== "installed" && s.method !== "unsupported";
}
