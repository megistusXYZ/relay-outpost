/**
 * The outpost hero's pulse obeys the three-outcomes rule: a number renders
 * only when somebody actually measured it. Unreached activity is ABSENT,
 * never zero; an unmeasured member count dashes, never "0 members".
 */
import { describe, it, expect } from "vitest";
import { outpostPresenceProps } from "./outpost-presence";

describe("outpostPresenceProps", () => {
  it("measured values pass through", () => {
    const p = outpostPresenceProps({ membersMeasured: true, membersCount: 42, postsCount: 310, lastActivityMs: 1_700_000_000_000 });
    expect(p).toEqual({ members: 42, posts: 310, lastActiveAt: 1_700_000_000 });
  });

  it("unmeasured members claim nothing — a dash, never a fake zero", () => {
    const p = outpostPresenceProps({ membersMeasured: false, membersCount: 0, postsCount: 5, lastActivityMs: undefined });
    expect(p.members).toBeUndefined();
  });

  it("a real zero is still a zero once measured", () => {
    const p = outpostPresenceProps({ membersMeasured: true, membersCount: 0, postsCount: 0, lastActivityMs: undefined });
    expect(p.members).toBe(0);
    expect(p.posts).toBe(0);
  });

  it("unreached activity is absent — the relay never answered, so no claim", () => {
    const p = outpostPresenceProps({ membersMeasured: true, membersCount: 3, postsCount: 1, lastActivityMs: undefined });
    expect(p.lastActiveAt).toBeUndefined();
  });
});
