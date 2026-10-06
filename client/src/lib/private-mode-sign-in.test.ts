// @vitest-environment jsdom
/**
 * Owner (2026-10-06): "when I put my nsec in the PWA and browser, or even just
 * signed in again, it showed me all of my chats and they were not behind the
 * private screen."
 *
 * Two holes, one rule: whether Chats starts shielded is decided at sign-in,
 * not only when the page loads.
 *  - Signed in again in the same session: the setting re-arms the shield, even
 *    after an earlier "Show chats".
 *  - Signed in on a device that has never received this account's settings
 *    (a new browser, a pasted nsec): nobody knows yet whether private mode is
 *    on, so Chats stays shielded until the settings answer arrives — then it
 *    follows them. No answer at all keeps the shield (owner's call).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

async function freshModule() {
  vi.resetModules();
  return import("./private-mode");
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
});

describe("signing in decides the shield", () => {
  it("signing in again re-arms the shield when the setting is on, even after Show chats", async () => {
    localStorage.setItem("relay-outpost-private-mode", "true");
    const pm = await freshModule();
    pm.revealPrivateMasked(); // "Show chats" earlier in this session
    expect(pm.isPrivateMasked()).toBe(false);

    pm.privateModeOnSignIn(true);

    expect(pm.isPrivateMasked()).toBe(true);
  });

  it("signing in with the setting off leaves the list showing", async () => {
    const pm = await freshModule();
    pm.privateModeOnSignIn(true);
    expect(pm.isPrivateMasked()).toBe(false);
  });

  it("on a device without this account's settings, chats stay shielded until they arrive", async () => {
    const pm = await freshModule(); // nothing stored here: a new browser
    pm.privateModeOnSignIn(false);
    expect(pm.isPrivateMasked()).toBe(true);
    expect(pm.isPrivateModePending()).toBe(true);
  });

  it("when the settings arrive with private mode on, the shield stays", async () => {
    const pm = await freshModule();
    pm.privateModeOnSignIn(false);
    localStorage.setItem("relay-outpost-private-mode", "true"); // the sync writes it raw
    pm.privateModeSettingsSettled();
    expect(pm.isPrivateMasked()).toBe(true);
    expect(pm.isPrivateModePending()).toBe(false);
  });

  it("when the settings arrive with private mode off, the list shows", async () => {
    const pm = await freshModule();
    pm.privateModeOnSignIn(false);
    pm.privateModeSettingsSettled();
    expect(pm.isPrivateMasked()).toBe(false);
    expect(pm.isPrivateModePending()).toBe(false);
  });

  it("settings arriving later never undo a Show chats tapped while waiting", async () => {
    const pm = await freshModule();
    pm.privateModeOnSignIn(false);
    pm.revealPrivateMasked();
    pm.privateModeSettingsSettled();
    expect(pm.isPrivateMasked()).toBe(false);
  });
});
