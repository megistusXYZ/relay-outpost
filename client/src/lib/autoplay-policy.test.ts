import { describe, it, expect } from "vitest";
import {
  autoplayDecision,
  mayAutoplay,
  isLowEndDevice,
  LOW_END_MEMORY_GB,
  LOW_END_CORES,
  AUTOPLAY_VISIBILITY_THRESHOLD,
  type AutoplayEnvironment,
} from "./autoplay-policy";

/** A capable device, on wifi, with autoplay on and nothing to hide. */
const ok = (over: Partial<AutoplayEnvironment> = {}): AutoplayEnvironment => ({
  settingEnabled: true,
  reducedMotion: false,
  saveData: false,
  slowConnection: false,
  deviceMemory: 8,
  hardwareConcurrency: 8,
  contentWarning: false,
  ...over,
});

describe("autoplayDecision — the five guards", () => {
  it("allows on a capable device with the setting on", () => {
    expect(autoplayDecision(ok())).toBe("allow");
    expect(mayAutoplay(ok())).toBe(true);
  });

  it("refuses under prefers-reduced-motion", () => {
    expect(autoplayDecision(ok({ reducedMotion: true }))).toBe("reduced-motion");
  });

  it("refuses behind an unrevealed content warning", () => {
    // A warning you can watch play out behind a blur is not a warning.
    expect(autoplayDecision(ok({ contentWarning: true }))).toBe("content-warning");
  });

  it("refuses on save-data", () => {
    expect(autoplayDecision(ok({ saveData: true }))).toBe("save-data");
  });

  it("refuses on a 2G-class connection", () => {
    expect(autoplayDecision(ok({ slowConnection: true }))).toBe("slow-connection");
  });

  it("refuses on a low-end device", () => {
    expect(autoplayDecision(ok({ deviceMemory: LOW_END_MEMORY_GB }))).toBe("low-end-device");
    expect(autoplayDecision(ok({ hardwareConcurrency: LOW_END_CORES }))).toBe("low-end-device");
  });

  it("refuses when the user turned it off", () => {
    expect(autoplayDecision(ok({ settingEnabled: false }))).toBe("off");
  });
});

describe("precedence — the verdict names the real cause", () => {
  it("puts reduced motion above the user's own autoplay setting", () => {
    // Not a contradiction to resolve in favour of the app: someone who enabled
    // autoplay AND asked their OS for less motion is telling you the second
    // thing means "this makes me unwell". The OS wins.
    expect(autoplayDecision(ok({ reducedMotion: true, settingEnabled: true }))).toBe("reduced-motion");
  });

  it("reports the accessibility reason ahead of the network one", () => {
    expect(autoplayDecision(ok({ reducedMotion: true, saveData: true }))).toBe("reduced-motion");
  });

  it("reports the content warning ahead of device and network reasons", () => {
    expect(autoplayDecision(ok({ contentWarning: true, saveData: true, deviceMemory: 2 })))
      .toBe("content-warning");
  });

  it("never returns allow when any guard fires", () => {
    const guards: Partial<AutoplayEnvironment>[] = [
      { reducedMotion: true },
      { contentWarning: true },
      { saveData: true },
      { slowConnection: true },
      { deviceMemory: 2 },
      { hardwareConcurrency: 2 },
      { settingEnabled: false },
    ];
    for (const g of guards) expect(mayAutoplay(ok(g))).toBe(false);
  });
});

describe("isLowEndDevice — absent is not weak", () => {
  it("treats a browser that reports nothing as capable", () => {
    // deviceMemory is Chromium-only and Safari reports neither. Treating
    // "unknown" as low-end would disable autoplay on every iPhone, which is
    // the exact opposite of the intent.
    expect(isLowEndDevice({})).toBe(false);
    expect(isLowEndDevice({ deviceMemory: undefined, hardwareConcurrency: undefined })).toBe(false);
  });

  it("ignores nonsense values rather than trusting them", () => {
    expect(isLowEndDevice({ deviceMemory: 0 })).toBe(false);
    expect(isLowEndDevice({ hardwareConcurrency: 0 })).toBe(false);
    expect(isLowEndDevice({ deviceMemory: -1 })).toBe(false);
  });

  it("catches a weak device on either axis", () => {
    expect(isLowEndDevice({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(true);
    expect(isLowEndDevice({ deviceMemory: 8, hardwareConcurrency: 2 })).toBe(true);
  });

  it("does NOT call a four-core phone low-end", () => {
    // This is the line that mattered. iOS Safari commonly reports exactly 4
    // for hardwareConcurrency and reports NO deviceMemory at all, so at a
    // threshold of 4 that single number silently denied autoplay across a
    // large slice of iPhones — the setting reading ON while nothing played.
    expect(isLowEndDevice({ hardwareConcurrency: 4 })).toBe(false);
    expect(isLowEndDevice({ deviceMemory: undefined, hardwareConcurrency: 4 })).toBe(false);
  });

  it("passes a device exactly one step above the line", () => {
    expect(isLowEndDevice({
      deviceMemory: LOW_END_MEMORY_GB + 1,
      hardwareConcurrency: LOW_END_CORES + 1,
    })).toBe(false);
  });
});

describe("the visibility threshold", () => {
  it("is well past a sliver", () => {
    // A video that starts when a sliver shows has already spent bandwidth by
    // the time it is scrolled past.
    expect(AUTOPLAY_VISIBILITY_THRESHOLD).toBeGreaterThanOrEqual(0.5);
    expect(AUTOPLAY_VISIBILITY_THRESHOLD).toBeLessThan(1);
  });
});
