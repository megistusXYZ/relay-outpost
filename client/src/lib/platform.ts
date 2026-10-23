/**
 * What device and browser this is, in one place. Installing the app and
 * signing in work differently on iOS, inside the installed home-screen app,
 * in macOS Safari, and inside other apps' built-in browsers, so those checks
 * live here instead of being re-written per screen. Every check takes an
 * injectable navigator so tests can pass a user agent.
 */

/** The subset of `navigator` the checks read. */
export interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

function nav(n?: NavigatorLike): NavigatorLike | undefined {
  return n ?? (typeof navigator !== "undefined" ? (navigator as NavigatorLike) : undefined);
}

/**
 * True on iPhone/iPod/iPad, including iPadOS 13+ which reports itself as a
 * desktop Mac ("MacIntel") but is the only Mac with a multi-touch screen.
 */
export function isIOSDevice(n?: NavigatorLike): boolean {
  const v = nav(n);
  if (!v) return false;
  const ua = v.userAgent ?? "";
  const platform = v.platform ?? "";
  if (/iPhone|iPad|iPod/i.test(ua) || /iPhone|iPad|iPod/i.test(platform)) return true;
  return platform === "MacIntel" && (v.maxTouchPoints ?? 0) > 1;
}

/** An iPad, including the one that reports itself as a Mac. Safari's Share button sits at its top. */
export function isIPadDevice(n?: NavigatorLike): boolean {
  const v = nav(n);
  if (!v || !isIOSDevice(v)) return false;
  return /iPad/i.test(v.userAgent ?? "") || /iPad/i.test(v.platform ?? "") || v.platform === "MacIntel";
}

export function isAndroidDevice(n?: NavigatorLike): boolean {
  return /Android/i.test(nav(n)?.userAgent ?? "");
}

/** A phone or tablet (the touch iPad that reports itself as a Mac included). */
export function isMobileDevice(n?: NavigatorLike, innerWidth?: number): boolean {
  const v = nav(n);
  if (!v) return false;
  if (/Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini|IEMobile/i.test(v.userAgent ?? "")) return true;
  const width = innerWidth ?? (typeof window !== "undefined" ? window.innerWidth : 9999);
  return (v.maxTouchPoints ?? 0) > 1 && width < 1024;
}

/** Safari on a Mac (not the iPad, not Chrome or Firefox): installs with File → Add to Dock. */
export function isMacSafari(n?: NavigatorLike): boolean {
  const v = nav(n);
  if (!v || isIOSDevice(v)) return false;
  const ua = v.userAgent ?? "";
  if (!/Macintosh/i.test(ua)) return false;
  return /Version\/[\d.]+.*Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);
}

/** Other apps' built-in browsers, by the marks they leave in the user agent. Specific apps first. */
const IN_APP_BROWSERS: Array<[RegExp, string]> = [
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, "Facebook"],
  [/TikTok|musical_ly|BytedanceWebview|trill_/i, "TikTok"],
  [/Twitter/i, "X"],
  [/Telegram/i, "Telegram"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Snapchat/i, "Snapchat"],
  [/Pinterest/i, "Pinterest"],
  [/Line\//i, "LINE"],
  [/KAKAOTALK/i, "KakaoTalk"],
  [/MicroMessenger/i, "WeChat"],
  [/WhatsApp/i, "WhatsApp"],
  [/\bGSA\//i, "the Google app"],
  // A bare Android web view: some app showing a page in itself.
  [/; wv\)/i, "an app"],
];

/** The app whose built-in browser this is, or null in a real browser. */
export function inAppBrowserOf(userAgent?: string): string | null {
  const ua = userAgent ?? nav()?.userAgent ?? "";
  for (const [re, name] of IN_APP_BROWSERS) if (re.test(ua)) return name;
  return null;
}

export function isInAppBrowser(userAgent?: string): boolean {
  return inAppBrowserOf(userAgent) !== null;
}

/** Injectable signals for `isPWAStandalone`. */
export interface StandaloneSignals {
  displayModeStandalone: boolean;
  /** iOS's own flag for a home-screen web app. */
  navigatorStandalone: boolean;
}

function readStandaloneSignals(): StandaloneSignals {
  if (typeof window === "undefined") return { displayModeStandalone: false, navigatorStandalone: false };
  let displayModeStandalone = false;
  try { displayModeStandalone = !!window.matchMedia?.("(display-mode: standalone)")?.matches; } catch { /* no matchMedia */ }
  return { displayModeStandalone, navigatorStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone === true };
}

/** Running as the installed app (home screen, dock or desktop), not in a browser tab. */
export function isPWAStandalone(signals?: StandaloneSignals): boolean {
  const s = signals ?? readStandaloneSignals();
  return s.displayModeStandalone || s.navigatorStandalone;
}
