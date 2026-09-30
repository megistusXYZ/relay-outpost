// @vitest-environment jsdom
/**
 * An installed app moves onto a new build by itself (owner, 2026-09-29:
 * people were forcing updates from the menu to get a fix). Installed apps on
 * iOS resume rather than relaunch, so a phone kept running an old build until
 * someone tapped Restart. Now: back after 15+ minutes away with a newer build
 * ready, it restarts onto it; a shorter break keeps your place (the Update
 * pill offers it). Never while you've typed something unsent, or while audio
 * or video (a call) is playing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { installUpdateOnReturn, pageLooksBusy, AWAY_MS } from "./update-on-return";

let uninstall: (() => void) | null = null;
afterEach(() => { uninstall?.(); uninstall = null; document.body.innerHTML = ""; });

/** Drive document.visibilityState the way a phone does when you leave and come back. */
function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function setup(opts: { updateReady: boolean }) {
  let now = 1_790_000_000_000;
  const checkForUpdate = vi.fn(async () => opts.updateReady);
  const apply = vi.fn();
  uninstall = installUpdateOnReturn({ now: () => now, checkForUpdate, apply, doc: document });
  return {
    checkForUpdate,
    apply,
    async leaveFor(ms: number) {
      setVisibility("hidden");
      now += ms;
      setVisibility("visible");
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("coming back to the app", () => {
  it("after 15+ minutes away with a newer build ready: restarts onto it", async () => {
    const s = setup({ updateReady: true });
    await s.leaveFor(AWAY_MS);
    expect(s.checkForUpdate).toHaveBeenCalled();
    expect(s.apply).toHaveBeenCalledOnce();
  });

  it("a short break keeps your place, even with an update ready", async () => {
    const s = setup({ updateReady: true });
    await s.leaveFor(AWAY_MS - 60_000);
    expect(s.apply).not.toHaveBeenCalled();
  });

  it("no newer build: nothing happens", async () => {
    const s = setup({ updateReady: false });
    await s.leaveFor(2 * AWAY_MS);
    expect(s.apply).not.toHaveBeenCalled();
  });

  it("never while you've typed something unsent", async () => {
    const s = setup({ updateReady: true });
    const box = document.createElement("textarea");
    box.value = "half a reply";
    document.body.appendChild(box);
    await s.leaveFor(2 * AWAY_MS);
    expect(s.apply).not.toHaveBeenCalled();
  });

  it("never while audio or video is playing (a call, a podcast)", async () => {
    const s = setup({ updateReady: true });
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "paused", { value: false });
    document.body.appendChild(audio);
    await s.leaveFor(2 * AWAY_MS);
    expect(s.apply).not.toHaveBeenCalled();
  });
});

describe("pageLooksBusy", () => {
  it("an empty page, an empty box or a paused player isn't busy", () => {
    expect(pageLooksBusy(document)).toBe(false);
    document.body.appendChild(document.createElement("textarea"));
    const v = document.createElement("video");
    document.body.appendChild(v);
    expect(pageLooksBusy(document)).toBe(false);
  });

  it("a search box with text doesn't count as unsent writing", () => {
    const search = document.createElement("input");
    search.type = "search";
    search.value = "jack";
    document.body.appendChild(search);
    expect(pageLooksBusy(document)).toBe(false);
  });
});

describe("the wiring", () => {
  it("the app's update code installs it, restarting through the fresh-shell path", async () => {
    const { readFileSync } = await import("fs");
    const path = await import("path");
    const src = readFileSync(path.resolve(import.meta.dirname, "app-update.ts"), "utf8");
    const polling = src.slice(src.indexOf("export function startAppUpdatePolling"));
    expect(polling).toMatch(/installUpdateOnReturn\(\{[\s\S]*apply: applyUpdate/);
    expect(src).toMatch(/void reloadOntoFreshShell\(\)/);
  });
});
