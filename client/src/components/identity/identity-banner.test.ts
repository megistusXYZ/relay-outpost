/**
 * The banner band's dark shading is there for photos: it keeps a busy picture
 * from fighting the name and buttons. On the banner the app draws itself (a
 * pale, quiet drawing in light mode) it only greys it out, so the drawn banner
 * goes unshaded. Real banners keep it.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IdentityBanner } from "./identity-shared";
import { drawnBannerFor } from "@/lib/default-banner";

const KEY = "c4".repeat(32);
const SHADE = "from-black/30";
const band = (props: Parameters<typeof IdentityBanner>[0]) => renderToStaticMarkup(createElement(IdentityBanner, props));

describe("IdentityBanner shading", () => {
  it("shades a real banner photo", () => {
    expect(band({ src: "https://example.com/cover.jpg" })).toContain(SHADE);
  });
  it("leaves the drawn banner unshaded, in light and dark", () => {
    expect(band({ src: drawnBannerFor(KEY, false) })).not.toContain(SHADE);
    expect(band({ src: drawnBannerFor(KEY, true) })).not.toContain(SHADE);
  });
  it("on a phone, keeps the heavy top shade for photos only (the bar's buttons carry their own discs)", () => {
    expect(band({ variant: "hero", src: "https://example.com/cover.jpg" })).toContain("from-black/45");
    expect(band({ variant: "hero", src: drawnBannerFor(KEY, false) })).not.toContain("from-black/45");
  });
  it("still shows the drawn banner itself", () => {
    const src = drawnBannerFor(KEY, false);
    expect(band({ src })).toContain(`src="${src.replace(/&/g, "&amp;")}"`);
  });
});
