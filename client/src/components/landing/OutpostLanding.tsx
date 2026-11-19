/**
 * The visitor landing (owner, 2026-11-16): the public site's page, ported
 * into the app so a visitor meets the same page at relayop.xyz and in the
 * zip. GalaxyWarpOverlay shows it in "full" mode; every "Create your space"
 * calls onLaunch, which is the overlay's way into the sign-in screen (lead:
 * Create account). The stylesheet is outpost-landing.css, scoped to
 * .outpost-landing; the page's own theme toggle sets the app's theme.
 *
 * Less is more (owner, 2026-11-18): the hero is the headline, one button and
 * the small print. The headline is English only and decodes once with a
 * subtle matrix flicker (DecodeHeadline); Otto's eyes follow the pointer,
 * the marks doze after 25 s idle, and the theme switch sweeps out from the
 * toggle where view transitions exist. All of it stands down for
 * prefers-reduced-motion.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type PointerEvent, type Ref } from "react";
import { useLocation } from "wouter";
import { useTheme } from "@/hooks/use-theme";
import { choseLite } from "@/hooks/use-perf-mode";
import { InviteGreeting } from "@/components/landing/InviteGreeting";
import { loadSignupDraft } from "@/lib/account-draft";
import { trackSignupEvent } from "@/lib/signup-telemetry";
import { RelayLogo } from "@/components/relay/RelayLogo";
import { useLandingLogo, useNoRoomForName } from "./landing-logo";
import "./outpost-landing.css";

const HEADLINE = "The next phase of the internet";
// Half-width katakana and digits: the "matrix" a letter flickers through before it settles.
const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789";

function reducedMotion(): boolean {
  try { return !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

const stroke = (w: number): CSSProperties => ({ fill: "none", stroke: "currentColor", strokeWidth: w, strokeLinecap: "round", strokeLinejoin: "round" });
const INK: CSSProperties = { fill: "currentColor" };
const dot: CSSProperties = { display: "inline-block", width: ".15em", height: ".15em", borderRadius: "50%", background: "var(--accent)", marginInlineStart: ".05em" };

/** The mark's face. It changes for a reason, never on a timer (owner, 2026-11-18). */
type MarkMood = "here" | "done";
/** A passing reaction: a blink, or the theme changing. */
type MarkReact = "blink" | "light" | "dark" | null;

/** Otto: the open ring with the Ember dot, and eyes for each mood. */
function Otto({ size, mood = "here", react, markRef, className = "", label }: { size: number; mood?: MarkMood; react?: MarkReact; markRef?: Ref<SVGSVGElement>; className?: string; label?: string }) {
  return (
    <svg ref={markRef} className={`otto ${className}`} data-mood={mood} data-react={react || undefined} viewBox="0 0 100 100" width={size} height={size}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ overflow: "visible" }}>
      {/* The ring's weight lives in the stylesheet (.otto .ring), so the header's logo can thicken it when the face stands in as the O. */}
      <path className="ring" d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" style={{ fill: "none", stroke: "currentColor", strokeLinecap: "round" }} />
      <circle className="m m-ask" cx="71.2" cy="28.8" r="12" style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeOpacity: 0.45 }} />
      <circle className="dot rl-dot" cx="71.2" cy="28.8" r="6.5" style={{ fill: "var(--accent)" }} />
      <g className="look">
        <g className="m m-here blink"><ellipse cx="42" cy="51" rx="3.6" ry="5.2" style={INK} /><ellipse cx="58" cy="51" rx="3.6" ry="5.2" style={INK} /></g>
        <g className="m m-work"><ellipse cx="47" cy="45" rx="3.4" ry="4.8" style={INK} /><ellipse cx="61" cy="45" rx="3.4" ry="4.8" style={INK} /></g>
        <path className="m m-done" d="M37 53.5q5-8 10 0M53 53.5q5-8 10 0" style={{ fill: "none", stroke: "currentColor", strokeWidth: 4.2, strokeLinecap: "round" }} />
        <g className="m m-ask"><circle cx="42" cy="50" r="5" style={INK} /><circle cx="58" cy="50" r="5" style={INK} /></g>
        <path className="m m-rest" d="M37 51.5h10M53 51.5h10" style={{ fill: "none", stroke: "currentColor", strokeWidth: 4.2, strokeLinecap: "round" }} />
      </g>
    </svg>
  );
}

function Chip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 500 }}>
      <span className="ico" style={{ display: "inline-flex" }}>
        <svg viewBox="0 0 100 100" width="40" height="40" aria-hidden="true" style={{ overflow: "visible", margin: "-6px 0 -6px -6px" }}>{children}</svg>
      </span>
      {label}
    </span>
  );
}

/* Otto's doodles (owner, 2026-11-16): small line sketches in the hero's
   margins, in Otto's stroke with the Ember dot, each fading in and out on its
   own slow beat and waking near the pointer. The things the page is about: a
   post, a chat, going live, the calendar, a tip, a lock, your people, your
   key, trust, and Otto peeking in. Phones keep four corners only. */
const DOODLE: Record<string, React.ReactNode> = {
  post: <><rect x="14" y="22" width="72" height="56" rx="14" style={stroke(9)} /><path d="M30 42h40M30 58h26" style={stroke(9)} /><circle cx="70" cy="60" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  chat: <><path d="M82 44V56A18 18 0 0 1 64 74H40L26 88V71A18 18 0 0 1 18 56V38A18 18 0 0 1 36 20H60" style={stroke(9)} /><circle cx="75" cy="27" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  live: <><path d="M33 33a24 24 0 0 0 0 34M67 33a24 24 0 0 1 0 34M19 20a42 42 0 0 0 0 60M81 20a42 42 0 0 1 0 60" style={stroke(9)} /><circle cx="50" cy="50" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  calendar: <><rect x="16" y="24" width="68" height="62" rx="15" style={stroke(9)} /><path d="M16 46H84M35 14V30M65 14V30" style={stroke(9)} /><circle cx="64" cy="66" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  tip: <><path d="M50 84C27 67 14 54 14 39a18 18 0 0 1 36-5a18 18 0 0 1 36 5c0 15-13 28-36 45Z" style={stroke(9)} /><circle cx="50" cy="48" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  lock: <><rect x="22" y="44" width="56" height="42" rx="13" style={stroke(9)} /><path d="M34 44V33a16 16 0 0 1 32 0v11" style={stroke(9)} /><circle cx="50" cy="65" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  people: <><circle cx="38" cy="36" r="14" style={stroke(9)} /><path d="M12 84c2-16 12-24 26-24s24 8 26 24M74 56c9 3 14 11 15 24" style={stroke(9)} /><circle cx="76" cy="30" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  key: <><circle cx="33" cy="50" r="19" style={stroke(9)} /><path d="M52 50H89M73 50V64M88 50V61" style={stroke(9)} /><circle cx="33" cy="50" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  trust: <><path d="M50 13L81 25V50C81 68 69 81 50 89C31 81 19 68 19 50V25Z" style={stroke(9)} /><circle cx="50" cy="50" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  send: <><path d="M14 46L86 18L66 86L50 58Z" style={stroke(9)} /><path d="M50 58L86 18" style={stroke(9)} /><circle cx="80" cy="76" r="6.5" style={{ fill: "var(--accent)" }} /></>,
  otto: <><path d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" style={{ fill: "none", stroke: "currentColor", strokeWidth: 9, strokeLinecap: "round" }} /><circle cx="71.2" cy="28.8" r="6.5" style={{ fill: "var(--accent)" }} /><ellipse cx="42" cy="51" rx="3.6" ry="5.2" style={INK} /><ellipse cx="58" cy="51" rx="3.6" ry="5.2" style={INK} /></>,
};
/* where each sits (percent of the hero), its size, tilt, and beat offset */
const DOODLES: Array<[keyof typeof DOODLE, number, number, number, number, number, boolean]> = [
  ["post", 6, 14, 46, -8, 0, true], ["live", 91, 11, 44, 7, 2.1, true], ["chat", 13, 44, 42, 5, 4.4, false], ["key", 88, 40, 40, -6, 1.3, false],
  ["tip", 5, 76, 38, -4, 6.2, true], ["people", 92, 68, 46, 6, 3.5, true], ["calendar", 17, 90, 40, 3, 7.7, false], ["lock", 90, 88, 38, -5, 5.0, false],
  ["send", 9, 58, 36, 10, 8.9, false], ["trust", 72, 94, 36, -9, 10.2, false], ["otto", 3, 30, 44, 0, 11.6, false],
];
function HeroDoodles() {
  return (
    <div className="hero-doodles" aria-hidden="true">
      {DOODLES.map(([name, x, y, size, tilt, delay, phone]) => (
        <svg key={name} className={`doodle${phone ? " doodle-phone" : ""}`} viewBox="0 0 100 100" width={size} height={size}
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${delay}s`, ["--tilt" as string]: `${tilt}deg` } as CSSProperties}>
          {DOODLE[name]}
        </svg>
      ))}
    </div>
  );
}

const btnStyle: CSSProperties = { display: "inline-flex", alignItems: "center", height: 54, padding: "0 28px", borderRadius: 999, background: "var(--btn)", color: "var(--btnink)", fontSize: 17, fontWeight: 500 };
const navCol: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 140 };
const navHead: CSSProperties = { fontSize: 14, fontWeight: 600, color: "var(--ink)", paddingBottom: 8 };
const navLink: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 40, alignSelf: "flex-start", background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", font: "inherit" };
const pillarRow: CSSProperties = { position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "12px 72px", alignItems: "start", padding: "clamp(28px, 4.5vw, 40px) 0", borderTop: "1px solid var(--line)" };
const pillarHead: CSSProperties = { margin: 0, fontSize: "clamp(28px, 3.4vw, 42px)", lineHeight: 1.08, fontWeight: 600, letterSpacing: "-0.035em" };
const pillarText = { margin: 0, fontSize: 19, color: "var(--ink2)", textWrap: "pretty" } as CSSProperties;

/**
 * The headline, decoded once (owner, 2026-11-18: "some type of matrix subtle
 * transition"). This is its entrance: no fade runs over it. Each letter stays
 * in the flow in its final glyph, transparent, with a flickering katakana/digit
 * glyph drawn over it, so nothing shifts; letters settle left to right in about
 * a second, then the warm dot appears.
 * Screen readers get the sentence from aria-label. Reduced motion: no decode.
 */
function DecodeHeadline({ text, onLetter, start = true }: { text: string; /** Each letter as it settles (its box), then null when the sentence is done. */ onLetter?: (box: DOMRect | null) => void; /** False while the page waits behind the logo's intro: the decode begins when the page comes in. */ start?: boolean }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);
  const watcher = useRef(onLetter);
  watcher.current = onLetter;
  // Layout effect: start scrambled before the first paint, so the sentence never flashes first.
  // The letters only turn transparent (their kerning and places never change); the flickering
  // glyphs live in a separate layer, each centred over its letter's measured box.
  useLayoutEffect(() => {
    const root = rootRef.current, layer = layerRef.current;
    if (!root || !layer || !start || reducedMotion()) return;
    const cells = [...root.querySelectorAll<HTMLElement>(".dc")];
    const pick = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    const box = layer.getBoundingClientRect();
    const glyphs = cells.map((c) => {
      const r = c.getBoundingClientRect();
      const g = document.createElement("span");
      g.className = "dc-g";
      g.style.left = `${r.left - box.left + r.width / 2}px`;
      g.style.top = `${r.top - box.top}px`;
      g.style.height = `${r.height}px`;
      g.textContent = pick();
      layer.appendChild(g);
      c.classList.add("scr");
      return g;
    });
    // About 1.2 s in all: a short hold, then letters settle left to right with a little jitter.
    const t0 = performance.now() + 160;
    const settleAt = cells.map((_, i) => t0 + i * 34 + Math.random() * 180);
    root.classList.add("decoding");
    let raf = 0, last = 0;
    const frame = (now: number) => {
      const swap = now - last > 60;
      if (swap) last = now;
      let left = 0;
      cells.forEach((c, i) => {
        if (!c.classList.contains("scr")) return;
        if (now >= settleAt[i]) { c.classList.remove("scr"); glyphs[i].remove(); watcher.current?.(c.getBoundingClientRect()); }
        else { left++; if (swap) glyphs[i].textContent = pick(); }
      });
      if (left) raf = requestAnimationFrame(frame);
      else { root.classList.remove("decoding"); watcher.current?.(null); }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); cells.forEach((c) => c.classList.remove("scr")); glyphs.forEach((g) => g.remove()); root.classList.remove("decoding"); };
  }, [text, start]);
  const words = text.split(" ");
  return (
    <h1 aria-label={text} style={{ position: "relative", margin: 0, fontSize: "clamp(42px, 9vw, 92px)", lineHeight: 1.04, fontWeight: 600, textWrap: "balance" } as CSSProperties}>
      <span ref={rootRef} className="dc-root" aria-hidden="true" lang="en" style={{ letterSpacing: "-0.045em" }}>
        {words.map((w, wi) => (
          <Fragment key={wi}>
            <span style={{ whiteSpace: "nowrap" }}>
              {[...w].map((ch, ci) => <span key={ci} className="dc">{ch}</span>)}
              {wi === words.length - 1 && <span className="dc-dot" style={dot} />}
            </span>
            {wi < words.length - 1 ? " " : null}
          </Fragment>
        ))}
      </span>
      <span ref={layerRef} className="dc-layer" aria-hidden="true" />
    </h1>
  );
}

export function OutpostLanding({ onLaunch }: { onLaunch: () => void }) {
  const [, navigate] = useLocation();
  const { isDark, setTheme } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const closingRef = useRef<HTMLElement>(null);
  // The seam under the hero: the section, its "Private…" line, the full stop, and the dot that travels to it.
  const seamRef = useRef<HTMLElement>(null);
  const privRef = useRef<HTMLSpanElement>(null);
  const stopRef = useRef<HTMLSpanElement>(null);
  const flyRef = useRef<HTMLSpanElement>(null);
  const [asleep, setAsleep] = useState(false);

  // Relay comes alive, and only for a reason (owner, 2026-11-18): the small mark
  // in the header watches the headline decode, notices the buttons, follows the
  // scroll and reacts to the theme; the large one at the bottom greets you once.
  // Each reaction is short and plays once. Reduced motion: faces may change,
  // nothing moves. Lite mode: no pointer-follow and no idle glances.
  const headMarkRef = useRef<SVGSVGElement>(null);
  const bigMarkRef = useRef<SVGSVGElement>(null);
  const [headMood, setHeadMood] = useState<MarkMood>("here");
  const [headReact, setHeadReact] = useState<MarkReact>(null);
  const [bigMood, setBigMood] = useState<MarkMood>("here");
  const gazeTimer = useRef(0);
  const gazeHeld = useRef(false);
  const lastPointer = useRef(0);
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); }, []);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); window.clearTimeout(gazeTimer.current); }, []);

  // A reaction points the header mark's eyes by setting --ex/--ey on the mark
  // itself, which wins over the pointer-follow values it inherits from the page.
  const releaseGaze = useCallback(() => {
    window.clearTimeout(gazeTimer.current);
    gazeHeld.current = false;
    headMarkRef.current?.style.removeProperty("--ex");
    headMarkRef.current?.style.removeProperty("--ey");
  }, []);
  const gaze = useCallback((x: number, y: number, holdMs?: number) => {
    const el = headMarkRef.current;
    if (!el || reducedMotion()) return;
    el.style.setProperty("--ex", x.toFixed(2));
    el.style.setProperty("--ey", y.toFixed(2));
    gazeHeld.current = true;
    window.clearTimeout(gazeTimer.current);
    if (holdMs) gazeTimer.current = window.setTimeout(releaseGaze, holdMs);
  }, [releaseGaze]);
  const lookAt = useCallback((clientX: number, clientY: number, holdMs?: number) => {
    const el = headMarkRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2), dy = clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    gaze((dx / d) * 4, (dy / d) * 3.4, holdMs);
  }, [gaze]);
  const lookAtEl = useCallback((el: Element) => { const r = el.getBoundingClientRect(); lookAt(r.left + r.width / 2, r.top + r.height / 2); }, [lookAt]);
  const smile = useCallback(() => { setHeadMood("done"); later(() => setHeadMood("here"), 700); }, [later]);
  const reactOnce = useCallback((kind: Exclude<MarkReact, null>, ms: number) => { setHeadReact(kind); later(() => setHeadReact((k) => (k === kind ? null : k)), ms); }, [later]);

  // It watches the headline decode, then looks at you and blinks.
  const onLetter = useCallback((box: DOMRect | null) => {
    if (box) lookAt(box.left + box.width / 2, box.top + box.height / 2, 1200);
    else { releaseGaze(); reactOnce("blink", 450); }
  }, [lookAt, releaseGaze, reactOnce]);
  // It notices the buttons: looks toward one you hover or focus, smiles when you press it.
  const noticed = {
    onPointerEnter: (e: PointerEvent<HTMLButtonElement>) => { if (e.pointerType === "mouse") lookAtEl(e.currentTarget); },
    onPointerLeave: () => releaseGaze(),
    onFocus: (e: FocusEvent<HTMLButtonElement>) => lookAtEl(e.currentTarget),
    onBlur: () => releaseGaze(),
    onPointerDown: () => smile(),
  };
  // It follows your scroll: eyes down while the page moves down, up while it moves up.
  useEffect(() => {
    const scroller = rootRef.current?.parentElement;
    if (!scroller) return;
    let last = scroller.scrollTop;
    const onScroll = () => {
      const now = scroller.scrollTop;
      if (now !== last) gaze(0, now > last ? 3.4 : -3, 350);
      last = now;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [gaze]);
  // The seam under the hero (owner, 2026-11-18). Three things, all driven by the person's own
  // scroll and nothing else: the warm glow carries through and quiets as you go on; "Private…"
  // comes out of a blur; and the Ember dot rides down from the hero to land as the sentence's
  // full stop. At the top of the page the hero is exactly as it was. Reduced motion never
  // starts this: the glow stays, the line is sharp and the full stop is in its place.
  useEffect(() => {
    const root = rootRef.current, scroller = root?.parentElement, sec = seamRef.current, priv = privRef.current, stop = stopRef.current, fly = flyRef.current;
    if (!root || !scroller || !sec || !priv || !stop || !fly || reducedMotion()) return;
    const heroContent = root.querySelector<HTMLElement>("[data-hero-content]");
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    let raf = 0, landed = false;
    const update = () => {
      raf = 0;
      // Read everything first, then write.
      const vh = scroller.clientHeight, top = scroller.scrollTop;
      const view = scroller.getBoundingClientRect(), s = sec.getBoundingClientRect(), p = priv.getBoundingClientRect(), d = stop.getBoundingClientRect();
      const h = heroContent?.getBoundingClientRect();
      const secTop = s.top - view.top, lineTop = p.top - view.top;
      // The ground quiets: full warmth until the section's top is a third of the way up the window.
      const warmth = 1 - 0.85 * clamp((0.34 * vh - secTop) / (0.9 * vh));
      // "Private…" sharpens between the window's bottom edge and where you read it.
      const sharp = clamp((vh - lineTop) / (0.36 * vh));
      // The dot travels while the page goes from its top to the line sitting at half the window's height.
      const t = clamp(top / Math.max(160, top + lineTop - 0.5 * vh));
      sec.style.setProperty("--seam-glow", warmth.toFixed(3));
      // No filter at all once it is sharp: a zero blur still costs a layer and softens the letters.
      // Lite, when the person chose it, draws no blur: the line only comes up in strength.
      priv.style.filter = sharp < 1 && !choseLite() ? `blur(${((1 - sharp) * 9).toFixed(2)}px)` : "";
      priv.style.opacity = sharp < 1 ? (0.35 + 0.65 * sharp).toFixed(3) : "";
      if (h && t > 0 && t < 1) {
        const size = d.width;
        // From just under the hero's words (in the glow, clear of the small print) to the full stop,
        // on a curve that comes in from the right along the line the words sit on.
        const sx = view.left + view.width / 2 - size / 2 - s.left, sy = h.bottom + 22 - s.top;
        const ex = d.left - s.left, ey = d.top - s.top;
        const room = Math.max(0, Math.min(70, s.width - 20 - size - ex));
        const u = 1 - t;
        const x = u * u * sx + 2 * t * u * (ex + room) + t * t * ex;
        const y = u * u * sy + 2 * t * u * ey + t * t * ey;
        // It starts as a soft spark of the glow, behind the words, and draws in to a sharp full stop.
        const draw = t * t;
        fly.style.width = fly.style.height = `${size}px`;
        fly.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
        fly.style.scale = (3.4 - 2.4 * draw).toFixed(3);
        fly.style.filter = draw < 0.97 ? `blur(${((1 - draw) * size * 0.45).toFixed(2)}px)` : "";
        fly.style.opacity = (clamp(t / 0.08) * (0.6 + 0.4 * draw)).toFixed(3);
        sec.classList.add("seam-flying");
        sec.classList.remove("seam-landed");
        landed = false;
      } else {
        fly.style.opacity = "0";
        sec.classList.remove("seam-flying");
        if (t >= 1 && !landed) { landed = true; sec.classList.add("seam-landed"); } // the full stop pops once as the dot arrives
        if (t <= 0) { landed = false; sec.classList.remove("seam-landed"); }
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    document.fonts?.ready.then(onScroll).catch(() => {});
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  // At rest: one small glance every 8 to 12 seconds, when nothing else has its attention.
  useEffect(() => {
    let t = 0;
    const tick = () => {
      t = window.setTimeout(() => {
        if (!gazeHeld.current && !reducedMotion() && !choseLite() && Date.now() - lastPointer.current > 4000 && !document.hidden) {
          gaze((Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random()), (Math.random() - 0.5) * 2, 600);
        }
        tick();
      }, 8000 + Math.random() * 4000);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [gaze]);
  // The large mark at the bottom greets you once, the first time it scrolls into view.
  useEffect(() => {
    const el = bigMarkRef.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      setBigMood("done");
      later(() => setBigMood("here"), 700);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [later]);
  const topRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = topRef.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The header's logo (landing-logo.ts): the full name at the top, the face once the page has
  // scrolled or where a narrow phone has no room for the name. On a first visit it tells its
  // name in the middle of the screen while the page waits, then lands here.
  const noRoomForName = useNoRoomForName();
  const logo = useLandingLogo(scrolled || noRoomForName ? "icon" : "full", choseLite());
  // As it writes its name, the face looks at it.
  useEffect(() => { if (logo.stage === "relay") gaze(-4, 0, 1100); }, [logo.stage, gaze]);

  const go = useCallback((path: string) => (e: MouseEvent) => { e.preventDefault(); navigate(path); }, [navigate]);
  const toTop = useCallback((e: MouseEvent) => {
    e.preventDefault();
    rootRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }, []);

  // The theme switch: the app's theme, with the site's sweep from the toggle.
  const onToggleTheme = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const next = isDark ? "light" : "dark";
    const html = document.documentElement;
    const apply = () => setTheme(next);
    reactOnce(next, 700); // the mark blinks at the light, or settles for the dark
    if (typeof document.startViewTransition !== "function" || reducedMotion()) { apply(); return; }
    html.style.setProperty("--vx", `${e.clientX}px`);
    html.style.setProperty("--vy", `${e.clientY}px`);
    html.classList.add("theming");
    document.startViewTransition(apply).finished.finally(() => html.classList.remove("theming"));
  }, [isDark, setTheme, reactOnce]);

  // Otto's eyes follow the pointer and the dot grids light up under it.
  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    lastPointer.current = Date.now();
    if (e.pointerType !== "mouse" || reducedMotion()) return;
    const root = rootRef.current;
    if (!root) return;
    if (choseLite()) return; // Lite, when chosen: the eyes don't follow the pointer (a phone only defaults to it)
    const set = (k: string, v: string) => root.style.setProperty(k, v);
    set("--ex", ((e.clientX / window.innerWidth - 0.5) * 7).toFixed(2));
    set("--ey", ((e.clientY / window.innerHeight - 0.5) * 6).toFixed(2));
    const closing = closingRef.current?.getBoundingClientRect();
    if (closing) {
      set("--qx", `${(e.clientX - closing.left).toFixed(0)}px`);
      set("--qy", `${(e.clientY - closing.top).toFixed(0)}px`);
    }
    const hero = heroRef.current?.getBoundingClientRect();
    if (hero) {
      set("--mx", `${(e.clientX - hero.left).toFixed(0)}px`);
      set("--my", `${(e.clientY - hero.top).toFixed(0)}px`);
    }
  }, []);

  // Idle for 25 s and the marks doze; anything wakes them.
  useEffect(() => {
    let timer = window.setTimeout(() => setAsleep(true), 25_000);
    const t0 = Date.now();
    const wake = () => {
      if (Date.now() - t0 < 700) return;
      setAsleep(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), 25_000);
    };
    const names = ["pointermove", "pointerdown", "keydown", "touchstart", "scroll"] as const;
    names.forEach((n) => window.addEventListener(n, wake, { passive: true, capture: true }));
    return () => {
      window.clearTimeout(timer);
      names.forEach((n) => window.removeEventListener(n, wake, { capture: true }));
    };
  }, []);

  const draft = loadSignupDraft();
  const draftName = draft?.displayName?.trim();
  const resumable = !!draft && Boolean(
    draftName || draft.username?.trim() || draft.bio?.trim() || draft.picture || draft.banner
    || draft.nip05?.trim() || draft.website?.trim() || draft.rss?.trim() || draft.lud16?.trim() || draft.account?.secretKeyHex,
  );
  if (resumable) trackSignupEvent("resume_chip_shown");

  return (
    <div ref={rootRef} className={`outpost-landing${asleep ? " asleep" : ""}${logo.pre ? " is-pre" : ""}${logo.landing ? " is-landing" : ""}`} onPointerMove={onPointerMove} data-testid="outpost-landing">
      {/* At the top of the page the header is clear, so the hero has no edge above it;
          its glass and hairline come in once the page scrolls (owner, 2026-11-18). */}
      <div ref={topRef} aria-hidden="true" style={{ height: 1, marginBottom: -1 }} />
      <header className={`ol-header${scrolled ? " scrolled" : ""}${logo.intro ? " is-intro" : ""}`} style={{ position: "sticky", top: 0, zIndex: 20 }}>
        <div className="lg-in" style={{ maxWidth: 1120, margin: "0 auto", padding: "0 clamp(16px, 5vw, 24px)", height: 64, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12 }}>
          <a href="#top" className="lg-btn" data-testid="landing-logo"
            onClick={(e) => { toTop(e); logo.onClick(); }}
            onPointerEnter={(e) => logo.onPointerEnter(e.pointerType)}
            onPointerLeave={logo.onPointerLeave}>
            <RelayLogo state={logo.stage} mark={<Otto size={34} mood={headMood} react={headReact} markRef={headMarkRef} />} />
          </a>
          <div className="lg-hide" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" className="tap" onClick={onToggleTheme} aria-label="Switch between light and dark" data-testid="landing-theme-toggle"
              style={{ width: 44, height: 44, borderRadius: 999, border: 0, background: "transparent", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="8.2" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.6 }} /><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" style={INK} /></svg>
            </button>
            <button type="button" className="btn" onClick={onLaunch} {...noticed} data-testid="landing-get-outpost"
              style={{ display: "inline-flex", alignItems: "center", height: 44, padding: "0 clamp(14px, 4vw, 18px)", borderRadius: 999, background: "var(--btn)", color: "var(--btnink)", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" }}>Get Outpost</button>
          </div>
        </div>
      </header>

      <section id="top" ref={heroRef} className="hero-fit" style={{ position: "relative", padding: "clamp(48px, 8vw, 88px) clamp(16px, 5vw, 24px)", textAlign: "center", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div className="hero-bg" aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
          <div className="drift" style={{ position: "absolute", left: "50%", top: "38%", width: 900, height: 520, marginLeft: -450, borderRadius: "50%", background: "var(--accent)", opacity: "var(--glow)", filter: "blur(120px)" }} />
          <div className="drift2" style={{ position: "absolute", left: "50%", top: "4%", width: 1100, height: 460, marginLeft: -760, borderRadius: "50%", background: "var(--cool)", opacity: "var(--glow2)", filter: "blur(130px)" }} />
          <HeroDoodles />
        </div>
        <div data-hero-content style={{ position: "relative", zIndex: 2, maxWidth: 920, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
          <DecodeHeadline text={HEADLINE} onLetter={onLetter} start={!logo.pre} />
          <InviteGreeting />
          <div className="in" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 20, marginTop: 8, animationDelay: ".44s" }}>
            <button type="button" className="btn" onClick={onLaunch} {...noticed} style={btnStyle} data-testid="button-engage-warp">Create your space</button>
          </div>
          <p className="in" style={{ margin: 0, fontSize: 14, color: "var(--ink2)", animationDelay: ".52s" }}>Free. Open source. No email or phone number.</p>
          {resumable && (
            <button type="button" className="tap pill" data-testid="button-resume-signup"
              onClick={() => { trackSignupEvent("resume_chip_tapped"); onLaunch(); }}
              style={{ height: 40, padding: "0 16px", borderRadius: 999, fontSize: 14, cursor: "pointer" }}>
              Resume signup{draftName ? ` as ${draftName}` : ""}
            </button>
          )}
        </div>
      </section>

      {/* Sits under the hero's words (2) and over its backdrop (0), so the glow it shares with the hero never tints them. */}
      <section ref={seamRef} className="seam" data-testid="landing-seam" style={{ position: "relative", zIndex: 1, background: "var(--bg)", padding: "clamp(72px, 11vw, 120px) clamp(16px, 5vw, 24px)" }}>
        {/* The hero's warmth, carried across the seam: it reaches up over the hero's last stretch and down behind the headline. */}
        <div className="seam-glow" aria-hidden="true"><i /></div>
        {/* The dot on its way to the end of the sentence (placed by the scroll handler above). */}
        <span ref={flyRef} className="seam-fly" aria-hidden="true" data-testid="seam-dot-flying" />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 1120, margin: "0 auto", display: "flex", flexDirection: "column", gap: "clamp(36px, 6vw, 64px)" }}>
          <h2 className="inks" style={{ margin: 0, maxWidth: 900, fontSize: "clamp(26px, 6.6vw, 64px)", lineHeight: 1.06, fontWeight: 600, letterSpacing: "-0.04em", textWrap: "balance" } as CSSProperties}>
            <span style={{ display: "block" }}>Public when you want it.</span>{" "}
            <span ref={privRef} data-testid="seam-private-line" style={{ display: "block" }}>Private when you don’t<span ref={stopRef} className="seam-stop" aria-hidden="true" data-testid="seam-dot" style={dot} /></span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <ul className="flist" style={{ margin: 0, padding: 0, listStyle: "none", borderBottom: "1px solid var(--line)" }}>
              <li className="frow" style={pillarRow}>
                <h3 style={pillarHead}>In public</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  <p style={pillarText}>Post, publish long articles and go live. Everyone who follows you sees it, and they can tip you directly, with no algorithm or middleman in between.</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
                    <Chip label="Posts and articles"><path d="M82 44V56A18 18 0 0 1 64 74H40L26 88V71A18 18 0 0 1 18 56V38A18 18 0 0 1 36 20H60" style={stroke(9)} /><circle className="pop" cx="75" cy="27" r="6.5" style={{ fill: "var(--accent)" }} /></Chip>
                    <Chip label="Go live"><path d="M33 33a24 24 0 0 0 0 34M67 33a24 24 0 0 1 0 34M19 20a42 42 0 0 0 0 60M81 20a42 42 0 0 1 0 60" style={stroke(9)} /><circle className="pop" cx="50" cy="50" r="6.5" style={{ fill: "var(--accent)" }} /></Chip>
                    <Chip label="Calendar"><rect x="16" y="24" width="68" height="62" rx="15" style={{ fill: "none", stroke: "currentColor", strokeWidth: 9 }} /><path d="M16 46H84M35 14V30M65 14V30" style={stroke(9)} /><circle cx="64" cy="66" r="6.5" style={{ fill: "var(--accent)" }} /></Chip>
                    <Chip label="Tips"><path d="M50 84C27 67 14 54 14 39a18 18 0 0 1 36-5a18 18 0 0 1 36 5c0 15-13 28-36 45Z" style={stroke(9)} /><circle cx="50" cy="48" r="6.5" style={{ fill: "var(--accent)" }} /></Chip>
                  </div>
                </div>
              </li>
              <li className="frow" style={pillarRow}>
                <h3 style={pillarHead}>In private</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  <p style={pillarText}>Message one person or run a whole community. It is encrypted, so only your people can read it.</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
                    <Chip label="Private messages"><rect x="22" y="44" width="56" height="42" rx="13" style={{ fill: "none", stroke: "currentColor", strokeWidth: 9 }} /><path d="M34 44V33a16 16 0 0 1 32 0v11" style={stroke(9)} /><circle cx="50" cy="65" r="6.5" style={{ fill: "var(--accent)" }} /></Chip>
                    <Chip label="Communities"><circle cx="38" cy="36" r="14" style={{ fill: "none", stroke: "currentColor", strokeWidth: 9 }} /><path d="M12 84c2-16 12-24 26-24s24 8 26 24" style={stroke(9)} /><circle cx="76" cy="30" r="6.5" style={{ fill: "var(--accent)" }} /><path d="M74 56c9 3 14 11 15 24" style={stroke(9)} /></Chip>
                  </div>
                </div>
              </li>
              <li className="frow" style={pillarRow}>
                <h3 style={pillarHead}>On your terms</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  <p style={pillarText}>Your account is a key you hold, and you decide how much of the wider network reaches you.</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 24px" }}>
                    <Chip label="Your key"><g className="turn"><circle cx="33" cy="50" r="19" style={{ fill: "none", stroke: "currentColor", strokeWidth: 9 }} /><path d="M52 50H89M73 50V64M88 50V61" style={stroke(9)} /><circle cx="33" cy="50" r="6.5" style={{ fill: "var(--accent)" }} /></g></Chip>
                    <Chip label="Trust and safety"><path d="M50 13L81 25V50C81 68 69 81 50 89C31 81 19 68 19 50V25Z" style={stroke(9)} /><circle cx="50" cy="50" r="6.5" style={{ fill: "var(--accent)" }} /></Chip>
                  </div>
                </div>
              </li>
            </ul>
            <p className="rv" style={{ margin: 0, display: "flex", alignItems: "center", gap: 12, color: "var(--ink2)" }}>
              <svg viewBox="0 0 100 100" width="28" height="28" aria-hidden="true" style={{ flex: "none" }}><path d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" style={{ fill: "none", stroke: "currentColor", strokeWidth: 9, strokeLinecap: "round" }} /><circle cx="71.2" cy="28.8" r="6.5" style={{ fill: "var(--accent)" }} /><ellipse cx="42" cy="51" rx="3.6" ry="5.2" style={INK} /><ellipse cx="58" cy="51" rx="3.6" ry="5.2" style={INK} /></svg>
              <span>And Relay, an assistant that works only for you, arrives in 2027.</span>
            </p>
          </div>
        </div>
      </section>

      <section id="closing" ref={closingRef} className="cta-sec" style={{ position: "relative", overflow: "hidden", background: "var(--bg2)", borderTop: "1px solid var(--line)", padding: "clamp(88px, 13vw, 144px) clamp(16px, 5vw, 24px)", textAlign: "center" }}>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div className="cta-glow" style={{ position: "absolute", left: "50%", top: "40%", width: 620, height: 380, margin: "-190px 0 0 -310px", borderRadius: "50%", background: "var(--accent)", filter: "blur(110px)" }} />
          <div className="cta-dots" style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle, var(--ink) 1px, transparent 1.6px)", backgroundSize: "28px 28px", WebkitMaskImage: "radial-gradient(320px circle at var(--qx, 50%) var(--qy, -400px), #000, transparent)", maskImage: "radial-gradient(320px circle at var(--qx, 50%) var(--qy, -400px), #000, transparent)" }} />
        </div>
        <div className="rv" style={{ position: "relative", maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
          <Otto size={132} mood={bigMood} markRef={bigMarkRef} label="Relay, pleased" />
          <h2 style={{ margin: 0, fontSize: "clamp(40px, 6vw, 76px)", lineHeight: 1.02, fontWeight: 600, letterSpacing: "-0.045em", textWrap: "balance" } as CSSProperties}>Start with a space that’s yours<span aria-hidden="true" style={dot} /></h2>
          <button type="button" className="btn" onClick={onLaunch} style={{ ...btnStyle, marginTop: 8 }} data-testid="landing-closing-cta">Create your space</button>
        </div>
      </section>

      <footer style={{ position: "relative", overflow: "hidden", background: "var(--bg)", borderTop: "1px solid var(--line)", padding: "clamp(56px, 8vw, 88px) clamp(16px, 5vw, 24px) 0" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", flexDirection: "column", gap: "clamp(40px, 6vw, 64px)", fontSize: 15, color: "var(--ink2)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "40px 64px" }}>
            <div style={{ flex: "1 1 280px", maxWidth: 360, display: "flex", flexDirection: "column", gap: 14 }}>
              <a href="#top" onClick={toTop} style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44, alignSelf: "flex-start", color: "var(--ink)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>
                <Otto size={30} /> Outpost
              </a>
              <p style={{ margin: 0, textWrap: "pretty" } as CSSProperties}>The next phase of the internet.</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "32px clamp(32px, 6vw, 72px)" }}>
              <nav aria-label="Outpost" style={navCol}>
                <span style={navHead}>Outpost</span>
                <button type="button" onClick={onLaunch} style={navLink}>Create your space</button>
                <a href="/help" onClick={go("/help")} style={navLink}>Help and guides</a>
                <a href="/whats-new" onClick={go("/whats-new")} style={navLink}>What’s new</a>
              </nav>
              <nav aria-label="Open source" style={navCol}>
                <span style={navHead}>Open source</span>
                <a href="https://github.com/megistusXYZ/relay-outpost" target="_blank" rel="noopener noreferrer" style={navLink}>GitHub</a>
                <a href="https://github.com/megistusXYZ/relay-outpost/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" style={navLink}>MIT licence</a>
                <a href="https://github.com/megistusXYZ/relay-outpost/blob/main/SECURITY.md" target="_blank" rel="noopener noreferrer" style={navLink}>Security</a>
              </nav>
              <nav aria-label="Trust" style={navCol}>
                <span style={navHead}>Trust</span>
                <a href="/privacy" onClick={go("/privacy")} style={navLink}>Privacy</a>
                <a href="/terms" onClick={go("/terms")} style={navLink}>Terms</a>
                <a href="/child-safety" onClick={go("/child-safety")} style={navLink}>Child safety</a>
              </nav>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "8px 32px", borderTop: "1px solid var(--line)", paddingTop: 24, fontSize: 14 }}>
            <span>MIT licensed. No ads, no trackers.</span>
            <span>Built on an open network no company owns.</span>
          </div>
          {/* The maker's mark (owner, 2026-11-18): the Megistus logo on its own, signing off the page
              between two fading hairlines, just above the large "Outpost." It rises in with the scroll
              like the sections above, sits a little soft, and comes to full strength when pointed at.
              Black on light, white on dark (outpost-landing.css). */}
          <div className="megistus-row rv" data-testid="landing-megistus-row">
            <a href="https://megistus.xyz" target="_blank" rel="noopener noreferrer" className="megistus" title="Megistus" data-testid="landing-megistus">
              <img className="megistus-on-light" src="/images/megistus-mark-black.webp" alt="Megistus" width={83} height={44} loading="lazy" decoding="async" />
              <img className="megistus-on-dark" src="/images/megistus-mark-white.webp" alt="Megistus" width={83} height={44} loading="lazy" decoding="async" />
            </a>
          </div>
        </div>
        <div aria-hidden="true" style={{ maxWidth: 1120, margin: "clamp(32px, 5vw, 64px) auto 0", display: "flex", alignItems: "baseline", justifyContent: "center", fontSize: "clamp(80px, 20.5vw, 296px)", lineHeight: 0.78, fontWeight: 600, letterSpacing: "-0.06em", whiteSpace: "nowrap", userSelect: "none", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + clamp(40px, 6vw, 72px))" }}>
          <span style={{ color: "var(--ink)", opacity: 0.07 }}>Outpost</span><span style={{ display: "inline-block", width: ".13em", height: ".13em", borderRadius: "50%", background: "var(--accent)", marginLeft: ".03em" }} />
        </div>
      </footer>
    </div>
  );
}
