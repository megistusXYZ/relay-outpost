import { useEffect, useRef, useState } from "react";
import { isIaCollapsed } from "@/lib/ia-prefs";
import { postAuthLandingPath, markLanded } from "@/lib/ia-landing";
import { useLocation } from "wouter";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { UserPlus } from "lucide-react";
import { LoginOptions } from "@/components/LoginOptions";
import { OttoMark } from "@/components/OttoMark";
import { isAddAccountPending, clearAddAccountPending } from "@/lib/account-registry";
import { isNewAccount } from "@/lib/local-account";
import { isWelcomed } from "@/lib/welcome";

function BrandLogo({ className }: { className?: string }) {
  // Outpost look (owner, 2026-11-18): the Otto mark and the name in ink, like
  // the rail and the Classic sidebar — no boxed wordmark, no flicker or glow.
  return (
    <div className={`flex items-center gap-3 ${className || ""}`} data-testid="login-brand">
      <OttoMark size={44} className="shrink-0" />
      <span className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-foreground">Relay Outpost</span>
    </div>
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
    // A brand-new account meets the welcome once, from here too: this page's
    // redirect used to omit the account state, so anyone who signed up on
    // /login (not the landing overlay) never saw it (owner audit, 2026-10-10).
    const account = { isNew: isNewAccount(pubkey), welcomed: isWelcomed(pubkey) };
    let dest = postAuthLandingPath(null, isIaCollapsed(), account);
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
        dest = postAuthLandingPath(localStorage.getItem("relay-outpost-default-landing-page"), isIaCollapsed(), account);
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
      {/* A plain page in the visitor's theme, with the landing's soft glow (owner,
          2026-11-18): no cockpit photo, no scanlines, no scrim. */}
      <div className="fixed inset-0 z-0 pointer-events-none signin-surface" aria-hidden="true" />

      <div className="w-full max-w-md md:max-w-5xl space-y-8 relative z-10">
        <div className="flex flex-col items-center space-y-4">
          <BrandLogo />
        </div>

        {addMode && (
          <div
            className="rounded-2xl border border-border bg-card px-4 py-3 flex items-start gap-2.5"
            data-testid="login-add-account-banner"
          >
            <UserPlus className="w-4 h-4 mt-0.5 shrink-0 text-foreground" />
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
              Signer in another browser or app? Sign in here with a QR code or your key —
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
