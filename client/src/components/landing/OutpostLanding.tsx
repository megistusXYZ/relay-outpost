/**
 * The visitor landing (owner, 2026-11-16): the public site's page, ported
 * into the app so a visitor meets the same page at relayop.xyz and in the
 * zip. GalaxyWarpOverlay shows it in "full" mode; every "Create your space"
 * calls onLaunch, which is the overlay's way into the sign-in screen (lead:
 * Create account). The stylesheet is outpost-landing.css, scoped to
 * .outpost-landing; the page's own theme toggle sets the app's theme.
 *
 * Behaviour carried over from the site's script: the headline rolls through
 * twelve languages (a mouse over it returns to English), the demo card has
 * three tabs, Otto's eyes follow the pointer and the card tilts under it,
 * the marks doze after 25 s idle, and the theme switch sweeps out from the
 * toggle where view transitions exist. All of it stands down for
 * prefers-reduced-motion.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { useLocation } from "wouter";
import { useTheme } from "@/hooks/use-theme";
import { InviteGreeting } from "@/components/landing/InviteGreeting";
import { loadSignupDraft } from "@/lib/account-draft";
import { trackSignupEvent } from "@/lib/signup-telemetry";
import "./outpost-landing.css";

const PHRASES: Array<[string, string]> = [
  ["The next phase of the internet", "en"],
  ["La próxima fase de internet", "es"],
  ["La prochaine phase d’internet", "fr"],
  ["Die nächste Phase des Internets", "de"],
  ["A próxima fase da internet", "pt"],
  ["La prossima fase di internet", "it"],
  ["Следующая фаза интернета", "ru"],
  ["インターネットの次の段階", "ja"],
  ["互联网的下一个阶段", "zh"],
  ["인터넷의 다음 단계", "ko"],
  ["इंटरनेट का अगला चरण", "hi"],
  ["المرحلة التالية من الإنترنت", "ar"],
];
const NO_TRACKING = new Set(["ja", "zh", "ko", "hi", "ar"]);
const EASE = "cubic-bezier(.2,.8,.2,1)";

const TABS: Array<[string, string]> = [["New post", "Goes where you choose"], ["Chats", "Encrypted"], ["Live", "On air"]];

function reducedMotion(): boolean {
  try { return !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

const stroke = (w: number): CSSProperties => ({ fill: "none", stroke: "currentColor", strokeWidth: w, strokeLinecap: "round", strokeLinejoin: "round" });
const INK: CSSProperties = { fill: "currentColor" };
const dot: CSSProperties = { display: "inline-block", width: ".15em", height: ".15em", borderRadius: "50%", background: "var(--accent)", marginInlineStart: ".05em" };

/** Otto: the open ring with the Ember dot, and eyes for each mood. */
function Otto({ size, mood, className = "", label }: { size: number; mood: "cycle" | "here"; className?: string; label?: string }) {
  return (
    <svg className={`otto ${mood === "cycle" ? "otto-cycle" : ""} ${className}`} data-mood={mood} viewBox="0 0 100 100" width={size} height={size}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ overflow: "visible" }}>
      <path d="M78.98 42.24 A30 30 0 1 1 57.76 21.02" style={{ fill: "none", stroke: "currentColor", strokeWidth: 9, strokeLinecap: "round" }} />
      <circle className="m m-ask" cx="71.2" cy="28.8" r="12" style={{ fill: "none", stroke: "var(--accent)", strokeWidth: 2, strokeOpacity: 0.45 }} />
      <circle className="dot" cx="71.2" cy="28.8" r="6.5" style={{ fill: "var(--accent)" }} />
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
const chatRow: CSSProperties = { display: "flex", alignItems: "center", gap: 12, minHeight: 56, borderTop: "1px solid var(--line)" };
const avatar = (round: boolean): CSSProperties => ({ flex: "none", width: 38, height: 38, borderRadius: round ? "50%" : 12, background: "var(--inset)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600 });
const panelStyle = (on: boolean): CSSProperties => ({ display: on ? "flex" : "none", flexDirection: "column", gap: 12, minHeight: "clamp(252px, 40vw, 292px)" });
const footLine: CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginTop: "auto", paddingTop: 12, fontSize: 14, color: "var(--ink2)" };
const emberDot: CSSProperties = { width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flex: "none" };
const pillOn: CSSProperties = { fontSize: 13, padding: "6px 12px", borderRadius: 999, background: "var(--btn)", color: "var(--btnink)", border: "1px solid var(--btn)" };
const pillOff: CSSProperties = { fontSize: 13, padding: "6px 12px", borderRadius: 999, border: "1px solid var(--line2)" };
const navCol: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 140 };
const navHead: CSSProperties = { fontSize: 14, fontWeight: 600, color: "var(--ink)", paddingBottom: 8 };
const navLink: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 40, alignSelf: "flex-start", background: "none", border: 0, padding: 0, color: "inherit", cursor: "pointer", font: "inherit" };
const pillarRow: CSSProperties = { position: "relative", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: "12px 72px", alignItems: "start", padding: "clamp(28px, 4.5vw, 40px) 0", borderTop: "1px solid var(--line)" };
const pillarHead: CSSProperties = { margin: 0, fontSize: "clamp(28px, 3.4vw, 42px)", lineHeight: 1.08, fontWeight: 600, letterSpacing: "-0.035em" };
const pillarText = { margin: 0, fontSize: 19, color: "var(--ink2)", textWrap: "pretty" } as CSSProperties;

export function OutpostLanding({ onLaunch }: { onLaunch: () => void }) {
  const [, navigate] = useLocation();
  const { isDark, setTheme } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLSpanElement>(null);
  const [tab, setTab] = useState(0);
  const [asleep, setAsleep] = useState(false);

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
    if (typeof document.startViewTransition !== "function" || reducedMotion()) { apply(); return; }
    html.style.setProperty("--vx", `${e.clientX}px`);
    html.style.setProperty("--vy", `${e.clientY}px`);
    html.classList.add("theming");
    document.startViewTransition(apply).finished.finally(() => html.classList.remove("theming"));
  }, [isDark, setTheme]);

  // The headline rolls through twelve languages; a mouse over it comes home to English.
  useEffect(() => {
    const hd = headlineRef.current;
    if (!hd || reducedMotion()) return;
    const h1 = hd.parentElement;
    let i = 0;
    let t1: number | undefined, t2: number | undefined, t3: number | undefined;
    const show = (o: string, tr: string, f: string, transition: string) => {
      hd.style.transition = transition; hd.style.opacity = o; hd.style.transform = tr; hd.style.filter = f;
    };
    const set = (k: number) => {
      const [text, lang] = PHRASES[k];
      const inner = hd.firstElementChild as HTMLElement | null;
      if (inner) inner.textContent = text;
      hd.lang = lang;
      hd.dir = lang === "ar" ? "rtl" : "ltr";
      hd.style.letterSpacing = NO_TRACKING.has(lang) ? "normal" : "-0.045em";
    };
    const roll = (k: number, then?: () => void) => {
      window.clearTimeout(t2); window.clearTimeout(t3);
      show("0", "translateY(-0.28em)", "blur(6px)", "opacity .5s ease-in, transform .5s ease-in, filter .5s ease-in");
      t2 = window.setTimeout(() => {
        set(k);
        show("0", "translateY(0.28em)", "blur(6px)", "none");
        t3 = window.setTimeout(() => {
          show("1", "none", "blur(0px)", `opacity .85s ${EASE}, transform .85s ${EASE}, filter .85s ease`);
          then?.();
        }, 60);
      }, 520);
    };
    const rot = () => {
      window.clearTimeout(t1);
      t1 = window.setTimeout(() => { i = (i + 1) % PHRASES.length; roll(i, rot); }, i === 0 ? 4600 : 3600);
    };
    const enter = (e: globalThis.PointerEvent) => { if (e.pointerType !== "mouse") return; window.clearTimeout(t1); if (i !== 0) roll(0); };
    const leave = (e: globalThis.PointerEvent) => { if (e.pointerType !== "mouse") return; if (i !== 0) roll(i, rot); else rot(); };
    rot();
    h1?.addEventListener("pointerenter", enter);
    h1?.addEventListener("pointerleave", leave);
    return () => {
      window.clearTimeout(t1); window.clearTimeout(t2); window.clearTimeout(t3);
      h1?.removeEventListener("pointerenter", enter);
      h1?.removeEventListener("pointerleave", leave);
    };
  }, []);

  // Otto's eyes follow the pointer; the card tilts and the dot grids light up under it.
  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || reducedMotion()) return;
    const root = rootRef.current;
    if (!root) return;
    const set = (k: string, v: string) => root.style.setProperty(k, v);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    set("--ex", ((e.clientX / window.innerWidth - 0.5) * 7).toFixed(2));
    set("--ey", ((e.clientY / window.innerHeight - 0.5) * 6).toFixed(2));
    const card = cardRef.current?.getBoundingClientRect();
    if (card) {
      set("--cx", `${(e.clientX - card.left).toFixed(0)}px`);
      set("--cy", `${(e.clientY - card.top).toFixed(0)}px`);
      set("--tx", (clamp((e.clientX - card.left - card.width / 2) / card.width) * 3).toFixed(2));
      set("--ty", (clamp((e.clientY - card.top - card.height / 2) / card.height) * -2.5).toFixed(2));
    }
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
    <div ref={rootRef} className={`outpost-landing${asleep ? " asleep" : ""}`} onPointerMove={onPointerMove} data-testid="outpost-landing">
      <header style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--glass)", WebkitBackdropFilter: "saturate(180%) blur(20px)", backdropFilter: "saturate(180%) blur(20px)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 clamp(16px, 5vw, 24px)", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <a href="#top" onClick={toTop} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>
            <Otto size={34} mood="cycle" /> Outpost
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" className="tap" onClick={onToggleTheme} aria-label="Switch between light and dark" data-testid="landing-theme-toggle"
              style={{ width: 44, height: 44, borderRadius: 999, border: 0, background: "transparent", color: "var(--ink)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="8.2" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.6 }} /><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" style={INK} /></svg>
            </button>
            <button type="button" className="btn" onClick={onLaunch} data-testid="landing-get-outpost"
              style={{ display: "inline-flex", alignItems: "center", height: 44, padding: "0 clamp(14px, 4vw, 18px)", borderRadius: 999, background: "var(--btn)", color: "var(--btnink)", fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" }}>Get Outpost</button>
          </div>
        </div>
      </header>

      <section id="top" ref={heroRef} style={{ position: "relative", padding: "clamp(64px, 9vw, 104px) clamp(16px, 5vw, 24px) clamp(64px, 10vw, 128px)", textAlign: "center", overflow: "hidden" }}>
        <div className="hero-bg" aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
          <div className="drift" style={{ position: "absolute", left: "50%", top: "56%", width: 900, height: 520, marginLeft: -450, borderRadius: "50%", background: "var(--accent)", opacity: "var(--glow)", filter: "blur(120px)" }} />
          <div className="drift2" style={{ position: "absolute", left: "50%", top: "4%", width: 1100, height: 460, marginLeft: -760, borderRadius: "50%", background: "var(--cool)", opacity: "var(--glow2)", filter: "blur(130px)" }} />
          <HeroDoodles />
        </div>
        <div style={{ position: "relative", zIndex: 2, maxWidth: 920, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 28 }}>
          <h1 className="in" aria-label="The next phase of the internet" style={{ margin: 0, display: "grid", justifyItems: "center", fontSize: "clamp(33px, 7.2vw, 88px)", lineHeight: 1.04, fontWeight: 600, textWrap: "balance" } as CSSProperties}>
            <span aria-hidden="true" style={{ gridArea: "1 / 1", visibility: "hidden", letterSpacing: "-0.045em", whiteSpace: "pre-line" }}>Die nächste Phase des Internets</span>
            <span ref={headlineRef} aria-hidden="true" lang="en" dir="ltr" style={{ gridArea: "1 / 1", alignSelf: "center", whiteSpace: "pre-line", wordBreak: "auto-phrase", letterSpacing: "-0.045em" } as unknown as CSSProperties}>
              <span style={{ whiteSpace: "pre-line" }}>The next phase of the internet</span><span aria-hidden="true" style={dot} />
            </span>
          </h1>
          <p className="in" style={{ margin: 0, maxWidth: 640, fontSize: "clamp(18px, 2.1vw, 23px)", lineHeight: 1.42, color: "var(--ink2)", textWrap: "pretty", animationDelay: ".34s" } as CSSProperties}>Post, chat, go live and bring your people together, all in one place that belongs to you.</p>
          <InviteGreeting />
          <div className="in" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 20, marginTop: 8, animationDelay: ".44s" }}>
            <button type="button" className="btn" onClick={onLaunch} style={btnStyle} data-testid="button-engage-warp">Create your space</button>
          </div>
          <p className="in" style={{ margin: 0, fontSize: 14, color: "var(--ink2)", animationDelay: ".52s" }}>Free. Open source. No email or phone number.</p>
          {resumable && (
            <button type="button" className="tap pill" data-testid="button-resume-signup"
              onClick={() => { trackSignupEvent("resume_chip_tapped"); onLaunch(); }}
              style={{ height: 40, padding: "0 16px", borderRadius: 999, fontSize: 14, cursor: "pointer" }}>
              Resume signup{draftName ? ` as ${draftName}` : ""}
            </button>
          )}
          <a href="/discover" onClick={go("/discover")} className="quiet-link in" style={{ animationDelay: ".58s" }} data-testid="link-look-around">Look around first</a>
        </div>

        <div className="in" style={{ position: "relative", zIndex: 1, maxWidth: 560, margin: "clamp(48px, 8vw, 88px) auto 0", animationDelay: ".62s" }}>
          <div className="hero-card" style={{ position: "relative" }}>
            <div ref={cardRef} className="tilt" style={{ position: "relative", textAlign: "left", background: "var(--cardglass)", WebkitBackdropFilter: "blur(28px) saturate(170%)", backdropFilter: "blur(28px) saturate(170%)", border: "1px solid var(--line)", borderRadius: 28, boxShadow: "var(--shadow), inset 0 1px 0 var(--hi)", padding: "clamp(16px, 4.5vw, 22px)", display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="edge" aria-hidden="true" style={{ position: "absolute", inset: -1, borderRadius: 29, padding: 1.5, pointerEvents: "none", background: "radial-gradient(220px circle at var(--cx, 50%) var(--cy, -300px), var(--accent), transparent 70%)", WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)", WebkitMaskComposite: "xor", mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 36 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 600 }}><span>{TABS[tab][0]}</span></div>
                <span style={{ fontSize: 13, color: "var(--ink2)" }}>{TABS[tab][1]}</span>
              </div>

              <div style={panelStyle(tab === 0)}>
                <div style={{ background: "var(--inset)", borderRadius: 18, padding: "16px 18px", fontSize: 16, lineHeight: 1.4 }}>Doors open at ten on Saturday. Bring a laptop and one idea you have been putting off.</div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--ink2)", width: 62 }}>Goes to</span>
                  <span style={pillOff}>Everyone</span>
                  <span style={pillOn}>Your people</span>
                  <span style={pillOff}>One community</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, color: "var(--ink2)", width: 62 }}>When</span>
                  <span style={pillOff}>Now</span>
                  <span style={pillOn}>Friday 9:00</span>
                </div>
                <div style={footLine}><span aria-hidden="true" style={emberDot} /><span>No ranking system decides who sees it.</span></div>
              </div>

              <div style={panelStyle(tab === 1)}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={chatRow}>
                    <span aria-hidden="true" style={avatar(true)}>D</span>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>Dana</span>
                      <span style={{ fontSize: 13, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Sent you the slides</span>
                    </div>
                    <span style={{ flex: "none", fontSize: 13, color: "var(--ink2)" }}>9:12</span>
                  </div>
                  <div style={chatRow}>
                    <span aria-hidden="true" style={avatar(false)}>F</span>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>Family</span>
                      <span style={{ fontSize: 13, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Group chat · Sunday lunch is at ours</span>
                    </div>
                    <span style={{ flex: "none", fontSize: 13, color: "var(--ink2)" }}>8:40</span>
                  </div>
                  <div style={chatRow}>
                    <span aria-hidden="true" style={avatar(true)}>M</span>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>Marco</span>
                      <span style={{ fontSize: 13, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>See you Saturday</span>
                    </div>
                    <span style={{ flex: "none", fontSize: 13, color: "var(--ink2)" }}>Mon</span>
                  </div>
                </div>
                <div style={footLine}><span aria-hidden="true" style={emberDot} /><span>Encrypted. The servers that carry them cannot read them.</span></div>
              </div>

              <div style={panelStyle(tab === 2)}>
                <div style={{ position: "relative", height: 150, borderRadius: 18, background: "#0A0C10", color: "#F3F5F8", padding: "14px 16px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.14)" }}><span className="pulse-dot" aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF6A3D" }} />Live</span>
                  <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>Saturday workshop, from the room</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
                  <span><strong style={{ fontWeight: 600 }}>Dana</strong> <span style={{ color: "var(--ink2)" }}>This is great, thank you</span></span>
                  <span><strong style={{ fontWeight: 600 }}>Marco</strong> <span style={{ color: "var(--ink2)" }}>Sent a tip</span></span>
                </div>
                <div style={footLine}><span aria-hidden="true" style={emberDot} /><span>Stream to your followers, with chat built in.</span></div>
              </div>

              <div role="group" aria-label="What Outpost does" style={{ display: "flex", flexWrap: "wrap", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                {(["Post", "Chats", "Live"] as const).map((name, i) => (
                  <button key={name} type="button" className="tap pill" aria-pressed={tab === i} onClick={() => setTab(i)} data-testid={`landing-tab-${i}`}
                    style={{ height: 44, padding: "0 16px", borderRadius: 999, fontSize: 15, cursor: "pointer" }}>{name}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section style={{ position: "relative", zIndex: 3, background: "var(--bg)", borderTop: "1px solid var(--line)", padding: "clamp(72px, 11vw, 120px) clamp(16px, 5vw, 24px)" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", flexDirection: "column", gap: "clamp(36px, 6vw, 64px)" }}>
          <h2 className="inks" style={{ margin: 0, maxWidth: 900, fontSize: "clamp(26px, 6.6vw, 64px)", lineHeight: 1.06, fontWeight: 600, letterSpacing: "-0.04em", textWrap: "balance" } as CSSProperties}>
            <span style={{ display: "block" }}>Public when you want it.</span>{" "}
            <span style={{ display: "block" }}>Private when you don’t<span aria-hidden="true" style={dot} /></span>
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
              <span>And Otto, an assistant that works only for you, arrives in 2027.</span>
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
          <Otto size={132} mood="here" className="float" label="Otto, pleased" />
          <h2 style={{ margin: 0, fontSize: "clamp(40px, 6vw, 76px)", lineHeight: 1.02, fontWeight: 600, letterSpacing: "-0.045em", textWrap: "balance" } as CSSProperties}>Start with a space that’s yours<span aria-hidden="true" style={dot} /></h2>
          <button type="button" className="btn" onClick={onLaunch} style={{ ...btnStyle, marginTop: 8 }} data-testid="landing-closing-cta">Create your space</button>
        </div>
      </section>

      <footer style={{ position: "relative", overflow: "hidden", background: "var(--bg)", borderTop: "1px solid var(--line)", padding: "clamp(56px, 8vw, 88px) clamp(16px, 5vw, 24px) 0" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", display: "flex", flexDirection: "column", gap: "clamp(40px, 6vw, 64px)", fontSize: 15, color: "var(--ink2)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "40px 64px" }}>
            <div style={{ flex: "1 1 280px", maxWidth: 360, display: "flex", flexDirection: "column", gap: 14 }}>
              <a href="#top" onClick={toTop} style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44, alignSelf: "flex-start", color: "var(--ink)", fontSize: 19, fontWeight: 600, letterSpacing: "-0.02em" }}>
                <Otto size={30} mood="cycle" /> Outpost
              </a>
              <p style={{ margin: 0, textWrap: "pretty" } as CSSProperties}>One place to post, chat, go live and gather your people. It belongs to you.</p>
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
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "8px 32px", borderTop: "1px solid var(--line)", paddingTop: 24, fontSize: 14 }}>
            <span>MIT licensed. No ads, no trackers.</span>
            <span>Built on Nostr, an open network no company owns.</span>
          </div>
        </div>
        <div aria-hidden="true" style={{ maxWidth: 1120, margin: "clamp(32px, 5vw, 64px) auto 0", display: "flex", alignItems: "baseline", justifyContent: "center", fontSize: "clamp(80px, 20.5vw, 296px)", lineHeight: 0.78, fontWeight: 600, letterSpacing: "-0.06em", whiteSpace: "nowrap", userSelect: "none", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + clamp(40px, 6vw, 72px))" }}>
          <span style={{ color: "var(--ink)", opacity: 0.07 }}>Outpost</span><span style={{ display: "inline-block", width: ".13em", height: ".13em", borderRadius: "50%", background: "var(--accent)", marginLeft: ".03em" }} />
        </div>
      </footer>
    </div>
  );
}
