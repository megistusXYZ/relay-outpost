/**
 * One place that knows what device and browser this is (lib/platform.ts):
 * iOS (including the iPad that calls itself a Mac), Android, the installed
 * home-screen app, macOS Safari, and the in-app browsers of other apps, where
 * installing and signing in don't work the way they do in a real browser.
 */
import { describe, it, expect } from "vitest";
import { isIOSDevice, isIPadDevice, isAndroidDevice, isMacSafari, inAppBrowserOf, isPWAStandalone } from "./platform";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  ipadAsMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
  androidChrome: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.43 Mobile Safari/537.36",
  // In-app browsers.
  instagramIOS: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.29.92 (iPhone16,2; iOS 18_6; en_US; en; scale=3.00; 1290x2796; 774623234)",
  instagramAndroid: "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.43 Mobile Safari/537.36 Instagram 400.0.0.29.92 Android",
  facebookIOS: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/530.0.0.43.105;FBBV/700;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.6]",
  tiktokAndroid: "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 trill_410 BytedanceWebview/d8a21c6",
  xAndroid: "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 TwitterAndroid",
  telegramAndroid: "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36 Telegram-Android/12.0.1",
  linkedinIOS: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.31.1",
  androidWebView: "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36",
};

describe("isIOSDevice", () => {
  it("knows iPhone browsers, and the iPad that reports itself as a Mac", () => {
    expect(isIOSDevice({ userAgent: UA.iphoneSafari, platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isIOSDevice({ userAgent: UA.iphoneChrome, platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isIOSDevice({ userAgent: UA.ipadAsMac, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });
  it("a real Mac or an Android phone is not iOS", () => {
    expect(isIOSDevice({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isIOSDevice({ userAgent: UA.androidChrome, platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
  });
});

describe("isIPadDevice", () => {
  it("the iPad, also when it reports itself as a Mac; not the iPhone or a real Mac", () => {
    expect(isIPadDevice({ userAgent: UA.ipadAsMac, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIPadDevice({ userAgent: UA.iphoneSafari, platform: "iPhone", maxTouchPoints: 5 })).toBe(false);
    expect(isIPadDevice({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });
});

describe("isAndroidDevice and isMacSafari", () => {
  it("Android is Android", () => {
    expect(isAndroidDevice({ userAgent: UA.androidChrome })).toBe(true);
    expect(isAndroidDevice({ userAgent: UA.iphoneSafari })).toBe(false);
  });
  it("macOS Safari, and only Safari, on a Mac without touch", () => {
    expect(isMacSafari({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 })).toBe(true);
    expect(isMacSafari({ userAgent: UA.macChrome, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isMacSafari({ userAgent: UA.macFirefox, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isMacSafari({ userAgent: UA.ipadAsMac, platform: "MacIntel", maxTouchPoints: 5 })).toBe(false);
  });
});

describe("inAppBrowserOf", () => {
  it("names the app whose built-in browser this is", () => {
    expect(inAppBrowserOf(UA.instagramIOS)).toBe("Instagram");
    expect(inAppBrowserOf(UA.instagramAndroid)).toBe("Instagram");
    expect(inAppBrowserOf(UA.facebookIOS)).toBe("Facebook");
    expect(inAppBrowserOf(UA.tiktokAndroid)).toBe("TikTok");
    expect(inAppBrowserOf(UA.xAndroid)).toBe("X");
    expect(inAppBrowserOf(UA.telegramAndroid)).toBe("Telegram");
    expect(inAppBrowserOf(UA.linkedinIOS)).toBe("LinkedIn");
  });
  it("calls a bare Android web view an in-app browser", () => {
    expect(inAppBrowserOf(UA.androidWebView)).toBe("an app");
  });
  it("real browsers are not", () => {
    for (const ua of [UA.iphoneSafari, UA.iphoneChrome, UA.androidChrome, UA.macSafari, UA.macChrome, UA.macFirefox]) {
      expect(inAppBrowserOf(ua), ua).toBeNull();
    }
  });
});

describe("isPWAStandalone", () => {
  it("the installed app, by display mode or by iOS's own flag", () => {
    expect(isPWAStandalone({ displayModeStandalone: true, navigatorStandalone: false })).toBe(true);
    expect(isPWAStandalone({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isPWAStandalone({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false);
  });
});
