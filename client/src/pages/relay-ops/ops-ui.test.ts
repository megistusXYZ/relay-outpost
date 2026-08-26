// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Activity } from "lucide-react";
import { OpsSectionHeader } from "./ops-ui";

// Regression for the operator-console crash (React #31): every lucide-react
// icon is a forwardRef OBJECT, so the old `typeof icon === "function"` check in
// OpsSectionHeader fell through to rendering the icon value directly as a child,
// crashing Overview / Access Control / Announce / Events / Community. A server
// render throws on that bug and succeeds once the component instantiates the
// icon — so this needs no DOM (uses react-dom/server, no JSX for .test.ts).
describe("OpsSectionHeader icon handling (ops console crash regression)", () => {
  it("instantiates a bare lucide (forwardRef) icon instead of rendering it as a child", () => {
    const html = renderToString(createElement(OpsSectionHeader, { icon: Activity, label: "Overview" }));
    expect(html).toContain("<svg");
    expect(html).toContain("Overview");
  });

  it("renders a pre-rendered element icon as-is (Access Control's semantic icons)", () => {
    const html = renderToString(
      createElement(OpsSectionHeader, {
        icon: createElement("span", { "data-role": "pre-rendered" }),
        label: "Access",
      }),
    );
    expect(html).toContain("pre-rendered");
    expect(html).toContain("Access");
  });
});
