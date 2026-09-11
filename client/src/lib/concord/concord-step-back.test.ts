/**
 * The owner can step back without ending the group. Ownership can't move (the
 * group's identity is the owner's key, CORD-02), so an owner who leaves stays
 * its owner and can come back with an invite; the group keeps running under its
 * admins. The confirm says exactly that, and warns when nobody else can manage it.
 */
import { describe, it, expect } from "vitest";
import { leaveCopy } from "./concord-step-back";

describe("what leaving says", () => {
  it("a member's leave reads as it always has", () => {
    expect(leaveCopy({ isOwner: false })).toEqual({
      title: "Leave this group chat?",
      body: "You'll be removed from the roster and it'll disappear from your devices. You can rejoin later with a new invite.",
      confirm: "Leave",
      done: "Left group chat",
    });
  });

  it("an owner steps back: the group goes on, they stay its owner, deleting is the other door", () => {
    const copy = leaveCopy({ isOwner: true, otherStaff: 2 });
    expect(copy.title).toBe("Step back from this group chat?");
    expect(copy.body).toMatch(/keeps going/);
    expect(copy.body).toMatch(/admins run it/);
    expect(copy.body).toMatch(/stay its owner/);
    expect(copy.body).toMatch(/delete it instead/);
    expect(copy.body).not.toMatch(/No one else can manage/);
    expect(copy.confirm).toBe("Step back");
    expect(copy.done).toBe("Stepped back");
  });

  it("warns when nobody else can manage it", () => {
    const copy = leaveCopy({ isOwner: true, otherStaff: 0 });
    expect(copy.body).toMatch(/No one else can manage it/);
    expect(copy.body).toMatch(/make someone an admin first/i);
    expect(copy.confirm).toBe("Step back anyway");
  });

  it("claims nothing about admins it can't count", () => {
    const copy = leaveCopy({ isOwner: true });
    expect(copy.body).not.toMatch(/admins run it/);
    expect(copy.body).not.toMatch(/No one else can manage/);
    expect(copy.body).toMatch(/stay its owner/);
    expect(copy.confirm).toBe("Step back");
  });
});
