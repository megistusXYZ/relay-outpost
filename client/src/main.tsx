import { createRoot } from "react-dom/client";
import { installAppHistory } from "@/lib/app-history";
import { ensureModalBackListener } from "@/lib/modal-history";
import App from "./App";
import "./index.css";
import { installScrollClickGuard } from "./lib/scroll-click-guard";
import { installRelayFrameGuard } from "./lib/relay-frame-guard";
import { isUnactionableError } from "./lib/error-noise";
import { reportCrash, normalizeErrorEvent, normalizeRejection } from "./lib/crash-report";
import { attachServiceWorkerUpdateSignals } from "./lib/app-update";

// nostr-tools' WebSocket message handler logs caught errors through a debug
// global `window.printer.maybe(...)` that only exists in its author's dev setup.
// In a real browser `window.printer` is undefined, so ANY throw while handling a
// relay message crashes the catch block itself with "reading 'maybe'" — masking
// the real error and tripping the dev runtime-error overlay. Shim it to a no-op
// that routes the original error to console.debug so it's visible but harmless.
declare global {
  interface Window { printer?: { maybe: (...args: unknown[]) => void } }
}
if (typeof window !== "undefined" && !window.printer) {
  window.printer = {
    maybe: (...args: unknown[]) => {
      try { console.debug("[nostr-tools]", ...args); } catch {}
    },
  };
}

// The printer shim above is not enough: nostr-tools' _onmessage catch block
// re-runs JSON.parse on the SAME malformed frame BEFORE it ever calls
// printer.maybe, so a truncated relay frame still escaped as an uncaught
// "JSON Parse error: Unterminated string" (live crash-sig 1ekh2ng). Wrap the
// handler so malformed frames are dropped + logged instead. See
// lib/relay-frame-guard.ts for the full autopsy.
installRelayFrameGuard();

// Own scroll restoration ourselves. Left at the browser default ('auto'), the
// UA ALSO tries to restore scroll on history back/forward — and on real iOS
// Safari / installed PWAs that native restore RACES our per-history-token
// restorer (lib/scroll-restore.ts), landing the page at a stale/half-measured
// offset a frame before our anchor correction runs. The result users see is
// "back jumps to the wrong place / loads sloppy." A headless Chrome run rarely
// exposes this (its native restore is effectively instant and its layout is
// already settled), which is why the #233 feed harness passed while real
// devices still glitched. Setting 'manual' makes OUR restorer the only writer.
if (typeof history !== "undefined" && "scrollRestoration" in history) {
  try { history.scrollRestoration = "manual"; } catch {}
}
// Stamp every history entry with the in-app index BEFORE the router mounts —
// back controls decide with it (lib/app-history.ts), and the first wouter
// navigation must already go through the patched pushState.
installAppHistory();
// Arm the modal-back listener at boot too — a reload-restored dead guard entry
// must be chained through even if no overlay opens this session.
ensureModalBackListener();

// Prevent scroll gestures from registering as taps (accidental dialog opens).
installScrollClickGuard();

// Ask the browser to keep our IndexedDB durable. Without this, under storage
// pressure (notably iOS/Safari, which can evict non-persisted web-app data) the
// DM cache, follow-list cache and notification history get wiped — so DMs
// "disappear" and the app reloads cold/slow. persist() is idempotent and the
// browser grants it heuristically (installed PWA / engagement); harmless if not.
if (typeof navigator !== "undefined" && navigator.storage?.persist) {
  navigator.storage.persisted?.()
    .then((already) => { if (!already) return navigator.storage.persist(); })
    .catch(() => {});
}

// The noise classifiers (WS_NOISE relay churn + BROWSER_NOISE cross-origin
// "Script error." etc.) live in lib/error-noise.ts — shared with the crash
// reporter via isUnactionableError so the two can't drift.

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? "");
  if (isUnactionableError(msg)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  // Non-noise: route into the anonymous crash reporter (opt-out + noise filter +
  // 24h dedup + 5/session cap are all enforced inside reportCrash → claimCrashSlot,
  // which matters more here since the global surface is noisier than a render
  // boundary). Deliberately NO preventDefault — let it still reach the console /
  // dev overlay; reporting is side-effect-free. try/catch: reporting must never
  // throw from a global handler.
  try { reportCrash(normalizeRejection(e.reason), undefined, "rejection"); } catch {}
}, { capture: true });

window.addEventListener("error", (e) => {
  const msg = e.message || (e.error instanceof Error ? e.error.message : "");
  if (isUnactionableError(msg)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  // Resource-load failures (a broken <img>/<script>/<link>) also fire a capture-
  // phase "error" here as a bare Event with no .error and empty .message — that
  // would manufacture a useless "Unknown error" ticket, so skip them. Genuine
  // script errors always carry an error object or a message.
  if (!e.error && !e.message) return;
  try { reportCrash(normalizeErrorEvent(e), undefined, "uncaught"); } catch {}
}, { capture: true });

(function initTypography() {
  // Curated font set — keep in sync with FONT_OPTIONS in Settings.tsx and the
  // Google Fonts <link> in index.html. Values NOT in this map (typos, or fonts
  // removed from the lineup that still live in old localStorage / arrive via
  // NIP-78 sync from another device) render as Inter. The clamp is read-time
  // only and is deliberately NOT written back to storage, so a synced choice
  // from a device that still offers the font is never destroyed.
  const FONT_MAP: Record<string, string> = {
    default: "'Space Mono', 'Courier New', monospace",
    tactical: "'JetBrains Mono', monospace",
    clean: "'Nunito', system-ui, sans-serif",
    inter: "'Inter', system-ui, sans-serif",
    poppins: "'Poppins', system-ui, sans-serif",
    geist: "'Geist', system-ui, sans-serif",
    "space-grotesk": "'Space Grotesk', system-ui, sans-serif",
    analog: "'Lora', 'Georgia', serif",
    playfair: "'Playfair Display', 'Georgia', serif",
    "source-serif": "'Source Serif 4', 'Georgia', serif",
  };
  // Root font size, keyed by the reader Text Size setting. MUST list every
  // value in SIZE_OPTIONS (Settings.tsx) — an unknown value gets clamped to
  // "default" AND written back to localStorage below, so a missing entry
  // here silently reverts the user's saved choice on next boot.
  const SIZE_MAP: Record<string, string> = {
    compact: "16px",
    default: "17px",
    comfortable: "18px",
    large: "20px",
    xlarge: "22px",
  };
  // Post-body text size (clean feed style), keyed by the same reader setting.
  // Kept in sync with SIZE_OPTIONS[].post in Settings.tsx.
  const POST_SIZE_MAP: Record<string, string> = {
    compact: "14px",
    default: "15px",
    comfortable: "16px",
    large: "18px",
    xlarge: "20px",
  };
  try {
    const rawFont = localStorage.getItem("relay-outpost-font") || "inter";
    const rawSize = localStorage.getItem("relay-outpost-font-size") || "default";
    const font = rawFont in FONT_MAP ? rawFont : "inter";
    const size = rawSize in SIZE_MAP ? rawSize : "default";
    // Size clamp may write back (all legit values are in SIZE_MAP, so this
    // only fires on garbage); the font clamp intentionally never does — see
    // the FONT_MAP comment above.
    if (size !== rawSize) localStorage.setItem("relay-outpost-font-size", size);
    const family = FONT_MAP[font];
    const px = SIZE_MAP[size];
    document.documentElement.style.setProperty("--font-body", family);
    document.documentElement.style.setProperty("--post-text-size", POST_SIZE_MAP[size] || "15px");
    document.documentElement.style.fontSize = px;
    document.body.style.fontFamily = `var(--font-body)`;
  } catch {}

  window.addEventListener("nip78-settings-applied", () => {
    try {
      const rawFont = localStorage.getItem("relay-outpost-font") || "inter";
      const rawSize = localStorage.getItem("relay-outpost-font-size") || "default";
      const font = rawFont in FONT_MAP ? rawFont : "inter";
      const size = rawSize in SIZE_MAP ? rawSize : "default";
      const family = FONT_MAP[font];
      const px = SIZE_MAP[size];
      document.documentElement.style.setProperty("--font-body", family);
      document.documentElement.style.setProperty("--post-text-size", POST_SIZE_MAP[size] || "15px");
      document.documentElement.style.fontSize = px;
      document.body.style.fontFamily = `var(--font-body)`;
    } catch {}
  });
})();

createRoot(document.getElementById("root")!).render(<App />);

// Hand off from the inline cold-start splash (client/index.html) to the app.
// Wait two RAFs so React has committed and the browser has painted the first
// frame of real UI underneath the overlay — then fade + remove the splash, so
// there's no flash of an empty #root between the splash disappearing and the
// app appearing. window.__roHideSplash is idempotent and self-removes the node;
// it's also a no-op after the first call and after the index.html failsafe.
declare global {
  interface Window { __roHideSplash?: () => void }
}
(function handOffSplash() {
  const hide = () => { try { window.__roHideSplash?.(); } catch {} };
  if (typeof window === "undefined") return;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(hide));
  } else {
    hide();
  }
  // Safety net: requestAnimationFrame never fires while the tab is hidden
  // (background tab, PWA relaunched while backgrounded), which left the
  // splash up over a fully-loaded app until the 9s "stuck" reload prompt
  // appeared. hide() is idempotent, so when the tab IS visible the RAF path
  // above wins and this is a no-op; when hidden, this still tears the
  // splash down (plain timers keep running in hidden tabs).
  setTimeout(hide, 1500);
})();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Seamless auto-update. The service worker (sw.js) calls skipWaiting() and
  // clients.claim() itself, so a new deploy activates and takes control with
  // no user action. When it takes control, `controllerchange` fires and we
  // reload once to swap the running page onto the new version.
  //
  // To avoid yanking the page out from under someone mid-interaction, the
  // normal (controllerchange) reload is deferred until the tab is backgrounded
  // — so the user comes back to a freshly-loaded latest version instead of
  // watching it reload in front of them. A fallback timer still converges a
  // tab that's left visible indefinitely, and a hard chunk-load failure can
  // force an immediate reload regardless of any pending deferral.
  //
  // `reloadStarted` guards the actual `location.reload()` so it only ever
  // happens once. It is intentionally distinct from "a deferred reload is
  // scheduled": scheduling must NOT block the immediate chunk-error path.
  let reloadStarted = false;
  let reloadScheduled = false;

  const startReload = () => {
    if (reloadStarted) return;
    reloadStarted = true;
    window.location.reload();
  };

  const scheduleSafeReload = () => {
    if (reloadStarted || reloadScheduled) return;
    reloadScheduled = true;
    if (document.visibilityState === 'hidden') {
      startReload();
      return;
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        document.removeEventListener('visibilitychange', onHidden);
        startReload();
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    // Don't let an always-foreground tab sit on the old version forever.
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHidden);
      startReload();
    }, 60 * 1000);
  };

  navigator.serviceWorker.addEventListener('controllerchange', scheduleSafeReload);

  // If a deploy removed a lazy-loaded chunk that the currently-running (old)
  // page still tries to import, the dynamic import 404s. The page is already
  // broken, so reload immediately (overriding any pending deferred reload) to
  // recover into the freshly-served version. A short sessionStorage window
  // prevents a persistently-failing deploy from triggering a reload loop.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault?.();
    try {
      const KEY = 'sw-preload-reload-at';
      const last = Number(sessionStorage.getItem(KEY) || '0');
      if (Date.now() - last < 10 * 1000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {}
    startReload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      // Feed the "Update ready · Restart" pill from this SAME registration —
      // waiting worker / installed-while-controlled / controllerchange all
      // surface a user-facing restart option (lib/app-update.ts). This never
      // changes the deferred auto-reload behavior below; it only adds a
      // user-initiated fast path.
      attachServiceWorkerUpdateSignals(registration);

      // Check for a new version immediately, then periodically, and whenever
      // the tab regains focus — so long-lived tabs and reopened PWAs pick up
      // new deploys promptly. Each check just re-fetches the small sw.js.
      registration.update().catch(() => {});

      setInterval(() => {
        registration.update().catch(() => {});
      }, 5 * 60 * 1000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
    }).catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}
