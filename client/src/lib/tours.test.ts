/**
 * The quick tours (owner, 2026-10-10). Before this, four steps pointed at
 * controls that no longer existed and vanished silently, so the Home tour
 * said "four short stops" and showed three; no tour existed for Chats, where
 * a new account lands; and the words were mission control's.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TOURS, TOUR_ORDER, playableSteps, fillStepCount, stepCounter, nextTour, toursDone } from "./tours";

const SRC = join(process.cwd(), "client", "src");
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}
const APP_SOURCE = tsxFiles(SRC).map((f) => readFileSync(f, "utf8")).join("\n");

describe("every tour step points at a control that exists", () => {
  // A step whose control is gone is dropped at run time with nothing said —
  // that is how "four short stops" became three. Pin each anchor to the source.
  for (const id of TOUR_ORDER) {
    for (const step of TOURS[id].steps) {
      if (step.testId === null) continue;
      it(`${id}: "${step.title}" → ${step.testId}`, () => {
        const anchored = APP_SOURCE.includes(`data-testid="${step.testId}"`) || APP_SOURCE.includes(`testId="${step.testId}"`);
        expect(anchored).toBe(true);
      });
    }
  }
});

describe("a tour never promises more steps than it shows", () => {
  it("drops the steps whose control isn't on the page, keeps the ones about the page", () => {
    const steps = TOURS.home.steps;
    const desktop = playableSteps(steps, (id) => id === "button-fab-compose");
    expect(desktop.map((s) => s.testId)).toEqual([null, null, "button-fab-compose"]);
    const phone = playableSteps(steps, (id) => id === "mobile-nav-create");
    expect(phone.map((s) => s.testId)).toEqual([null, null, "mobile-nav-create"]);
  });
  it("fills the intro with the count that will play", () => {
    expect(fillStepCount("A quick tour, {steps} short steps.", 3)).toBe("A quick tour, 3 short steps.");
    expect(stepCounter(0, 3)).toBe("Step 1 of 3");
  });
  it("no intro hard-codes a number of steps", () => {
    for (const id of TOUR_ORDER) {
      expect(TOURS[id].steps[0].body).toMatch(/\{steps\}/);
      expect(TOURS[id].steps[0].body).not.toMatch(/\b(two|three|four|five|six) (short )?(steps|stops)\b/i);
    }
  });
});

describe("the order and the words", () => {
  it("starts where a new account lands: Chats", () => {
    expect(TOUR_ORDER[0]).toBe("chats");
  });
  it("hands off to the next unseen tour, and counts the current one as done", () => {
    expect(nextTour("chats", () => false)).toBe("home");
    expect(nextTour("chats", (t) => t === "home")).toBe("communities");
    expect(nextTour("live", (t) => t !== "live")).toBeNull();
    expect(toursDone("chats", (t) => t === "home")).toBe(2);
  });
  it("speaks to people, not operators", () => {
    const text = TOUR_ORDER.flatMap((id) => TOURS[id].steps.map((s) => `${TOURS[id].label} ${s.title} ${s.body}`)).join("\n");
    expect(text).not.toMatch(/mission|orientation|plumbing|firehose|\bstops?\b|home base|crew|NIP-?\d|npub|nsec|relay list|outbox|signed with your (own )?key/i);
  });
  it("tells a new account about its space, its key, and that private chats are encrypted", () => {
    const text = TOUR_ORDER.flatMap((id) => TOURS[id].steps.map((s) => s.body)).join("\n");
    expect(text).toMatch(/wider network/);
    expect(text).toMatch(/your key/i);
    expect(text).toMatch(/end-to-end encrypted/);
  });
});
