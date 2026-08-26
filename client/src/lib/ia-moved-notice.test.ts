import { describe, it, expect } from "vitest";
import { iaMovedNoticeKey, shouldShowIaMovedNotice } from "./ia-moved-notice";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("iaMovedNoticeKey — per account, never device-wide", () => {
  it("is null for a signed-out visitor", () => {
    // Nothing moved for someone who was never here.
    expect(iaMovedNoticeKey(null)).toBeNull();
    expect(iaMovedNoticeKey(undefined)).toBeNull();
    expect(iaMovedNoticeKey("")).toBeNull();
  });

  it("gives two accounts two keys", () => {
    // Two people share a browser and have two sets of muscle memory:
    // dismissing for one must not hide it from the other.
    expect(iaMovedNoticeKey(A)).not.toBe(iaMovedNoticeKey(B));
  });

  it("is stable for the same account", () => {
    expect(iaMovedNoticeKey(A)).toBe(iaMovedNoticeKey(A));
  });
});

describe("shouldShowIaMovedNotice", () => {
  it("shows once to a signed-in person whose nav has collapsed", () => {
    expect(shouldShowIaMovedNotice({ pubkey: A, collapsed: true, stored: null })).toBe(true);
  });

  it("stays quiet after it has been dismissed", () => {
    expect(shouldShowIaMovedNotice({ pubkey: A, collapsed: true, stored: "1" })).toBe(false);
  });

  it("never explains a change that hasn't happened", () => {
    // The flag is still off: the nav this notice describes is not the nav on
    // screen, so the line would be actively misleading.
    expect(shouldShowIaMovedNotice({ pubkey: A, collapsed: false, stored: null })).toBe(false);
  });

  it("says nothing to a signed-out visitor", () => {
    expect(shouldShowIaMovedNotice({ pubkey: null, collapsed: true, stored: null })).toBe(false);
  });

  it("treats a junk stored value as not-yet-seen", () => {
    // Fails toward showing it: a duplicate explanation is a smaller harm than
    // a silent disappearance.
    for (const junk of ["", "0", "true", "yes", "{}"]) {
      expect(
        shouldShowIaMovedNotice({ pubkey: A, collapsed: true, stored: junk }),
        `junk value ${JSON.stringify(junk)}`,
      ).toBe(true);
    }
  });

  it("is independent per account", () => {
    // A dismissed it; B signs in on the same browser and still gets told.
    expect(shouldShowIaMovedNotice({ pubkey: A, collapsed: true, stored: "1" })).toBe(false);
    expect(shouldShowIaMovedNotice({ pubkey: B, collapsed: true, stored: null })).toBe(true);
  });
});
