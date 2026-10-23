/**
 * What each device is told to do to install the app (lib/install-guide.ts),
 * and when Home offers the one-time install card. iOS has no install button:
 * on iOS 26 Safari, Share sits behind ••• on iPhone and at the top on iPad.
 * macOS Safari adds web apps to the Dock from the File menu.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { installGuideFor, stepText, offerInstallCard, chromeIntentUrl } from "./install-guide";

const phone = { ipad: false, android: false, inAppBrowser: null };

describe("installGuideFor", () => {
  it("iPhone: three short steps through ••• or Share to Add to Home Screen", () => {
    const g = installGuideFor("ios-instructions", phone)!;
    const steps = g.steps.map(stepText);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/•••/);
    expect(steps[0]).toMatch(/Share/);
    expect(steps[1]).toMatch(/Share/);
    expect(steps[2]).toMatch(/Add to Home Screen/);
    // Both icons are drawn in the first step.
    expect(g.steps[0].text).toContain("{more}");
    expect(g.steps[0].text).toContain("{share}");
  });

  it("iPad: Share is at the top", () => {
    const steps = installGuideFor("ios-instructions", { ...phone, ipad: true })!.steps.map(stepText);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/Share.*top/);
    expect(steps.join(" ")).toMatch(/Add to Home Screen/);
  });

  it("macOS Safari: File → Add to Dock", () => {
    const steps = installGuideFor("macos-safari", phone)!.steps.map(stepText);
    expect(steps[0]).toMatch(/File → Add to Dock/);
  });

  it("browsers with an install dialog get a button, not steps", () => {
    expect(installGuideFor("web-install", phone)!.action).toBe("prompt");
    expect(installGuideFor("bip", phone)!.action).toBe("prompt");
  });

  it("anything else points at the browser's own menu", () => {
    expect(installGuideFor("unsupported", { ...phone, android: true })!.steps.map(stepText).join(" ")).toMatch(/Add to Home screen|Install app/);
    expect(installGuideFor("unsupported", phone)!.steps.map(stepText).join(" ")).toMatch(/Install/);
  });

  it("in another app's browser on Android: one button opens Chrome, steps as a fallback", () => {
    const g = installGuideFor("in-app-browser", { ...phone, android: true, inAppBrowser: "Instagram" })!;
    expect(g.action).toBe("open-in-chrome");
    expect(g.copyLink).toBe(true);
    expect(g.steps.map(stepText).join(" ")).toMatch(/Open in Chrome/);
  });

  it("in another app's browser on iOS: Open in Safari steps and a copy-link button", () => {
    const g = installGuideFor("in-app-browser", { ...phone, inAppBrowser: "X" })!;
    expect(g.action).toBeUndefined();
    expect(g.copyLink).toBe(true);
    const steps = g.steps.map(stepText);
    expect(steps[0]).toMatch(/••• or the menu/);
    expect(steps[1]).toMatch(/Open in Safari/);
    expect(steps[1]).toMatch(/Open in Browser/);
    expect(g.title).toMatch(/Safari/);
  });

  it("nothing to do once installed", () => {
    expect(installGuideFor("installed", phone)).toBeNull();
  });
});

describe("chromeIntentUrl", () => {
  it("opens this exact page in Chrome", () => {
    expect(chromeIntentUrl({ host: "relayop.xyz", pathname: "/discover", search: "?tab=people", hash: "" }))
      .toBe("intent://relayop.xyz/discover?tab=people#Intent;scheme=https;package=com.android.chrome;end");
  });
  it("keeps a fragment before the intent part (Android reads from the last #)", () => {
    expect(chromeIntentUrl({ host: "relayop.xyz", pathname: "/invite/abc", search: "", hash: "#k" }))
      .toBe("intent://relayop.xyz/invite/abc#k#Intent;scheme=https;package=com.android.chrome;end");
  });
});

describe("offerInstallCard", () => {
  const ready = { method: "ios-instructions" as const, mobile: true, onboarded: true, dismissed: false };
  it("after onboarding, on a phone, not installed, not dismissed", () => {
    expect(offerInstallCard(ready)).toBe(true);
    expect(offerInstallCard({ ...ready, method: "bip" })).toBe(true);
  });
  it("never before onboarding, on a desktop, once installed, or after a dismiss", () => {
    expect(offerInstallCard({ ...ready, onboarded: false })).toBe(false);
    expect(offerInstallCard({ ...ready, mobile: false })).toBe(false);
    expect(offerInstallCard({ ...ready, method: "installed" })).toBe(false);
    expect(offerInstallCard({ ...ready, dismissed: true })).toBe(false);
  });
  it("offers the way out of another app's browser", () => {
    expect(offerInstallCard({ ...ready, method: "in-app-browser" })).toBe(true);
  });
  it("stays quiet where there is nothing it can do", () => {
    expect(offerInstallCard({ ...ready, method: "unsupported" })).toBe(false);
  });
});

describe("install screens", () => {
  it("never open the share sheet themselves (it can't add to the Home Screen)", () => {
    for (const f of ["components/InstallFirstCard.tsx", "components/install/InstallSteps.tsx", "components/install/InAppBrowserEscape.tsx"]) {
      const src = readFileSync(path.join(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/navigator\.share/);
    }
  });
});
