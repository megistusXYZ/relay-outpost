/**
 * What a signed-in launch loads before Chats (measured on the production
 * build, 2026-09-29): main loaded the Home feed and the landing/sign-in
 * overlay only to drop both a frame later, and the entry bundle carried the
 * composer, orbit menu, create studio and feedback drawer (~470 KB of module
 * code) that nobody sees at launch. These pin the fix, because one static
 * import quietly puts any of it back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = (p: string) => readFileSync(path.resolve(import.meta.dirname, p), "utf8");
const app = src("App.tsx");

describe("the launch bundle", () => {
  it("App loads the shell overlays lazily, behind DeferredShell", () => {
    for (const m of ["CreatePost", "OrbitMenu", "CreateStudio", "FeedbackDrawer"]) {
      expect(app, m).not.toMatch(new RegExp(`^import [^;]* from "@/components/${m}";`, "m"));
      expect(app, m).toContain(`import("@/components/${m}")`);
    }
    expect(app).toMatch(/<DeferredShell events=\{SHELL_OVERLAY_EVENTS\}>[\s\S]*<OrbitMenu \/>[\s\S]*<\/DeferredShell>/);
    expect(app).toMatch(/<DeferredShell events=\{FEEDBACK_EVENTS\}>[\s\S]*<FeedbackDrawer \/>[\s\S]*<\/DeferredShell>/);
  });

  it("everything that opens them imports the light openers, not the overlays", () => {
    for (const f of ["components/DesktopStoriesRail.tsx", "components/MobileFooter.tsx", "components/app-sidebar.tsx", "components/OrbitMenu.tsx", "pages/MyOutpost.tsx", "App.tsx"]) {
      expect(src(f), f).not.toMatch(/from "@\/components\/(CreateStudio|OrbitMenu)"/);
    }
  });

  it("a signed-in launch landing on Chats doesn't start Home on the way", () => {
    expect(app).toMatch(/\{!holdHomeForLanding && <HomeKeepAlive /);
    expect(app).toMatch(/const holdHomeForLanding = landingLocation === "\/" && shouldLandOnChats\(/);
  });

  it("the landing/sign-in overlay loads only once it has been needed", () => {
    expect(app).toMatch(/\{galaxyNeeded && <Suspense fallback=\{null\}>\s*<GalaxyWarpOverlay/);
  });
});
