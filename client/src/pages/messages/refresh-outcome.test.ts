/**
 * The Chats refresh must not claim "Up to date" when it reached nobody.
 * Reported: offline, the button still showed the green check + "Up to date".
 */
import { describe, it, expect } from "vitest";
import { refreshOutcome, emptyChatsWords } from "./refresh-outcome";

describe("refreshOutcome", () => {
  it("claims up-to-date only when a relay actually answered", () => {
    expect(refreshOutcome(true)).toBe("up-to-date");
  });

  it("says unreachable when no relay was reached — the offline bug", () => {
    expect(refreshOutcome(false)).toBe("unreachable");
  });
});

describe("what an empty Chats list may say", () => {
  // 2026-10-10: "No conversations yet" showed at 3:21 while the first message
  // arrived at 3:30. The list had not heard from a relay; it said it had.
  it("'checking' until a relay has answered, and while still loading", () => {
    expect(emptyChatsWords({ loading: true, inboxAnswered: null })).toBe("checking");
    expect(emptyChatsWords({ loading: false, inboxAnswered: null })).toBe("checking");
    expect(emptyChatsWords({ loading: true, inboxAnswered: true })).toBe("checking");
  });
  it("'none' only after a relay answered with nothing", () => {
    expect(emptyChatsWords({ loading: false, inboxAnswered: true })).toBe("none");
  });
  it("'unreachable' when we asked and nobody answered", () => {
    expect(emptyChatsWords({ loading: false, inboxAnswered: false })).toBe("unreachable");
  });
});
