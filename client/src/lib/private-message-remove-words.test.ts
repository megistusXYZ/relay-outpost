/**
 * A private message can only be removed from this device (owner,
 * 2026-10-11): the other person's copy is theirs, and a sent message's id
 * lives on no relay, so a deletion request would be a no-op. The words say
 * exactly that, and no deletion is sent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.resolve(import.meta.dirname, "../pages/Messages.tsx"), "utf8");

describe("private messages say 'Remove from this device'", () => {
  it("the button, the long-press item and the confirmation use the words", () => {
    expect(src).toMatch(/aria-label="Remove from this device"/);
    expect(src).toContain('"Remove from this device?"');
    expect(src).toContain("The other person keeps their copy.");
    expect(src).not.toMatch(/"Delete message"/);
    expect(src).not.toMatch(/"Delete message\?"/);
  });
  it("removing a message sends no deletion request", () => {
    const handler = src.slice(src.indexOf("const handleDeleteMessage"), src.indexOf("const handleDeleteConversation"));
    expect(handler).not.toMatch(/kind:\s*5/);
    expect(handler).not.toContain("publishEvent(");
  });
});
