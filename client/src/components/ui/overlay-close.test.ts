// @vitest-environment jsdom
/**
 * The close button on a dialog or sheet has to be findable on top of whatever
 * the dialog shows.
 *
 * Reported 2026-09-10 with a screenshot: over an image the X could not be
 * seen. It was a bare 16px icon at 70% opacity in the text colour, so it
 * vanished into any photo with a similar tone, and its tap target was 16px.
 * The fix sits the icon on its own chip: a dark translucent fill (contrast on
 * light images) with a light hairline ring and a white icon (contrast on dark
 * ones), inside a 44px tap target.
 *
 * jsdom has no CSS, so the contract is the classes that produce it. The close
 * must also stay the content's LAST child button: ZapDialog hides it with
 * `[&>button:last-child]:hidden`.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let createRoot: typeof import("react-dom/client").createRoot;
let ui: typeof import("./dialog") & typeof import("./sheet");
let root: ReturnType<typeof import("react-dom/client").createRoot> | null = null;

beforeAll(async () => {
  // react-dom reads navigator on import; test:ci-globals deletes it.
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)" });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
  ui = { ...(await import("./dialog")), ...(await import("./sheet")) };
});

afterEach(async () => {
  if (root) await act(() => { root!.unmount(); });
  root = null;
  document.body.innerHTML = "";
});

async function mount(el: ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(() => { root!.render(el); });
}

function closeButton(): HTMLButtonElement {
  const label = [...document.querySelectorAll("button .sr-only")].find((s) => s.textContent === "Close");
  const button = label?.closest("button");
  if (!button) throw new Error("no close button rendered");
  return button;
}

function expectVisibleOnAnyBackground(button: HTMLButtonElement) {
  expect(button.className).toMatch(/\bh-11\b/);
  expect(button.className).toMatch(/\bw-11\b/);
  expect(button.className).not.toMatch(/\bopacity-70\b/);
  const chip = button.querySelector("[data-close-chip]");
  expect(chip).not.toBeNull();
  expect(chip!.className).toMatch(/\bbg-black\/\d+/);
  expect(chip!.className).toMatch(/\bring-white\/\d+/);
  expect(chip!.className).toMatch(/\btext-white\b/);
  expect(button.parentElement!.lastElementChild).toBe(button);
}

const photo = createElement("img", { src: "https://example.com/photo.jpg", alt: "" });

describe("overlay close button", () => {
  it("on a dialog, sits on a contrast chip with a 44px tap target", async () => {
    await mount(createElement(ui.Dialog, { open: true },
      createElement(ui.DialogContent, null, createElement(ui.DialogTitle, null, "Photo"), photo)));
    expectVisibleOnAnyBackground(closeButton());
  });

  it("on a sheet, sits on the same chip", async () => {
    await mount(createElement(ui.Sheet, { open: true },
      createElement(ui.SheetContent, null, createElement(ui.SheetTitle, null, "Photo"), photo)));
    expectVisibleOnAnyBackground(closeButton());
  });
});
