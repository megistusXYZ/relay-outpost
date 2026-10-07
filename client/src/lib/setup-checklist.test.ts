import { describe, it, expect } from "vitest";
import { setupChecklist, type SetupFacts } from "./setup-checklist";

// The setup checklist on Overview (owner, 2026-10-04): each item ticks itself
// off only when it's true on the relay — not when something was clicked.
const none: SetupFacts = { name: false, picture: false, description: false, rules: false, whoCanPostConfirmed: false, teammates: 0, justMe: false, inboxOn: false, badges: 0, shared: false };

describe("setupChecklist", () => {
  it("lists seven things, in the order a new community gets set up", () => {
    expect(setupChecklist(none).items.map((i) => i.id)).toEqual(["identity", "about", "who-can-post", "team", "inbox", "badge", "share"]);
    expect(setupChecklist(none).done).toBe(0);
    expect(setupChecklist(none).complete).toBe(false);
  });
  it("name AND picture, description AND rules — half doesn't count", () => {
    const c = setupChecklist({ ...none, name: true, description: true });
    expect(c.items.find((i) => i.id === "identity")?.done).toBe(false);
    expect(c.items.find((i) => i.id === "about")?.done).toBe(false);
    const d = setupChecklist({ ...none, name: true, picture: true, description: true, rules: true });
    expect(d.done).toBe(2);
  });
  it("a team is a teammate, or saying it's just you", () => {
    expect(setupChecklist({ ...none, teammates: 1 }).items.find((i) => i.id === "team")?.done).toBe(true);
    expect(setupChecklist({ ...none, justMe: true }).items.find((i) => i.id === "team")?.done).toBe(true);
  });
  it("all seven: complete", () => {
    const all = setupChecklist({ name: true, picture: true, description: true, rules: true, whoCanPostConfirmed: true, teammates: 0, justMe: true, inboxOn: true, badges: 1, shared: true });
    expect(all.done).toBe(7);
    expect(all.complete).toBe(true);
  });
  it("each item says where to do it", () => {
    expect(setupChecklist(none).items.map((i) => i.go)).toEqual(["community", "community", "access", "team", "contact", "badges", null]);
  });
  // Badges, step 4 (owner 2026-10-06, badges-plan): a nudge, never an
  // automatic badge — ticks itself once the community really has one.
  it("'Make your first badge' is done once the community has a badge", () => {
    const item = (b: number) => setupChecklist({ ...none, badges: b }).items.find((i) => i.id === "badge");
    expect(item(0)?.done).toBe(false);
    expect(item(0)?.label).toBe("Make your first badge");
    expect(item(2)?.done).toBe(true);
  });
});
