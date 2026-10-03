/**
 * Build-time HTML transform: start downloading the page's own code with the
 * HTML, not after the app has run.
 *
 * Every page is a lazy chunk. The browser only learns it needs, say, Home's
 * hundred files once the app's main code has downloaded and run and React
 * has rendered the route: on a throttled phone that was 1.8-2.0 s in, and the
 * page arrived at 3.9 s (measured 2026-10-03). Vite preloads only the entry's
 * own imports.
 *
 * This writes, into index.html, a map from the pages a stranger lands on to
 * the files each needs beyond the entry's, plus a few lines that add
 * <link rel="modulepreload"> for the current path while the HTML is parsed.
 * The map is per build, so it always names that build's files.
 */
export interface PreloadRoute {
  /** "/" matches only itself; "/discover" matches itself and below; "/profile/" is a prefix. */
  path: string;
  exact?: boolean;
  /** The page module, relative to the repo root. */
  module: string;
}

export const PRELOAD_ROUTES: readonly PreloadRoute[] = [
  { path: "/", exact: true, module: "client/src/pages/Home.tsx" },
  { path: "/discover", module: "client/src/pages/Discover.tsx" },
  // News shows the RSS page unless trending was switched on (lib/news-trending.ts).
  { path: "/news", module: "client/src/pages/RSSFeed.tsx" },
  { path: "/profile/", module: "client/src/pages/Profile.tsx" },
];

interface BundleChunk {
  type: "chunk";
  fileName: string;
  facadeModuleId: string | null;
  imports: string[];
  isEntry: boolean;
}
type BundleItem = BundleChunk | { type: "asset"; fileName: string };

function closure(start: string[], byFile: Map<string, BundleChunk>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (f: string) => {
    if (seen.has(f)) return;
    seen.add(f);
    order.push(f);
    for (const i of byFile.get(f)?.imports ?? []) visit(i);
  };
  start.forEach(visit);
  return order;
}

export function routePreloadMap(bundle: Record<string, BundleItem>, routes: readonly PreloadRoute[]): Record<string, string[]> {
  const chunks = Object.values(bundle).filter((b): b is BundleChunk => b.type === "chunk");
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const entryGraph = new Set(closure(chunks.filter((c) => c.isEntry).map((c) => c.fileName), byFile));
  const map: Record<string, string[]> = {};
  for (const r of routes) {
    const page = chunks.find((c) => c.facadeModuleId?.replace(/\\/g, "/").endsWith("/" + r.module));
    if (!page) continue;
    const files = closure([page.fileName], byFile).filter((f) => !entryGraph.has(f));
    if (files.length) map[r.exact ? r.path : r.path] = files;
  }
  return map;
}

/** The inline script: pick the current path's files and preload them. */
export function routePreloadScript(map: Record<string, string[]>): string {
  return (
    "(function(){try{var m=" + JSON.stringify(map) + ";" +
    "var p=location.pathname,l=null;" +
    "if(p==='/')l=m['/'];" +
    "else for(var k in m){if(k==='/')continue;" +
    "if(k.charAt(k.length-1)==='/'?p.indexOf(k)===0:(p===k||p.indexOf(k+'/')===0)){l=m[k];break;}}" +
    "if(!l)return;" +
    "for(var i=0;i<l.length;i++){var e=document.createElement('link');e.rel='modulepreload';e.href='/'+l[i];e.crossOrigin='';document.head.appendChild(e);}" +
    "}catch(_){}})()"
  );
}

/** Put the script ahead of the app's entry script, after Vite's own preloads. */
export function injectRoutePreload(html: string, map: Record<string, string[]>): string {
  if (Object.keys(map).length === 0) return html;
  const tag = `<script>${routePreloadScript(map)}</script>`;
  const entry = html.search(/<script type="module"[^>]*src="\/assets\/index-/);
  if (entry >= 0) return html.slice(0, entry) + tag + html.slice(entry);
  return html.replace("</head>", tag + "</head>");
}
