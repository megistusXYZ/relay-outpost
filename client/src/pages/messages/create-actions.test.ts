import { describe, it, expect, vi } from "vitest";
import { buildCreateActions } from "./create-actions";

const handlers = () => ({
  canCreateGroup: true,
  onNewChat: vi.fn(),
  onNewGroup: vi.fn(),
  onJoinLink: vi.fn(),
  onScanQr: vi.fn(),
  onFindCommunity: vi.fn(),
});

// These tests exist because this list has drifted twice: once when the
// no-group-chats branch swallowed Join-via-link and Scan-QR, and once when
// Find-a-community reached three of the four surfaces that render it.
describe("buildCreateActions", () => {
  it("offers every way in, with group chat available", () => {
    expect(buildCreateActions(handlers()).map((a) => a.key)).toEqual([
      "new-chat",
      "new-group-chat",
      "join-via-link",
      "scan-qr",
      "find-community",
    ]);
  });

  it("drops ONLY group chat when groups are unavailable", () => {
    const keys = buildCreateActions({ ...handlers(), canCreateGroup: false }).map((a) => a.key);
    expect(keys).toEqual(["new-chat", "join-via-link", "scan-qr", "find-community"]);
  });

  it("keeps the arrive-somewhere-new doors open without group chat", () => {
    // The regression this guards: these two were once nested inside the group
    // branch, which removed the only paths to an invite link or a QR code
    // anywhere in the app for anyone without group chats.
    const keys = buildCreateActions({ ...handlers(), canCreateGroup: false }).map((a) => a.key);
    expect(keys).toContain("join-via-link");
    expect(keys).toContain("scan-qr");
  });

  it("always offers find-community, in both gate states", () => {
    for (const canCreateGroup of [true, false]) {
      const keys = buildCreateActions({ ...handlers(), canCreateGroup }).map((a) => a.key);
      expect(keys).toContain("find-community");
    }
  });

  it("wires each action to its own handler", () => {
    const h = handlers();
    const byKey = new Map(buildCreateActions(h).map((a) => [a.key, a]));
    byKey.get("new-chat")!.run();
    byKey.get("find-community")!.run();
    expect(h.onNewChat).toHaveBeenCalledOnce();
    expect(h.onFindCommunity).toHaveBeenCalledOnce();
    expect(h.onScanQr).not.toHaveBeenCalled();
  });

  it("gives every action a label, a description and an icon", () => {
    // A surface renders all three; a blank one reads as a broken row.
    for (const a of buildCreateActions(handlers())) {
      expect(a.label.trim()).not.toBe("");
      expect(a.desc.trim()).not.toBe("");
      expect(a.Icon).toBeTruthy();
      expect(a.testId.trim()).not.toBe("");
    }
  });

  it("keys and testIds are unique", () => {
    const actions = buildCreateActions(handlers());
    expect(new Set(actions.map((a) => a.key)).size).toBe(actions.length);
    expect(new Set(actions.map((a) => a.testId)).size).toBe(actions.length);
  });
});
