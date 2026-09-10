// @vitest-environment jsdom
/**
 * A toast raised from inside a drawer, sheet or dialog lives outside it in
 * the DOM, so tapping the toast's Undo counted as a tap outside and dismissed
 * the surface under it (News Sources drawer, 2026-09-10: remove a source, tap
 * Undo, and the drawer slammed shut). Taps on a toast aren't "outside".
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

let ignoreToastInteraction: typeof import("./toast").ignoreToastInteraction;

beforeAll(async () => {
  // react-dom (via Radix) reads navigator on import; test:ci-globals deletes it.
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)" });
  ({ ignoreToastInteraction } = await import("./toast"));
});

function outsideEvent(target: Element) {
  return { target, preventDefault: vi.fn() };
}

describe("ignoreToastInteraction — tapping a toast never dismisses the sheet under it", () => {
  it("keeps the surface open for a tap on a toast, and still runs the surface's own handler", () => {
    const viewport = document.createElement("ol");
    viewport.setAttribute("data-toast-viewport", "");
    const undo = document.createElement("button");
    viewport.appendChild(undo);
    document.body.appendChild(viewport);
    const own = vi.fn();

    const event = outsideEvent(undo);
    ignoreToastInteraction(own)(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(own).toHaveBeenCalledWith(event);
  });

  it("lets a real tap outside dismiss as before", () => {
    const page = document.createElement("div");
    document.body.appendChild(page);

    const event = outsideEvent(page);
    ignoreToastInteraction()(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
