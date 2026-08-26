/**
 * The Chats refresh must not claim "Up to date" when it reached nobody.
 * Reported: offline, the button still showed the green check + "Up to date".
 */
import { describe, it, expect } from "vitest";
import { refreshOutcome } from "./refresh-outcome";

describe("refreshOutcome", () => {
  it("claims up-to-date only when a relay actually answered", () => {
    expect(refreshOutcome(true)).toBe("up-to-date");
  });

  it("says unreachable when no relay was reached — the offline bug", () => {
    expect(refreshOutcome(false)).toBe("unreachable");
  });
});
