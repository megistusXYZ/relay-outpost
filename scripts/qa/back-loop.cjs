// Back-navigation loop: does the page move under the reader after Back?
//
// Opens a page at phone width, scrolls down, lets it settle, taps a post to
// open its thread, goes back, and measures every frame for 3 s: the painted
// position of the row the reader was on (read after each frame paints),
// scrollTop writes, layout shifts and their sources, the held padding, and
// which elements above the first row changed height. Chromium's scroll
// anchoring is turned off so it behaves like WebKit (iOS has none).
//
// Needs the dev server (npm run dev, :5002). Run with Playwright's Chromium:
//   npx -p playwright node scripts/qa/back-loop.cjs /profile/<npub> --iphone --login <hexpubkey>
//   (first time: npx playwright install chromium)
// --login sets a signer-less harness session on the LOCAL origin only.
// --iphone uses an iPhone UA (the plain-list path); without it the profile
// uses VirtualFeed (Android/desktop). --scroll <px> --nth <post to tap>.
//
// Read: "PAINTED anchor moves" is the reader's row moving on screen — the bug.
// Measured 2026-09-30 before the hold: 79px and 149px jumps on a profile;
// after: at most 1px.
const { chromium } = require("playwright");
const args = process.argv.slice(2);
const path = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const login = opt("--login", null);
const scrollPx = Number(opt("--scroll", 1400));
const nth = Number(opt("--nth", 2));
const base = "http://127.0.0.1:5002";

(async () => {
  const browser = await chromium.launch();
  const iphone = args.includes("--iphone");
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, ...(iphone ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1" } : {}) });
  const page = await ctx.newPage();
  await page.addInitScript((login) => {
    try {
      localStorage.setItem("debug-scroll-restore", "1"); sessionStorage.setItem("ro_ia_landed", "1");
      if (login) { localStorage.setItem("relay-outpost-login-method", "extension"); localStorage.setItem("relay-outpost-pubkey", login); }
    } catch {}
    // WebKit has no scroll anchoring; make Chromium match.
    const s = document.createElement("style"); s.textContent = "* { overflow-anchor: none !important }";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(s));
    window.__shifts = [];
    // The element that really scrolls: Profile nests its own scroller inside <main>.
    window.__sc = () => { const c = [document.querySelector('[data-testid="page-profile"]'), document.querySelector("main")].filter(Boolean); return c.find((e) => e.scrollHeight > e.clientHeight + 10) || c[c.length - 1]; };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), src: (e.sources || []).slice(0, 3).map((x) => { const n = x.node; if (!n || !n.closest) return "?"; const row = n.closest("[data-event-id]"); const el = n.nodeType === 1 ? n : n.parentElement; return (row ? row.dataset.eventId.slice(0, 8) + "/" : "") + (el.tagName.toLowerCase()) + "[" + ((el.closest("[data-testid]")?.dataset.testid || "").replace(/-[0-9a-f]{8,}.*$/, "") || String(el.className).slice(0, 40)) + "]" + " y" + Math.round(x.previousRect.y) + "→" + Math.round(x.currentRect.y); }) }); }).observe({ type: "layout-shift", buffered: true }); } catch {}
  }, login);
  const logs = [];
  page.on("console", (m) => { if (m.text().startsWith("[scroll-restore]")) logs.push(`${Date.now() - T0}ms ${m.text()}`); });
  const T0 = Date.now();
  await page.goto(base + path, { waitUntil: "commit" });
  await page.waitForSelector("main [data-event-id]", { timeout: 30000 });
  await page.waitForTimeout(4000);
  // Scroll down, let images settle.
  await page.evaluate((px) => { window.__sc().scrollTop = px; }, scrollPx);
  await page.waitForTimeout(4000);
  const before = await page.evaluate(() => {
    const main = window.__sc(); const mt = main.getBoundingClientRect().top;
    const rows = [...main.querySelectorAll("[data-event-id]")].filter((r) => !r.closest("[inert]"));
    const vis = rows.map((r) => ({ id: r.dataset.eventId, top: Math.round(r.getBoundingClientRect().top - mt), h: Math.round(r.getBoundingClientRect().height), imgs: r.querySelectorAll("img").length }));
    const anchor = vis.find((r) => r.top > -40) || vis[0];
    const heights = Object.fromEntries(vis.map((r) => [r.id, r.h]));
    const headBlock = rows.length ? Math.round(rows[0].getBoundingClientRect().top - mt + main.scrollTop) : 0;
    return { heights, headBlock, scrollTop: main.scrollTop, scrollHeight: main.scrollHeight, anchor, rows: vis.length, onScreen: vis.filter((r) => r.top > -r.h && r.top < 812).map((r) => ({ ...r, hasText: !!main.querySelector(`[data-event-id="${r.id}"] [data-testid^="text-content-"]`) })) };
  });
  // Tap a post's text to open its thread.
  if (!before.onScreen.length) { console.log("nothing on screen after scrolling", JSON.stringify({ scrollTop: before.scrollTop, scrollHeight: before.scrollHeight, rows: before.rows, anchor: before.anchor })); await browser.close(); return; }
  const withText = before.onScreen.filter((r) => r.hasText);
  const target = withText[Math.min(nth, withText.length - 1)] || before.onScreen[0];
  const textSel = `[data-event-id="${target.id}"] [data-testid^="text-content-"]`;
  const clicked = await page.$(textSel);
  if (!clicked) { console.log("no text to tap in", target); await browser.close(); return; }
  await clicked.click();
  await page.waitForURL(/\/(thread|post)\//, { timeout: 15000 }).catch(() => {});
  const threadUrl = page.url().replace(base, "");
  await page.waitForTimeout(2500);
  const savedEntry = await page.evaluate(() => { const m = window.__scrollPositions; const rows = m ? [...m.entries()].filter(([, v]) => v.path && v.path.startsWith("/profile")).map(([k, v]) => ({ k: k.slice(-6), st: v.scrollTop, idx: v.anchorIndex, off: Math.round(v.anchorOffset), a: (v.anchorId || "").slice(0, 8) })) : "no store"; return rows; });
  console.log("SAVED for profile entries: " + JSON.stringify(savedEntry));
  const tBack = Date.now() - T0;
  // Go back, then sample every frame for 3 s.
  await page.goBack({ waitUntil: "commit" });
  const after = await page.evaluate(async (anchorId) => {
    const main = window.__sc();
    // What state are the rows in at the first frame back: real height, or the
    // 220px content-visibility placeholder?
    const rows0 = [...main.querySelectorAll("[data-event-id]")].filter((r) => !r.closest("[inert]"));
    const cv = rows0.reduce((acc, r) => { const k = getComputedStyle(r).contentVisibility || "n/a"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const ph = rows0.filter((r) => Math.round(r.getBoundingClientRect().height) === 220).length;
    const above = () => { const rs = [...main.querySelectorAll("[data-event-id]")].filter((r) => !r.closest("[inert]")); if (!rs.length) return []; const limit = rs[0].getBoundingClientRect().top; const out = []; const walk = (el, d, path) => { for (const c of el.children) { const r = c.getBoundingClientRect(); if (r.height > 0 && r.bottom <= limit + 1) { const name = (c.dataset.testid || c.className.toString().split(" ").slice(0, 2).join(".") || c.tagName).slice(0, 40); out.push({ k: path + ">" + name, h: Math.round(r.height) }); if (d < 4) walk(c, d + 1, path + ">" + name); } } }; walk(main, 0, ""); return out; };
    const snap = () => { const rs = [...main.querySelectorAll("[data-event-id]")].filter((r) => !r.closest("[inert]")); const mt = main.getBoundingClientRect().top; return { heights: Object.fromEntries(rs.map((r) => [r.dataset.eventId, Math.round(r.getBoundingClientRect().height)])), headBlock: rs.length ? Math.round(rs[0].getBoundingClientRect().top - mt + main.scrollTop) : 0 }; };
    const first = snap(); const aboveFirst = above();
    const virtual = !!main.querySelector(".virtual-feed");
    const rowState = { restoringAttr: main.hasAttribute("data-restoring"), scroller: main.getAttribute("data-testid") || main.tagName, contentVisibility: cv, rowsAt220px: ph, rows: rows0.length };
    const samples = []; const painted = []; const t0 = performance.now();
    const ch = new MessageChannel(); ch.port1.onmessage = () => { const mt = main.getBoundingClientRect().top; const el = [...main.querySelectorAll(`[data-event-id="${anchorId}"]`)].find((r) => !r.closest("[inert]")); painted.push({ pad: main.style.paddingTop || "-", t: Math.round(performance.now() - t0), st: Math.round(main.scrollTop), a: el ? Math.round(el.getBoundingClientRect().top - mt) : null, restoring: main.hasAttribute("data-restoring") }); };
    await new Promise((done) => {
      const tick = () => {
        const t = performance.now() - t0;
        const mt = main.getBoundingClientRect().top;
        const el = [...main.querySelectorAll(`[data-event-id="${anchorId}"]`)].find((r) => !r.closest("[inert]"));
        ch.port2.postMessage(0);
        samples.push({ t: Math.round(t), st: Math.round(main.scrollTop), sh: main.scrollHeight, a: el ? Math.round(el.getBoundingClientRect().top - mt) : null, restoring: main.hasAttribute("data-restoring") });
        if (t < 3000) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    const final = snap(); const aboveFinal = above();
    return { aboveFirst, aboveFinal, virtual, first, final, rowState, samples, painted, shifts: window.__shifts.filter((s) => s.t > performance.now() - 3200), url: location.pathname };
  }, before.anchor.id);
  const st = after.samples.map((s) => s.st);
  let writes = 0, maxJump = 0, lastChangeT = 0;
  for (let i = 1; i < st.length; i++) if (st[i] !== st[i - 1]) { writes++; maxJump = Math.max(maxJump, Math.abs(st[i] - st[i - 1])); lastChangeT = after.samples[i].t; }
  const a = after.samples.map((s) => s.a);
  let anchorMoves = 0, anchorMax = 0;
  for (let i = 1; i < a.length; i++) if (a[i] !== null && a[i - 1] !== null && a[i] !== a[i - 1]) { anchorMoves++; anchorMax = Math.max(anchorMax, Math.abs(a[i] - a[i - 1])); }
  const last = after.samples[after.samples.length - 1];
  const pa = after.painted.map((s) => s.a); let paintedMoves = 0, paintedMax = 0; const moveTimes = [];
  for (let i = 1; i < pa.length; i++) if (pa[i] !== null && pa[i - 1] !== null && pa[i] !== pa[i - 1]) { paintedMoves++; paintedMax = Math.max(paintedMax, Math.abs(pa[i] - pa[i - 1])); moveTimes.push(after.painted[i].t + ":" + (pa[i] - pa[i - 1])); }
  const restoreEnd = after.painted.find((s, i) => i > 0 && !s.restoring && after.painted[i - 1].restoring)?.t ?? (after.painted[0]?.restoring ? ">3000" : "0");
  console.log(`page=${path} thread=${threadUrl} back at ${tBack}ms; landed on ${after.url}`);
  {
    const ids = Object.keys(before.heights);
    const diffs = ids.map((id) => ({ id: id.slice(0, 8), before: before.heights[id], first: after.first.heights[id], final: after.final.heights[id] })).filter((d) => d.before !== d.first || d.first !== d.final);
    console.log(`HEIGHTS block above first row: before=${before.headBlock} first=${after.first.headBlock} final=${after.final.headBlock}; rows that changed (${diffs.length} of ${ids.length}):`);
    for (const d of diffs.slice(0, 25)) console.log(`   ${d.id} before=${d.before} first=${d.first} final=${d.final}`);
  }
  { const f = new Map(after.aboveFirst.map((x) => [x.k, x.h])); const l = new Map(after.aboveFinal.map((x) => [x.k, x.h])); const keys = [...new Set([...f.keys(), ...l.keys()])]; const ch = keys.filter((k) => f.get(k) !== l.get(k)).map((k) => k + ": " + (f.get(k) ?? "absent") + " → " + (l.get(k) ?? "absent")); console.log("ABOVE THE FIRST ROW, changed first→final (" + ch.length + "):\n   " + ch.slice(0, 14).join("\n   ")); }
  console.log("ROWS AT FIRST FRAME BACK: " + JSON.stringify(after.rowState) + " virtualFeed=" + after.virtual);
  console.log("ON SCREEN BEFORE TAP (top:height): " + before.onScreen.map((r) => r.top + ":" + r.h).join(" "));
  console.log(`BEFORE  scrollTop=${before.scrollTop} anchor=${before.anchor.id.slice(0, 8)}@${before.anchor.top}px  (rows=${before.rows}, tapped ${target.id.slice(0, 8)} with ${target.imgs} imgs)`);
  console.log(`AFTER   scrollTop=${last.st} anchor@${last.a}px  drift=${last.a === null ? "row missing" : last.a - before.anchor.top}px  restoringAtEnd=${last.restoring}`);
  console.log(`MOTION  scrollTop writes=${writes} maxJump=${maxJump}px lastChange=${lastChangeT}ms | anchor moves=${anchorMoves} max=${anchorMax}px | layout shifts=${after.shifts.length} sum=${after.shifts.reduce((s, x) => s + x.v, 0).toFixed(3)}`);
  const line = (s) => `${String(s.t).padStart(5)}ms st=${String(s.st).padStart(5)} a=${String(s.a).padStart(5)} sh=${s.sh}${s.restoring ? " R" : ""}`;
  const changes = after.samples.filter((s, i) => i === 0 || s.st !== after.samples[i - 1].st || s.a !== after.samples[i - 1].a);
  console.log("PADDING over time: " + after.painted.filter((x, i) => i === 0 || x.pad !== after.painted[i - 1].pad).map((x) => x.t + "ms:" + x.pad).join(" "));
  console.log(`PAINTED anchor moves=${paintedMoves} max=${paintedMax}px at [${moveTimes.slice(0, 12).join(" ")}]  restore window ended at ${restoreEnd}ms`);
  console.log("SHIFTS: " + after.shifts.map((x) => `${x.t - Math.round(after.shifts[0]?.t ?? 0)}ms v=${x.v} ${x.src.join(", ")}`).join("\n        "));
  console.log("TIMELINE (frames where scrollTop or anchor changed, first 40):");
  for (const s of changes.slice(0, 40)) console.log("  " + line(s));
  if (changes.length > 40) console.log(`  … ${changes.length - 40} more`);
  console.log("restoreToAnchor passes logged: " + logs.filter((l) => l.includes("] pass ")).length);
  if (logs.length) { console.log("RESTORE LOG:"); for (const l of logs.slice(-12)) console.log("  " + l); }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
