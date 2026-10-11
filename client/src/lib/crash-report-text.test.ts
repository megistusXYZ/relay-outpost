/**
 * One block an admin can hand to a model (owner, 2026-10-10): the error, how
 * often and where, the stack, the device, the app version, and what to do
 * with it — in plain text, ready to paste. Nothing about the person who hit
 * it beyond what the anonymous report carried.
 */
import { describe, it, expect } from "vitest";
import { crashReportText, crashReportsText } from "./crash-report-text";
import type { FeedbackIssue } from "./nip34-feedback";

const issue = (over: Partial<FeedbackIssue> = {}): FeedbackIssue => ({
  event: { id: "e1", pubkey: "p", kind: 1621, created_at: 1, tags: [["t", "crash"], ["crash-sig", "abc"]], content: "JSON Parse error: Unterminated string\n\nStack:\nparse@[native code]\n_onmessage@https://relayop.xyz/assets/nostr-vendor-B.js:3:124931\n\n- device: Mozilla/5.0 (iPhone)\n\n<!-- context -->\n", sig: "" },
  title: "Uncaught error: JSON Parse error: Unterminated string",
  type: ["bug"],
  status: "open",
  reporter: "p",
  createdAt: 1_791_500_000,
  latestActivityAt: 1_791_500_000,
  contextBlock: { route: "/discover", viewport: "420×844", signerType: "anon", appVersion: "1.18.0 (1.18.0)" } as FeedbackIssue["contextBlock"],
  comments: [],
  statusChanges: [],
  ...over,
} as FeedbackIssue);

describe("one error, as text for a model", () => {
  const text = crashReportText(issue(), { sig: "abc", count: 3, latest: issue(), route: "/discover" });
  it("leads with what it is and asks for the cause, not just a patch", () => {
    expect(text.split("\n")[0]).toMatch(/^# Relay Outpost app error/);
    expect(text).toMatch(/find the cause/i);
  });
  it("carries the facts: how often, where, the version, the device, the stack", () => {
    expect(text).toContain("Happened 3 times");
    expect(text).toContain("/discover");
    expect(text).toContain("1.18.0");
    expect(text).toContain("iPhone");
    expect(text).toContain("_onmessage@");
    expect(text).toContain("Signed in with: anon");
  });
  it("names the repository so the reader knows where the code is", () => {
    expect(text).toContain("github.com/megistusXYZ/relay-outpost");
  });
  it("stands alone without a group", () => {
    expect(crashReportText(issue())).toContain("Happened 1 time");
  });
});

describe("all open errors at once", () => {
  it("joins them with a divider, numbered, under one heading", () => {
    const text = crashReportsText([
      { issue: issue(), group: { sig: "abc", count: 2, latest: issue(), route: "/discover" } },
      { issue: issue({ title: "Crash: Minified React error #300" }), group: { sig: "def", count: 1, latest: issue(), route: "/help" } },
    ]);
    expect(text).toMatch(/^# Relay Outpost app errors \(2\)/);
    expect(text).toContain("## 1. Uncaught error");
    expect(text).toContain("## 2. Crash: Minified React error #300");
  });
});
