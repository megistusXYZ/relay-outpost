/**
 * The tab's title names the app once. Guide pages pass titles that already
 * carry "— Relay Outpost", and the hook appended " | Relay Outpost" again.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
vi.mock("@/contexts/NotificationContext", () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
import { documentTitleFor } from "./use-document-title";

describe("the tab's title", () => {
  it("adds the app's name once, after the unread count", () => {
    expect(documentTitleFor("Chats", 0)).toBe("Chats | Relay Outpost");
    expect(documentTitleFor("Chats", 3)).toBe("(3) Chats | Relay Outpost");
    expect(documentTitleFor(null, 120)).toBe("(99+) Relay Outpost: the next phase of the internet");
  });
  it("does not brand a title that already names the app", () => {
    expect(documentTitleFor("Help & guides — Relay Outpost", 0)).toBe("Help & guides — Relay Outpost");
  });
  // Leaving a page that names itself used to drop the tab back to an older tagline
  // ("Beyond the Algorithm") that nothing else on the site still said.
  it("with no page title, says what the page's own <title> says", () => {
    const shell = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
    const title = shell.match(/<title>([^<]*)<\/title>/)![1];
    expect(title).toBe("Relay Outpost: the next phase of the internet");
    expect(documentTitleFor(undefined, 0)).toBe(title);
    expect(documentTitleFor("", 0)).toBe(title);
  });
});
