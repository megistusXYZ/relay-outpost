// @vitest-environment jsdom
/**
 * Turning Encrypted calls off ends the call you're in (owner, 2026-10-06 —
 * the calls audit). Before, the switch hid the Call button but a call in
 * progress kept going, its floating bar still on screen.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement } from "react";
import { useLeaveWhenCallsOff } from "./calls-off";

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let createRoot: typeof import("react-dom/client").createRoot;
beforeAll(async () => {
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)" });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
});
afterEach(() => { document.body.innerHTML = ""; });

function Probe({ enabled, inCall, leave }: { enabled: boolean; inCall: boolean; leave: () => void }) {
  useLeaveWhenCallsOff(enabled, inCall, leave);
  return null;
}

async function mount() {
  const el = document.createElement("div"); document.body.appendChild(el);
  const root = createRoot(el);
  const render = (p: { enabled: boolean; inCall: boolean; leave: () => void }) => act(() => { root.render(createElement(Probe, p)); });
  return { render, unmount: () => act(() => { root.unmount(); }) };
}

describe("switching Encrypted calls off", () => {
  it("leaves the call you're in, once", async () => {
    const leave = vi.fn();
    const m = await mount();
    await m.render({ enabled: true, inCall: true, leave });
    expect(leave).not.toHaveBeenCalled();
    await m.render({ enabled: false, inCall: true, leave });
    await m.render({ enabled: false, inCall: true, leave });
    expect(leave).toHaveBeenCalledTimes(1);
    await m.unmount();
  });

  it("does nothing when you're not in a call", async () => {
    const leave = vi.fn();
    const m = await mount();
    await m.render({ enabled: true, inCall: false, leave });
    await m.render({ enabled: false, inCall: false, leave });
    expect(leave).not.toHaveBeenCalled();
    await m.unmount();
  });
});
