/**
 * The chat home's chrome (owner, 2026-10-01: "too much and clutter … on
 * desktop and mobile"). Before: search · eye · refresh · New, then a wrapping
 * row of counted chips with a Real-names toggle, then a Messages/Deleted tab
 * bar — four rows before the first chat. After: ONE control row (search, a ⋯
 * menu, New) and ONE line of chips. The menu's contents are decided in
 * helpers.chatHomeMenu (tested there); this pins the chrome around it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.resolve(import.meta.dirname, "ChatList.tsx"), "utf8");

describe("chat home chrome", () => {
  it("has one ⋯ menu and no standalone utility buttons on the rail", () => {
    expect(src).toContain('data-testid="button-chat-home-menu"');
    for (const gone of ["button-private-mode", "button-refresh-conversations", "button-show-real-names"]) {
      expect(src).not.toContain(`data-testid="${gone}"`);
    }
    // Every menu item is wired to the thing it names.
    expect(src).toMatch(/if \(key === "private"\) togglePrivateMasked\(\);/);
    expect(src).toMatch(/else if \(key === "refresh"\) doRefresh\(\);/);
    expect(src).toMatch(/else if \(key === "real-names"\) toggleShowRealNames\(\);/);
    expect(src).toMatch(/else if \(key === "deleted"\) setShowDeleted\(true\);/);
  });

  it("the filter chips are one line that scrolls, never a wrapping block, and carry only an unread badge", () => {
    const row = src.slice(src.indexOf('data-testid="chat-filter-row"') - 400, src.indexOf('data-testid="chat-filter-row"') + 1600);
    expect(row).toContain("overflow-x-auto");
    expect(row).not.toContain("flex-wrap");
    expect(row).not.toMatch(/\{opt\.count\}/);
    expect(row).toMatch(/\{opt\.unread > 0 && opt\.key !== "all" && \(/);
  });

  it("Deleted is a view with a single way back, not a permanent tab bar", () => {
    expect(src).not.toContain('data-testid="tab-deleted-messages"');
    expect(src).not.toContain('data-testid="tab-active-messages"');
    expect(src).toContain('data-testid="button-deleted-back"');
  });
});

describe("New chat uses the one search box", () => {
  // Owner, 2026-10-01: "I don't like how this opens up an extra search
  // section" — New chat opened a "Start a new conversation" strip with its
  // own search field above the list's search field.
  it("there is no second search field", () => {
    expect(src).not.toContain('data-testid="input-new-chat-pubkey"');
    expect(src).not.toContain("Start a new conversation</p>");
  });

  it("the list's search box also drives the people search, and New chat focuses it", () => {
    expect(src).toMatch(/onChange=\{\(e\) => \{ setSearchFilter\(e\.target\.value\); setNewChatInput\(e\.target\.value\); \}\}/);
    expect(src).toMatch(/if \(!showNewChat\) return;\s+searchInputRef\.current\?\.focus\(\);/);
  });

  it("people results sit inline under the header, with a pasted address offered as a row", () => {
    const i = src.indexOf('data-testid="container-user-search-results"');
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i - 200, i + 600);
    expect(block).not.toContain("absolute");
    expect(src).toContain('data-testid="button-start-chat"');
  });
});
