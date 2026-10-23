/**
 * How this visitor can install the app (lib/install-method.ts), and what one
 * tap on "Install" does. Chromium's Web Install API (`navigator.install()`)
 * comes first; the older install-prompt event (BIP) is the fallback. One tap never
 * uses both: the first call spends the tap's user activation, so a failed
 * Web Install hands over to the old prompt on the NEXT tap.
 */
import { describe, it, expect, vi } from "vitest";
import { chooseInstallMethod, runInstallPrompt, type InstallEnv } from "./install-method";

const base: InstallEnv = {
  standalone: false, installed: false, inAppBrowser: false, ios: false,
  webInstallAvailable: false, webInstallFailed: false, bipAvailable: false, macSafari: false,
};

describe("chooseInstallMethod", () => {
  it("installed beats everything", () => {
    expect(chooseInstallMethod({ ...base, standalone: true, ios: true, inAppBrowser: true })).toBe("installed");
    expect(chooseInstallMethod({ ...base, installed: true, bipAvailable: true })).toBe("installed");
  });
  it("inside another app's browser, the way out comes first", () => {
    expect(chooseInstallMethod({ ...base, inAppBrowser: true, ios: true })).toBe("in-app-browser");
    expect(chooseInstallMethod({ ...base, inAppBrowser: true, bipAvailable: true })).toBe("in-app-browser");
  });
  it("iOS has no install API: instructions", () => {
    expect(chooseInstallMethod({ ...base, ios: true })).toBe("ios-instructions");
  });
  it("Web Install first, then the old prompt, and the old prompt once Web Install failed", () => {
    expect(chooseInstallMethod({ ...base, webInstallAvailable: true, bipAvailable: true })).toBe("web-install");
    expect(chooseInstallMethod({ ...base, webInstallAvailable: true, webInstallFailed: true, bipAvailable: true })).toBe("bip");
    expect(chooseInstallMethod({ ...base, bipAvailable: true })).toBe("bip");
  });
  it("macOS Safari adds to the Dock; anything else is unsupported", () => {
    expect(chooseInstallMethod({ ...base, macSafari: true })).toBe("macos-safari");
    expect(chooseInstallMethod(base)).toBe("unsupported");
    expect(chooseInstallMethod({ ...base, webInstallAvailable: true, webInstallFailed: true })).toBe("unsupported");
  });
});

const abortError = () => Object.assign(new Error("cancelled"), { name: "AbortError" });
const notAllowed = () => Object.assign(new Error("no"), { name: "NotAllowedError" });

describe("runInstallPrompt", () => {
  it("Web Install that resolves is accepted", async () => {
    const install = vi.fn(async () => undefined);
    expect(await runInstallPrompt("web-install", { install, bip: null })).toEqual({ outcome: "accepted" });
    expect(install).toHaveBeenCalledWith();
  });

  it("Web Install the person cancels is dismissed, and stays available", async () => {
    const r = await runInstallPrompt("web-install", { install: async () => { throw abortError(); }, bip: null });
    expect(r).toEqual({ outcome: "dismissed" });
  });

  it("Web Install that fails is marked failed, and the old prompt is NOT called in the same tap", async () => {
    const bip = { prompt: vi.fn(async () => undefined), userChoice: Promise.resolve({ outcome: "accepted" as const }) };
    const r = await runInstallPrompt("web-install", { install: async () => { throw notAllowed(); }, bip });
    expect(r).toEqual({ outcome: "unavailable", webInstallFailed: true });
    expect(bip.prompt).not.toHaveBeenCalled();
  });

  it("the old prompt reports the person's choice and is used up", async () => {
    const bip = { prompt: vi.fn(async () => undefined), userChoice: Promise.resolve({ outcome: "dismissed" as const }) };
    expect(await runInstallPrompt("bip", { bip })).toEqual({ outcome: "dismissed", bipUsed: true });
    expect(bip.prompt).toHaveBeenCalledTimes(1);
  });

  it("an old prompt that throws is used up too", async () => {
    const bip = { prompt: async () => { throw new Error("gone"); }, userChoice: Promise.resolve({ outcome: "accepted" as const }) };
    expect(await runInstallPrompt("bip", { bip })).toEqual({ outcome: "unavailable", bipUsed: true });
  });

  it("methods with nothing to prompt are unavailable", async () => {
    for (const m of ["ios-instructions", "in-app-browser", "macos-safari", "unsupported", "installed"] as const) {
      expect(await runInstallPrompt(m, { bip: null })).toEqual({ outcome: "unavailable" });
    }
  });
});
