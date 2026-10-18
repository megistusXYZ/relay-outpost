/**
 * The signup draft (lib/account-draft.ts) offers "Resume signup" only when
 * the person did something. Since 2026-10-17 the first step arrives with a
 * name, photo and banner already chosen, so those chosen-for-you values alone
 * are not work to resume: opening the page and leaving must not leave a
 * "Resume signup as Quiet Otter" chip behind.
 */
import { describe, it, expect } from "vitest";
import { draftHasResumableContent } from "./account-draft";

describe("draftHasResumableContent", () => {
  it("a draft holding only what was chosen for them is nothing to resume", () => {
    expect(draftHasResumableContent({ displayName: "Quiet Otter", suggestedName: "Quiet Otter", avatarSeed: 12, bannerIndex: 2 })).toBe(false);
  });

  it("a name they typed is something to resume", () => {
    expect(draftHasResumableContent({ displayName: "Mara", suggestedName: "Quiet Otter" })).toBe(true);
  });

  it("a key made for an upload is still something to resume", () => {
    expect(draftHasResumableContent({ displayName: "Quiet Otter", suggestedName: "Quiet Otter", account: { secretKeyHex: "ab", pubkey: "p", npub: "n" } })).toBe(true);
  });

  it("other fields still count as before", () => {
    expect(draftHasResumableContent({ bio: "hello" })).toBe(true);
    expect(draftHasResumableContent({})).toBe(false);
  });
});
