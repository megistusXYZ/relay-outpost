import { describe, it, expect } from "vitest";
import { isIOSDevice, feedVirtualizationEnabled } from "./is-ios";

// The iOS gate decides whether feeds virtualize (desktop/Android) or render
// the plain list (iOS — where stale scroll-event-driven transforms corrupted
// the virtualized feed in production). These tests lock both the device
// detection and the override precedence documented in lib/is-ios.ts.

const IPHONE = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  platform: "iPhone",
  maxTouchPoints: 5,
};

// iPadOS 13+ masquerades as a desktop Mac — UA and platform say MacIntel; the
// multi-touch screen is the only tell.
const IPAD_DESKTOP_UA = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 5,
};

const MAC_DESKTOP = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  platform: "MacIntel",
  maxTouchPoints: 0,
};

const ANDROID = {
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  platform: "Linux armv81",
  maxTouchPoints: 5,
};

const WINDOWS_DESKTOP = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  platform: "Win32",
  maxTouchPoints: 0,
};

describe("isIOSDevice", () => {
  it("detects iPhone", () => {
    expect(isIOSDevice(IPHONE)).toBe(true);
  });

  it("detects classic iPad UA", () => {
    expect(
      isIOSDevice({
        userAgent: "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPad",
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it("detects iPadOS 13+ masquerading as MacIntel via multi-touch", () => {
    expect(isIOSDevice(IPAD_DESKTOP_UA)).toBe(true);
  });

  it("does NOT flag a real desktop Mac (no touch screen)", () => {
    expect(isIOSDevice(MAC_DESKTOP)).toBe(false);
  });

  it("does NOT flag Android (touch, but not an Apple platform)", () => {
    expect(isIOSDevice(ANDROID)).toBe(false);
  });

  it("does NOT flag Windows desktop", () => {
    expect(isIOSDevice(WINDOWS_DESKTOP)).toBe(false);
  });

  it("returns false when no navigator is available (SSR safety)", () => {
    expect(isIOSDevice({})).toBe(false);
  });
});

describe("feedVirtualizationEnabled", () => {
  it("virtualizes on desktop by default", () => {
    expect(
      feedVirtualizationEnabled({ nav: MAC_DESKTOP, search: "", storedFlag: null })
    ).toBe(true);
  });

  it("virtualizes on Android by default", () => {
    expect(
      feedVirtualizationEnabled({ nav: ANDROID, search: "", storedFlag: null })
    ).toBe(true);
  });

  it("falls back to the plain list on iPhone", () => {
    expect(
      feedVirtualizationEnabled({ nav: IPHONE, search: "", storedFlag: null })
    ).toBe(false);
  });

  it("falls back to the plain list on iPadOS-as-Mac", () => {
    expect(
      feedVirtualizationEnabled({ nav: IPAD_DESKTOP_UA, search: "", storedFlag: null })
    ).toBe(false);
  });

  it("?forcePlainFeed=1 forces the plain path on any device", () => {
    expect(
      feedVirtualizationEnabled({ nav: MAC_DESKTOP, search: "?forcePlainFeed=1", storedFlag: null })
    ).toBe(false);
    // works without the leading "?" too (URLSearchParams accepts both)
    expect(
      feedVirtualizationEnabled({ nav: MAC_DESKTOP, search: "forcePlainFeed=1", storedFlag: null })
    ).toBe(false);
  });

  it("?forcePlainFeed=1 wins over the ro_virtual_feed=1 force-on flag", () => {
    expect(
      feedVirtualizationEnabled({ nav: MAC_DESKTOP, search: "?forcePlainFeed=1", storedFlag: "1" })
    ).toBe(false);
  });

  it("ro_virtual_feed=0 kill-switch disables virtualization on any device", () => {
    expect(
      feedVirtualizationEnabled({ nav: MAC_DESKTOP, search: "", storedFlag: "0" })
    ).toBe(false);
  });

  it("ro_virtual_feed=1 force-on overrides the iOS gate (device debugging)", () => {
    expect(
      feedVirtualizationEnabled({ nav: IPHONE, search: "", storedFlag: "1" })
    ).toBe(true);
  });

  it("other query params do not trigger the plain path", () => {
    expect(
      feedVirtualizationEnabled({ nav: MAC_DESKTOP, search: "?tab=channels", storedFlag: null })
    ).toBe(true);
  });
});
