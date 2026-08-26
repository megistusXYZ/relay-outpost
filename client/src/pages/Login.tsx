import { useEffect, useRef, useState } from "react";
import { isIaCollapsed } from "@/lib/ia-prefs";
import { postAuthLandingPath, markLanded } from "@/lib/ia-landing";
import { useLocation } from "wouter";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { Radio, UserPlus } from "lucide-react";
import { LoginOptions } from "@/components/LoginOptions";
import { isAddAccountPending, clearAddAccountPending } from "@/lib/account-registry";

function BrandLogo({ className }: { className?: string }) {
  return (
    <div className={`flex items-center rounded-md overflow-hidden brand-flicker ${className || ""}`}>
      <div className="flex items-center bg-black pl-4 pr-2 h-12 border-2 border-r-0 border-white rounded-l-md">
        <span className="font-brand font-bold text-lg tracking-[0.2em] text-white uppercase leading-none">Relay</span>
      </div>
      <div className="flex items-center justify-center h-12 bg-black border-y-2 border-white">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
          <g clipPath="url(#clip0_login)">
            <path d="M5.64999 7.64999L2.85001 4.85001C2.54001 4.54001 2.76001 4 3.20001 4H6.79001C6.92001 4 7.05001 4.04999 7.14001 4.14999L12.14 9.14999C12.45 9.45999 12.23 10 11.79 10H8.5C6.57 10 5 11.57 5 13.5C5 15.43 6.57 17 8.5 17H10L12.15 19.15C12.46 19.46 12.24 20 11.8 20H8.51001C4.92001 20 2.01001 17.09 2.01001 13.5C2.01001 11.01 3.41001 8.84 5.48001 7.75L5.64999 7.64999Z" fill="white" />
            <path d="M18.35 16.35L21.15 19.15C21.46 19.46 21.24 20 20.8 20H17.21C17.08 20 16.95 19.95 16.86 19.85L11.86 14.85C11.55 14.54 11.77 14 12.21 14H15.5C17.43 14 19 12.43 19 10.5C19 8.57 17.43 7 15.5 7H14L11.85 4.85001C11.54 4.54001 11.76 4 12.2 4H15.49C19.08 4 21.99 6.91 21.99 10.5C21.99 12.99 20.59 15.16 18.52 16.25L18.35 16.35Z" fill="white" />
          </g>
          <defs>
            <clipPath id="clip0_login">
              <rect width="24" height="24" />
            </clipPath>
          </defs>
        </svg>
      </div>
      <div className="flex items-center bg-black pl-2 pr-4 h-12 border-2 border-l-0 border-white rounded-r-md">
        <span className="font-brand font-bold text-lg tracking-[0.2em] text-white uppercase leading-none">Outpost</span>
      </div>
    </div>
  );
}

/** CRT scanlines — white-on-dark by construction, so dark mode only. */
function ScanlineOverlay() {
  return (
    <div
      // `hidden dark:block`, not just a faint opacity: the lines are drawn in
      // rgba(255,255,255,.08), which over a light canvas is either invisible or
      // a haze that lightens the page for no reason. A texture that only reads
      // on a dark surface should not be painted on a light one.
      className="pointer-events-none fixed inset-0 z-50 opacity-[0.03] hidden dark:block"
      style={{
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.08) 1px, rgba(255,255,255,0.08) 2px)",
        backgroundSize: "100% 2px",
      }}
    />
  );
}

// Coordinates with ImportKeyFlow: when an import has just signed the user
// in but is still showing the post-login passkey-enrollment nudge, we
// must keep this page mounted so the nudge UI renders. Otherwise our
// pubkey-watching effect would race the nudge to /outpost and unmount
// ImportKeyFlow before the user ever sees the offer.
//
// The flag value is a Date.now() timestamp written by ImportKeyFlow.
// Anything older than PASSKEY_NUDGE_MAX_AGE_MS is treated as stale —
// if the user killed the tab abnormally during the nudge step, we don't
// want a future re-mount to hold an authenticated user on the login
// page indefinitely. The passkey nudge UI is a few taps; 5 minutes is
// generous and well past any legitimate flow time.
const PASSKEY_NUDGE_FLAG = "relay-outpost-passkey-nudge-pending";
const PASSKEY_NUDGE_EVENT = "relay-outpost-passkey-nudge-state-change";
const PASSKEY_NUDGE_MAX_AGE_MS = 5 * 60 * 1000;

function readPasskeyNudgePending(): boolean {
  try {
    const raw = sessionStorage.getItem(PASSKEY_NUDGE_FLAG);
    if (!raw) return false;
    // Legacy "1" payload (older tabs that wrote before the timestamp
    // change) — treat as fresh. Newly written values are timestamps.
    if (raw === "1") return true;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    if (Date.now() - ts > PASSKEY_NUDGE_MAX_AGE_MS) {
      try { sessionStorage.removeItem(PASSKEY_NUDGE_FLAG); } catch {}
      return false;
    }
    return true;
  } catch { return false; }
}

// Friendly label for the place the user was headed before the sign-in bounce,
// so a deep link (e.g. a shared DM link) shows intent instead of a bare page.
function readPendingIntent(): string {
  try {
    const dest = sessionStorage.getItem("relay-outpost-post-auth-redirect") || "";
    if (dest.startsWith("/messages")) return "your conversation";
    if (dest && dest !== "/") return "where you left off";
  } catch {}
  return "";
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { pubkey } = useNostrAuth();
  const [passkeyNudgePending, setPasskeyNudgePending] = useState<boolean>(() => readPasskeyNudgePending());
  // Read once on mount — the stash is consumed right after login.
  const [pendingIntent] = useState<string>(() => readPendingIntent());
  // Add-account mode: the account switcher opened this page while ALREADY
  // signed in. The current account stays signed in (its credentials are
  // mirrored per-pubkey by the account registry); whatever account signs in
  // here is ADDED to the registry and becomes the active one. We keep the
  // page mounted for the original pubkey and only leave once the pubkey
  // actually changes — via a FULL navigation, so the newly-added account
  // boots with zero state bled over from the previous one.
  const [addMode] = useState<boolean>(() => isAddAccountPending());
  const initialPubkeyRef = useRef<string | null>(pubkey);
  useEffect(() => () => { if (addMode) clearAddAccountPending(); }, [addMode]);

  useEffect(() => {
    const sync = () => setPasskeyNudgePending(readPasskeyNudgePending());
    sync();
    window.addEventListener(PASSKEY_NUDGE_EVENT, sync);
    // Self-healing: re-evaluate every 10s so a stale flag (older than
    // PASSKEY_NUDGE_MAX_AGE_MS) never strands an authenticated user
    // here for the entire mount, even if no event fires.
    const interval = window.setInterval(sync, 10_000);
    return () => {
      window.removeEventListener(PASSKEY_NUDGE_EVENT, sync);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!pubkey) return;
    if (passkeyNudgePending) return; // Defer redirect — ImportKeyFlow has more UI to show.
    // Add-account mode: the original account is still active — stay here so
    // the user can pick a sign-in method for the account they're adding.
    if (addMode && pubkey === initialPubkeyRef.current) return;
    // Same rule as AppLayout's post-auth landing: under the collapsed IA,
    // "/search" is Discover, and Decision 8 says everyone lands on Chats. The
    // stashed deep link below still wins over both.
    let dest = postAuthLandingPath(null, isIaCollapsed());
    try {
      // A stashed deep link (e.g. a Concord invite incl. its #fragment secret)
      // wins over the default landing page: consume it here so an account
      // created FROM an invite goes straight back to /invite/…#… instead of
      // flashing /search and relying on AppLayout's second redirect.
      const stashed = sessionStorage.getItem("relay-outpost-post-auth-redirect");
      if (stashed && stashed.startsWith("/")) {
        dest = stashed;
        sessionStorage.removeItem("relay-outpost-post-auth-redirect");
      } else {
        dest = postAuthLandingPath(localStorage.getItem("relay-outpost-default-landing-page"), isIaCollapsed());
      }
      sessionStorage.setItem("relay-outpost-landing-redirected", "1");
      // This IS the arrival — mark it, so AppLayout's IA rule does not perform
      // a second one. Only the other key was written here before.
      markLanded();
    } catch {}
    // Add-mode completes exactly like a normal login: client-side redirect,
    // session stays in memory. (A hard reload here would bounce a freshly
    // created password-protected account straight into its own unlock
    // prompt.) Cross-account residue for the in-place A→B transition is
    // handled by NostrAuthContext's pubkey-transition cleanup + nip78's
    // handleAccountSwitch — the deliberate full reload applies to
    // switchAccount() between EXISTING accounts, where no live session for
    // the target exists in memory anyway.
    if (addMode) clearAddAccountPending();
    setLocation(dest);
  }, [pubkey, setLocation, passkeyNudgePending, addMode]);

  if (pubkey && !passkeyNudgePending && !(addMode && pubkey === initialPubkeyRef.current)) return null;

  return (
    <div className="relative h-[100dvh] w-full overflow-y-auto" data-testid="page-login">
      <div className="min-h-full flex flex-col items-center justify-center px-4 py-8">
      {/* Space cockpit backdrop — mirrors the in-app sign-in flow (GalaxyWarpOverlay
          cockpit mode) exactly so /login, reached via "Sign in / Transmit", feels
          identical instead of a plain page. The image is intentionally very subtle:
          opacity 0.1 with a vertical fade mask over a dark scrim — the same treatment
          the landing cockpit uses. Sits above the global SpaceBackground stars,
          below the content. */}
      {/* THEME-AWARE, and it was not. The scrim below used to be a flat
          `bg-black/50` painted in both themes — so a reader who had chosen light
          mode, arrived here from the light Help pages, and got 50% black laid
          over a light canvas. The result was neither: a muddy off-white with the
          cockpit ghosting through it, the eyebrow and the "takes 30 seconds"
          line washed down to nearly nothing.

          Worth being precise about the cause, because the page was NOT written
          dark-only — LoginOptions already picks light values throughout
          (`text-brand/85`, `from-foreground … dark:from-white`). The content was
          theme-aware and the backdrop simply never was, which is why light mode
          looked broken rather than merely dark.

          So the scrim and the scanlines are dark-mode only, and the cockpit is
          faint-but-present in light. A dark scrim exists to sink a photo into a
          dark page; over a light page it just makes mud. */}
      <div className="fixed inset-0 z-0 pointer-events-none" aria-hidden="true">
        <div className="absolute inset-0 dark:bg-black/50" />
        <div
          className="absolute inset-0 bg-cover bg-center opacity-[0.06] dark:opacity-10"
          style={{
            backgroundImage: "url(/images/landing/cockpit-bg.webp)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, #000 24%, #000 50%, transparent 82%)",
            maskImage: "linear-gradient(to bottom, transparent 0%, #000 24%, #000 50%, transparent 82%)",
          }}
        />
      </div>
      <ScanlineOverlay />

      <div className="w-full max-w-md md:max-w-5xl space-y-8 relative z-10">
        <div className="flex flex-col items-center space-y-4">
          <BrandLogo />
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2">
              <div className="h-px w-8 bg-border" />
              <Radio className="w-3 h-3 text-muted-foreground" />
              <div className="h-px w-8 bg-border" />
            </div>
          </div>
        </div>

        {addMode && (
          <div
            className="rounded-lg border border-brand/25 bg-brand/[0.07] px-4 py-3 flex items-start gap-2.5"
            data-testid="login-add-account-banner"
          >
            <UserPlus className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
            <div className="space-y-0.5 text-left">
              <p className="text-sm text-foreground font-medium">Adding another account</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your current account stays signed in on this device — you can switch between accounts any time.
              </p>
            </div>
          </div>
        )}

        {pendingIntent && (
          <div
            className="rounded-lg border border-brand/25 bg-brand/[0.07] px-4 py-3 text-center space-y-1.5"
            data-testid="login-pending-intent"
          >
            <p className="text-sm text-foreground">
              Sign in to continue to <span className="font-medium text-brand">{pendingIntent}</span>.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Signer in another browser or app? Sign in here with a QR code or your secret key —
              or open this link in the browser where your signer lives.
            </p>
          </div>
        )}

        <LoginOptions
          variant="page"
          onBack={() => setLocation("/")}
        />

      </div>
      </div>
    </div>
  );
}
