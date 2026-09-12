/**
 * Found in the browser (2026-09-12): switching rooms changed the room on
 * screen but not the link, so a reload or a shared link reopened the room you
 * started in. The link now follows the room. These are the rules for the
 * query string; the hook that writes it lives beside them.
 */
import { describe, it, expect } from "vitest";
import { withRoom } from "./room-url";

describe("the room in the link", () => {
  it("opening a room puts it in the link, keeping everything else", () => {
    expect(withRoom("?tab=channels", "abc")).toBe("?tab=channels&channel=abc");
  });

  it("going back to all rooms takes the room out of the link", () => {
    expect(withRoom("?tab=channels&channel=abc", null)).toBe("?tab=channels");
    expect(withRoom("?channel=abc", null)).toBe("");
  });

  it("an invite code belongs to its room: switching rooms drops it, staying keeps it", () => {
    // The code in a shared link joins THAT room; carried onto the next room
    // it would be offered as that room's code.
    expect(withRoom("?tab=channels&channel=a&code=xyz", "b")).toBe("?tab=channels&channel=b");
    expect(withRoom("?channel=a&invite=xyz", "b")).toBe("?channel=b");
    expect(withRoom("?tab=channels&channel=a&code=xyz", "a")).toBe("?tab=channels&channel=a&code=xyz");
  });
});
