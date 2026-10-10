/**
 * Resume should resume (owner, 2026-10-10, from the first-use review). The
 * "Resume signup as HyperCool" pill used to land on the generic Create /
 * Use existing account fork, where "Use existing account" read as the right
 * choice and was wrong (it means a key from another app). And a reload after
 * "Save password & continue" opened the unlock screen for an account whose
 * sign-up never finished. The pure rule here says where a visit starts and
 * which sign-up step a draft resumes at.
 */
import { describe, it, expect } from "vitest";
import { initialLoginMode, resumeStep } from "./login-mode";

const PK = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("where a visit to the sign-in screen starts", () => {
  it("a fresh visit starts at the choice", () => {
    expect(initialLoginMode({ addAccountPending: false, localAccountPubkey: null, signupDraft: null, importDraft: false })).toBe("select");
  });
  it("a sign-up in flight resumes the sign-up — not the fork", () => {
    expect(initialLoginMode({ addAccountPending: false, localAccountPubkey: null, signupDraft: { resumable: true, pubkey: PK }, importDraft: false })).toBe("create");
  });
  it("a reload after the password was saved resumes the sign-up too: the stored account is the draft's", () => {
    expect(initialLoginMode({ addAccountPending: false, localAccountPubkey: PK, signupDraft: { resumable: true, pubkey: PK }, importDraft: false })).toBe("create");
  });
  it("a finished account unlocks, and a stale draft for a different key does not hijack it", () => {
    expect(initialLoginMode({ addAccountPending: false, localAccountPubkey: PK, signupDraft: null, importDraft: false })).toBe("unlock");
    expect(initialLoginMode({ addAccountPending: false, localAccountPubkey: PK, signupDraft: { resumable: true, pubkey: OTHER }, importDraft: false })).toBe("unlock");
  });
  it("an empty draft is no draft", () => {
    expect(initialLoginMode({ addAccountPending: false, localAccountPubkey: null, signupDraft: { resumable: false, pubkey: null }, importDraft: true })).toBe("import");
  });
  it("adding an account always starts at the choice", () => {
    expect(initialLoginMode({ addAccountPending: true, localAccountPubkey: PK, signupDraft: { resumable: true, pubkey: PK }, importDraft: false })).toBe("select");
  });
});

describe("which step a draft resumes at", () => {
  it("the profile step, when no password was saved yet", () => {
    expect(resumeStep({ draftPubkey: PK, storedPubkey: null })).toBe(1);
    expect(resumeStep({ draftPubkey: null, storedPubkey: null })).toBe(1);
  });
  it("the save-your-key step, when this draft's key is already stored under a password", () => {
    expect(resumeStep({ draftPubkey: PK, storedPubkey: PK })).toBe(2);
  });
  it("never trusts a stored account for a different key", () => {
    expect(resumeStep({ draftPubkey: PK, storedPubkey: OTHER })).toBe(1);
  });
});
