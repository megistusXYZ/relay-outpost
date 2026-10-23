// @vitest-environment jsdom
/**
 * One tap on "Install" in Chromium (hooks/use-pwa-install.ts). The Web
 * Install API, `navigator.install()`, goes first. If it fails for any reason
 * other than the person cancelling, this tap ends there (its user activation
 * is spent) and the NEXT tap opens the browser's older install prompt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Nav = Navigator & { install?: () => Promise<unknown> };

function fakePrompt(m: { INSTALL_PROMPT_EVENT: string }, outcome: "accepted" | "dismissed") {
  const e = new Event(m.INSTALL_PROMPT_EVENT) as Event & {
    prompt: ReturnType<typeof vi.fn>; userChoice: Promise<{ outcome: typeof outcome }>;
  };
  e.prompt = vi.fn(async () => undefined);
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

async function freshModule() {
  vi.resetModules();
  return import("./use-pwa-install");
}

beforeEach(() => {
  // test:ci-globals deletes `navigator` (a Node 22 global); jsdom on Node 20
  // has one, so stand one in.
  if (typeof navigator === "undefined") {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "", platform: "", maxTouchPoints: 0 }, configurable: true, writable: true,
    });
  }
  // jsdom has no matchMedia; nothing here is standalone or a phone.
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  delete (navigator as Nav).install;
});

describe("promptInstallOnce", () => {
  it("uses navigator.install when the browser has it", async () => {
    const install = vi.fn(async () => undefined);
    (navigator as Nav).install = install;
    const m = await freshModule();
    expect(m.installMethodNow()).toBe("web-install");
    expect(await m.promptInstallOnce()).toBe("accepted");
    expect(install).toHaveBeenCalledTimes(1);
    expect(m.installMethodNow()).toBe("installed");
  });

  it("a cancel keeps Web Install for the next tap", async () => {
    const install = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); });
    (navigator as Nav).install = install;
    const m = await freshModule();
    expect(await m.promptInstallOnce()).toBe("dismissed");
    expect(m.installMethodNow()).toBe("web-install");
  });

  it("a failure hands over to the old prompt on the NEXT tap, never the same one", async () => {
    (navigator as Nav).install = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "NotAllowedError" }); });
    const m = await freshModule();
    const bip = fakePrompt(m, "accepted");
    window.dispatchEvent(bip);

    expect(await m.promptInstallOnce()).toBe("unavailable");
    expect(bip.prompt).not.toHaveBeenCalled();
    expect(m.installMethodNow()).toBe("bip");

    expect(await m.promptInstallOnce()).toBe("accepted");
    expect(bip.prompt).toHaveBeenCalledTimes(1);
    expect(m.installMethodNow()).toBe("installed");
  });

  it("without navigator.install the old prompt is used straight away", async () => {
    const m = await freshModule();
    const bip = fakePrompt(m, "dismissed");
    window.dispatchEvent(bip);
    expect(m.installMethodNow()).toBe("bip");
    expect(await m.promptInstallOnce()).toBe("dismissed");
    expect(bip.prompt).toHaveBeenCalledTimes(1);
    // A shown prompt is used up.
    expect(m.installMethodNow()).toBe("unsupported");
  });
});
