import { useEffect, useMemo, useRef, useState } from "react";
import { getRestoreDebugState, scrollRestoreDebugEnabled } from "@/lib/scroll-restore";

/**
 * On-screen scroll-restore diagnostics — SHIPS DARK. Renders nothing unless
 * `localStorage.debug-scroll-restore === "1"` (the existing flag). The app has no
 * iOS-PWA console, so three prior fixes went undiagnosed; this turns the next
 * device test into hard numbers instead of a guess. Zero cost when the flag is
 * off (early return before any polling).
 *
 * To enable on a device: DevTools/remote or in-app console, run
 *   localStorage.setItem("debug-scroll-restore", "1")
 * then reload. Reproduce feed → reply-thread → back and screenshot this readout.
 * Disable with localStorage.removeItem("debug-scroll-restore").
 */
export function ScrollRestoreDebugOverlay() {
  const enabled = useMemo(() => scrollRestoreDebugEnabled(), []);
  const [, force] = useState(0);
  const rafRef = useRef<number>(0);

  // The witness for "the page moved under the reader": the saved anchor row's
  // position in the CONTENT (its on-screen top plus scrollTop), read after each
  // frame paints. Scrolling does not change it; content growing above the row
  // does. Counts per history entry, resets when the entry changes.
  const motionRef = useRef({ token: null as string | null, last: null as number | null, moves: 0, max: 0 });
  // The witness for "a post on screen that isn't drawn": WebKit can leave a
  // `content-visibility: auto` post skipped while it scrolls into view (the
  // blank cards on profiles and threads, 2026-10-04). checkVisibility with
  // contentVisibilityAuto says whether its contents are being skipped.
  // Counts frames with one on screen, since the page loaded.
  const skipRef = useRef({ frames: 0, most: 0, supported: null as boolean | null });

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const ch = typeof MessageChannel !== "undefined" ? new MessageChannel() : null;
    if (ch) {
      ch.port1.onmessage = () => {
        if (!alive) return;
        const sk = skipRef.current;
        let onScreenSkipped = 0;
        for (const post of document.querySelectorAll<HTMLElement>(".feed-post-item")) {
          const r = post.getBoundingClientRect();
          if (r.bottom <= 0 || r.top >= innerHeight || r.height < 40 || post.closest("[inert]")) continue;
          const inner = post.firstElementChild as (HTMLElement & { checkVisibility?: (o: object) => boolean }) | null;
          if (!inner?.checkVisibility) { sk.supported = false; break; }
          sk.supported = true;
          if (!inner.checkVisibility({ contentVisibilityAuto: true })) onScreenSkipped++;
        }
        if (onScreenSkipped) { sk.frames++; sk.most = Math.max(sk.most, onScreenSkipped); }
        const st = getRestoreDebugState();
        const m = motionRef.current;
        if (m.token !== st.token) { m.token = st.token; m.last = null; m.moves = 0; m.max = 0; }
        const c = document.querySelector<HTMLElement>(".feed-scroll-container");
        const id = st.saved?.anchorId;
        const el = id && c ? c.querySelector<HTMLElement>(`[data-event-id="${cssEscape(id)}"]:not([inert] *)`) : null;
        if (!c || !el) { m.last = null; return; }
        const abs = Math.round(el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop);
        if (m.last != null && Math.abs(abs - m.last) > 2) { m.moves++; m.max = Math.max(m.max, Math.abs(abs - m.last)); }
        m.last = abs;
      };
    }
    const tick = () => {
      if (!alive) return;
      force((n) => (n + 1) & 0xffff);
      ch?.port2.postMessage(0);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      ch?.port1.close();
    };
  }, [enabled]);

  if (!enabled) return null;

  const s = getRestoreDebugState();
  const container = typeof document !== "undefined"
    ? document.querySelector<HTMLElement>(".feed-scroll-container")
    : null;
  const scrollTop = container ? Math.round(container.scrollTop) : null;
  const anchorId = s.saved?.anchorId ?? null;
  const anchorInDom = !!(anchorId && container?.querySelector(`[data-event-id="${cssEscape(anchorId)}"]`));

  const phaseColor =
    s.phase === "active" ? "#4ade80" : s.phase === "pending" ? "#fbbf24" : "#64748b";

  const row = (label: string, value: string, color?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ color: color ?? "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        top: "calc(4.5rem + env(safe-area-inset-top, 0px))",
        right: 8,
        zIndex: 2147483647,
        pointerEvents: "none",
        width: 232,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(2, 6, 23, 0.86)",
        color: "#e2e8f0",
        font: "11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        border: "1px solid rgba(148,163,184,0.25)",
      }}
      data-testid="scroll-restore-debug-overlay"
    >
      <div style={{ fontWeight: 700, marginBottom: 4, letterSpacing: 0.3 }}>scroll-restore</div>
      {row("phase", s.phase, phaseColor)}
      {row("settle ms", s.phase === "active" ? String(s.activeElapsedMs) : "—")}
      {row("token", s.token ? s.token.slice(0, 10) : "—")}
      {row("saved.scrollTop", s.saved ? String(Math.round(s.saved.scrollTop)) : "—")}
      {row("saved.index", s.saved?.anchorIndex != null ? String(s.saved.anchorIndex) : "—")}
      {row("saved.intraOff", s.saved?.intraOffset != null ? String(Math.round(s.saved.intraOffset)) : "—")}
      {row("anchorId", anchorId ? anchorId.slice(0, 8) : "—")}
      {row("anchor in DOM", anchorInDom ? "yes" : "no", anchorInDom ? "#4ade80" : "#f87171")}
      {row("cur scrollTop", scrollTop != null ? String(scrollTop) : "—")}
      {row(
        "Δ to saved",
        s.saved && scrollTop != null ? String(Math.round(scrollTop - s.saved.scrollTop)) : "—",
      )}
      {row("held px", container?.style.paddingTop ? container.style.paddingTop : "—")}
      {row("undrawn on screen", skipRef.current.supported === false ? "n/a" : `${skipRef.current.frames} frames (max ${skipRef.current.most})`, skipRef.current.frames ? "#f87171" : "#4ade80")}
      {row("moved under reader", `${motionRef.current.moves}× (max ${motionRef.current.max}px)`, motionRef.current.moves ? "#f87171" : "#4ade80")}
    </div>
  );
}

// Local CSS.escape shim (querySelector value safety) without depending on the
// global being present in every runtime.
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\\]#.:]/g, "\\$&");
}
