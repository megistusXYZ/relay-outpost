import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RelayLogo } from "./RelayLogo";
import { reachState, RelayReachStatus } from "./RelayReachStatus";
import { RELAY_LAP_MS } from "./RelayLoader";

const css = readFileSync(fileURLToPath(new URL("./relay-logo.css", import.meta.url)), "utf8");

describe("RelayLogo", () => {
  it("spells Relay Outpost with the mark standing in for the O", () => {
    const html = renderToStaticMarkup(createElement(RelayLogo, { state: "full" }));
    const letters = [...html.matchAll(/class="rl-l">(.)</g)].map((m) => m[1]).join("");
    expect(letters).toBe("Relayutpost");
    expect(html.indexOf("rl-w a")).toBeLessThan(html.indexOf("rl-m"));
    expect(html.indexOf("rl-m")).toBeLessThan(html.indexOf("rl-w b"));
    expect(html).toContain('aria-label="Relay Outpost"');
  });

  it("lets a screen put its own face in the mark's place, between the two words", () => {
    const own = createElement("svg", { className: "own-face", viewBox: "0 0 100 100" });
    const html = renderToStaticMarkup(createElement(RelayLogo, { state: "full", mark: own }));
    expect(html).toContain('class="own-face"');
    expect(html).not.toContain("rl-ring");
    expect(html.indexOf("rl-w a")).toBeLessThan(html.indexOf("own-face"));
    expect(html.indexOf("own-face")).toBeLessThan(html.indexOf("rl-w b"));
  });

  it("has a style rule for every state and reach value it can be given", () => {
    for (const s of ["relay", "full", "work", "rest", "icon"]) expect(css).toContain(`[data-s=${s}]`);
    for (const r of ["empty", "unreachable", "refused"]) expect(css).toContain(`[data-reach=${r}]`);
  });

  it("is hidden from assistive tech when decorative", () => {
    const html = renderToStaticMarkup(createElement(RelayLogo, { label: "" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
  });

  it("keeps the loader lap in step with the CSS", () => {
    expect(css).toContain(`rl-work ${RELAY_LAP_MS / 1000}s`.replace("0.", "."));
  });

  it("never loops while it rests", () => {
    const rest = [...css.matchAll(/\.rl\[data-s=rest\][^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(rest.length).toBeGreaterThan(0);
    for (const rule of rest) expect(rule).not.toMatch(/infinite/);
  });

  it("holds still for reduced motion", () => {
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{\s*\.rl \*\{animation:none!important;transition:none!important\}/);
  });
});

describe("reachState", () => {
  it("never calls an unreached relay empty", () => {
    expect(reachState({ reached: false }, true)).toBe("unreachable");
  });
  it("never calls a refusal empty", () => {
    expect(reachState({ reached: true, refusedReason: "restricted" }, true)).toBe("refused");
  });
  it("tells empty from data only once the relay answered", () => {
    expect(reachState({ reached: true }, true)).toBe("empty");
    expect(reachState({ reached: true }, false)).toBe("ok");
    expect(reachState(undefined, true)).toBe("connecting");
  });
  it("always carries the sentence, even as an icon", () => {
    const html = renderToStaticMarkup(createElement(RelayReachStatus, { status: "unreachable", compact: true }));
    expect(html).toContain('aria-label="Could not reach this relay"');
    expect(html).toContain('data-reach="unreachable"');
  });
});
