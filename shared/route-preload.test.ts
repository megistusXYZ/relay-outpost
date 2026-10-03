import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { routePreloadMap, routePreloadScript, injectRoutePreload, PRELOAD_ROUTES } from "./route-preload";

const chunk = (fileName: string, facade: string | null, imports: string[], isEntry = false) =>
  ({ type: "chunk" as const, fileName, facadeModuleId: facade, imports, isEntry });

// A tiny build: the entry pulls react + nostr; Home pulls NostrPost + nostr (already in the entry's graph) + a shared helper.
const BUNDLE = {
  "assets/index-a.js": chunk("assets/index-a.js", "/x/client/src/main.tsx", ["assets/react-vendor-b.js", "assets/nostr-vendor-c.js"], true),
  "assets/react-vendor-b.js": chunk("assets/react-vendor-b.js", null, []),
  "assets/nostr-vendor-c.js": chunk("assets/nostr-vendor-c.js", null, ["assets/react-vendor-b.js"]),
  "assets/Home-d.js": chunk("assets/Home-d.js", "/x/client/src/pages/Home.tsx", ["assets/NostrPost-e.js", "assets/nostr-vendor-c.js"]),
  "assets/NostrPost-e.js": chunk("assets/NostrPost-e.js", "/x/client/src/components/NostrPost.tsx", ["assets/helper-f.js"]),
  "assets/helper-f.js": chunk("assets/helper-f.js", null, []),
  "assets/Discover-g.js": chunk("assets/Discover-g.js", "/x/client/src/pages/Discover.tsx", ["assets/helper-f.js"]),
  "assets/index-a.css": { type: "asset" as const, fileName: "assets/index-a.css" },
};

describe("which files a page needs beyond the app's own", () => {
  it("is the page's chunk and everything it imports, minus what the entry already loads", () => {
    const map = routePreloadMap(BUNDLE, [{ path: "/", exact: true, module: "client/src/pages/Home.tsx" }]);
    expect(map["/"]).toEqual(["assets/Home-d.js", "assets/NostrPost-e.js", "assets/helper-f.js"]);
  });

  it("leaves out a route whose page isn't in the build", () => {
    const map = routePreloadMap(BUNDLE, [{ path: "/gone", module: "client/src/pages/Gone.tsx" }]);
    expect(map).toEqual({});
  });

  it("covers the pages a stranger lands on", () => {
    expect(PRELOAD_ROUTES.map((r) => r.path)).toEqual(["/", "/discover", "/news", "/profile/"]);
  });
});

describe("the inline script", () => {
  const run = (pathname: string, map: Record<string, string[]>) => {
    const links: { rel: string; href: string; crossOrigin: string | null }[] = [];
    const document = {
      createElement: () => ({ rel: "", href: "", crossOrigin: null as string | null }),
      head: { appendChild: (l: any) => links.push(l) },
    };
    vm.runInNewContext(routePreloadScript(map), { location: { pathname }, document });
    return links.map((l) => l.href);
  };
  const map = { "/": ["assets/Home-d.js"], "/discover": ["assets/Discover-g.js"], "/profile/": ["assets/Profile-h.js"] };

  it("preloads the landing page's files on /", () => {
    expect(run("/", map)).toEqual(["/assets/Home-d.js"]);
  });
  it("matches a page and its sub-paths, and a prefix route like /profile/", () => {
    expect(run("/discover", map)).toEqual(["/assets/Discover-g.js"]);
    expect(run("/discover/videos", map)).toEqual(["/assets/Discover-g.js"]);
    expect(run("/profile/npub1abc", map)).toEqual(["/assets/Profile-h.js"]);
  });
  it("preloads nothing elsewhere — / is exact, not a prefix of every path", () => {
    expect(run("/messages", map)).toEqual([]);
    expect(run("/discoverable", map)).toEqual([]);
  });
});

describe("the HTML", () => {
  it("gets the script ahead of the app's entry script", () => {
    const html = '<head><link rel="modulepreload" crossorigin href="/assets/react-vendor-b.js"><script type="module" crossorigin src="/assets/index-a.js"></script></head>';
    const out = injectRoutePreload(html, { "/": ["assets/Home-d.js"] });
    expect(out.indexOf("modulepreload")).toBeLessThan(out.indexOf("Home-d.js"));
    expect(out.indexOf("Home-d.js")).toBeLessThan(out.indexOf('src="/assets/index-a.js"'));
  });
  it("is left alone when there is nothing to preload", () => {
    const html = "<head></head>";
    expect(injectRoutePreload(html, {})).toBe(html);
  });
});
