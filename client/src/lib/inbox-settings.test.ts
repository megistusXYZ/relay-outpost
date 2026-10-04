import { describe, it, expect } from "vitest";
import { readInboxSettings, writeInboxSettings, templateLabelFor, STARTER_TEMPLATES, type TicketTemplate } from "./inbox-settings";

const OP = "a".repeat(64);
const repo = (tags: string[][], at = 1000) => ({ kind: 30617, pubkey: OP, created_at: at, content: "", tags: [["d", "feedback-harbour.example"], ["name", "Harbour Club feedback"], ["t", "feedback"], ...tags] });

describe("reading a community's inbox settings from its feedback listing", () => {
  it("no listing: off, with the starter templates ready", () => {
    expect(readInboxSettings(null)).toEqual({ exists: false, on: false, templates: STARTER_TEMPLATES });
  });

  it("a listing without settings (made before this): on, starters", () => {
    expect(readInboxSettings(repo([]))).toEqual({ exists: true, on: true, templates: STARTER_TEMPLATES });
  });

  it("switched off says so; templates come back in order, as the operator wrote them", () => {
    const s = readInboxSettings(repo([
      ["inbox", "off"],
      ["template", "help", "Ask for help", "What do you need?", "private", "question", "on"],
      ["template", "merch", "Order merch", "Size and colour?", "private", "question", "off"],
    ]));
    expect(s.on).toBe(false);
    expect(s.templates).toEqual([
      { id: "help", label: "Ask for help", prompt: "What do you need?", visibility: "private", kind: "question", enabled: true },
      { id: "merch", label: "Order merch", prompt: "Size and colour?", visibility: "private", kind: "question", enabled: false },
    ]);
  });

  it("odd values are read safely: unknown kind → question, unknown visibility → private, blank labels dropped", () => {
    const s = readInboxSettings(repo([["template", "x", "Hi", "", "loud", "rant", "on"], ["template", "y", "  ", "p", "public", "bug", "on"]]));
    expect(s.templates).toEqual([{ id: "x", label: "Hi", prompt: "", visibility: "private", kind: "question", enabled: true }]);
  });

  it("the starters", () => {
    expect(STARTER_TEMPLATES.map((t: TicketTemplate) => `${t.label} · ${t.visibility}`)).toEqual([
      "Ask for help · private", "Report a problem · private", "Suggest something · public", "Request access or a role · private",
    ]);
  });
});

describe("writing them back", () => {
  const base = { d: "feedback-harbour.example", name: "Harbour Club feedback", description: "Feedback inbox for Harbour Club", relay: "wss://harbour.example" };

  it("keeps every other tag (other apps' too), replaces the settings, keeps the content", () => {
    const existing = { ...repo([["web", "https://harbour.example"], ["maintainers", "b".repeat(64)], ["inbox", "on"], ["template", "old", "Old", "", "private", "bug", "on"]]), content: "notes" };
    const next = writeInboxSettings(existing, { on: false, templates: [STARTER_TEMPLATES[0]] }, base);
    expect(next.kind).toBe(30617);
    expect(next.content).toBe("notes");
    expect(next.tags).toEqual([
      ["d", "feedback-harbour.example"], ["name", "Harbour Club feedback"], ["t", "feedback"],
      ["web", "https://harbour.example"], ["maintainers", "b".repeat(64)],
      ["inbox", "off"],
      ["template", "help", "Ask for help", "What do you need help with?", "private", "question", "on"],
    ]);
  });

  it("switching off never deletes: the listing stays, saying off", () => {
    const next = writeInboxSettings(repo([]), { on: false, templates: [] }, base);
    expect(next.tags).toContainEqual(["inbox", "off"]);
    expect(next.tags).toContainEqual(["d", "feedback-harbour.example"]);
  });

  it("no listing yet: a new one, with the settings", () => {
    const next = writeInboxSettings(null, { on: true, templates: STARTER_TEMPLATES }, base);
    const read = readInboxSettings(next);
    expect(read).toEqual({ exists: true, on: true, templates: STARTER_TEMPLATES });
    expect(next.tags).toContainEqual(["d", "feedback-harbour.example"]);
    expect(next.tags).toContainEqual(["t", "feedback"]);
  });
});

describe("a ticket remembers which request type it came from", () => {
  it("the operator sees the type's name; an unknown or missing one falls back", () => {
    const templates = [STARTER_TEMPLATES[0], { ...STARTER_TEMPLATES[3], label: "Ask for a role" }];
    expect(templateLabelFor({ tags: [["template", "access"]] }, templates)).toBe("Ask for a role");
    expect(templateLabelFor({ tags: [["template", "gone"]] }, templates)).toBeNull();
    expect(templateLabelFor({ tags: [] }, templates)).toBeNull();
    expect(templateLabelFor({ tags: [["template", "help"]] }, undefined)).toBeNull();
  });
});
