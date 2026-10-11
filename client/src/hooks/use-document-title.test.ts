/**
 * The tab's title names the app once. Guide pages pass titles that already
 * carry "— Relay Outpost", and the hook appended " | Relay Outpost" again.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/contexts/NotificationContext", () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
import { documentTitleFor } from "./use-document-title";

describe("the tab's title", () => {
  it("adds the app's name once, after the unread count", () => {
    expect(documentTitleFor("Chats", 0)).toBe("Chats | Relay Outpost");
    expect(documentTitleFor("Chats", 3)).toBe("(3) Chats | Relay Outpost");
    expect(documentTitleFor(null, 120)).toBe("(99+) Relay Outpost | Beyond the Algorithm");
  });
  it("does not brand a title that already names the app", () => {
    expect(documentTitleFor("Help & Guides — Relay Outpost", 0)).toBe("Help & Guides — Relay Outpost");
  });
});
