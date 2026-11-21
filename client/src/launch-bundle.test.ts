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
    expect(app).toMatch(/\{!holdHome && <HomeKeepAlive /);
    expect(app).toMatch(/const holdHome = holdHomeForLanding\(\{[\s\S]*?arrival: ARRIVAL/);
  });

  it("the landing/sign-in overlay loads only once it has been needed", () => {
    // Its code is fetched on demand (never a static import), and only when the overlay is needed.
    expect(app).toMatch(/import\("@\/components\/GalaxyWarpOverlay"\)/);
    expect(app).not.toMatch(/import \{[^}]*GalaxyWarpOverlay[^}]*\} from "@\/components\/GalaxyWarpOverlay"/);
    expect(app).toMatch(/const GalaxyWarpOverlay = useLandingOverlay\(galaxyNeeded\);/);
    expect(app).toMatch(/if \(!needed \|\| got\.Overlay\) return;/);
  });

  // React shows a lazy component by a Suspense "retry", which runs below every ordinary update and
  // never expires. On a slow phone the signed-out feed kept the page busy and the landing waited 11
  // to 15 seconds in one launch out of three, with the app's empty shell showing (measured on a
  // production build with the processor slowed four times, 2026-11-21).
  it("the landing is put on the page by an ordinary update, never by a Suspense retry", () => {
    expect(app).not.toMatch(/lazy\(\(\) => lazyNamed\(\(\) => import\("@\/components\/GalaxyWarpOverlay"\)/);
    expect(app).toMatch(/loadLandingOverlay\(\)\.then\(\s*\(Overlay\) => \{ if \(live\) setGot\(\{ Overlay, error: null \}\); \}/);
  });

  // The launch screen used to lift as soon as the shell had painted, landing or no landing.
  it("while a visitor's landing is still downloading, the launch screen stays up", () => {
    expect(app).toMatch(/\{galaxyNeeded && !GalaxyWarpOverlay && overlayMode !== "hidden" && <LandingPending \/>\}/);
    expect(app).toMatch(/function LandingPending\(\) \{\s*useLayoutEffect\(\(\) => routeLoaderShown\(\), \[\]\);\s*return null;/);
  });

  it("someone signed in never waits for the landing's code, which they load hidden", () => {
    // The hold is only for a landing that will be seen.
    expect(app).toMatch(/!GalaxyWarpOverlay && overlayMode !== "hidden" && <LandingPending/);
  });

  it("a landing whose code will not load reaches the error screen, as a failed page does", () => {
    expect(app).toMatch(/if \(got\.error\) throw got\.error;/);
  });
});
