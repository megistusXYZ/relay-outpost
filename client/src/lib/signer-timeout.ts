import type { ISigner } from "applesauce-signers";

export const SIGNER_SIGN_TIMEOUT = 30_000;
// 8s was too tight: extensions queue prompts and a user reading an approval
// dialog (or a busy signer processing other encrypt/decrypt calls) routinely
// needs longer, causing spurious "signer didn't respond" failures. 20s gives
// real headroom while still surfacing a genuinely dead signer.
export const SIGNER_CRYPTO_TIMEOUT = 20_000;

export class SignerTimeoutError extends Error {
  constructor(operation = "signEvent", ms = SIGNER_SIGN_TIMEOUT) {
    super(`Signer did not respond within ${Math.round(ms / 1000)}s (${operation})`);
    this.name = "SignerTimeoutError";
  }
}

let _reconnectInFlight = false;
export function isReconnectInFlight() { return _reconnectInFlight; }
export function setReconnectInFlight(v: boolean) { _reconnectInFlight = v; }

// Rate-limit the "Signer reconnected" toast. On mobile, backgrounding/foregrounding
// the app (and transient op-timeouts from main-thread jank) can trigger the
// reconnect path repeatedly; without this the toast spams the user. Shared across
// every emission point so it fires at most once per window regardless of path.
let _lastReconnectToastAt = 0;
export function canShowReconnectToast(now = Date.now()): boolean {
  if (now - _lastReconnectToastAt < 30_000) return false;
  _lastReconnectToastAt = now;
  return true;
}

let _bypassTimeout = false;
export function isSignerTimeoutBypassed() { return _bypassTimeout; }
export function setSignerTimeoutBypass(v: boolean) { _bypassTimeout = v; }

function emitSignerFailure(err: unknown) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("signer-failure", { detail: { error: err } }));
  }
}

export function withSignerTimeout<T>(promise: Promise<T>, ms: number, operation = "operation"): Promise<T> {
  if (_bypassTimeout && operation === "signEvent") {
    return promise;
  }
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SignerTimeoutError(operation, ms)), ms);
    }),
  ]).finally(() => clearTimeout(timer!)).catch((err) => {
    if (err instanceof SignerTimeoutError) emitSignerFailure(err);
    throw err;
  });
}

export async function signWithTimeout(
  signer: ISigner,
  eventTemplate: Parameters<ISigner["signEvent"]>[0],
  timeoutMs = SIGNER_SIGN_TIMEOUT,
): Promise<ReturnType<ISigner["signEvent"]>> {
  return withSignerTimeout(signer.signEvent(eventTemplate), timeoutMs, "signEvent") as ReturnType<ISigner["signEvent"]>;
}

export function isSignerError(err: unknown): boolean {
  if (err instanceof SignerTimeoutError) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("denied") || msg.includes("rejected") || msg.includes("cancelled") || msg.includes("user refused")) return false;
    return msg.includes("signer") || msg.includes("extension") || msg.includes("not available") || msg.includes("no signer");
  }
  return false;
}

export async function handleSignerError(
  err: unknown,
  // `variant` is the toast's own union (not a loose `string`): as a loose string it
  // sat contravariantly wrong vs. useToast's `toast`, so every `handleSignerError(err, toast, …)`
  // call site failed to type-check. This union is assignable from both the real
  // `toast` and the hand-rolled `toastFn` adapters, clearing those errors.
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void,
  attemptReconnect?: () => Promise<boolean>,
): Promise<void> {
  if (!(err instanceof SignerTimeoutError) && !isSignerError(err)) throw err;

  if (attemptReconnect && !_reconnectInFlight) {
    _reconnectInFlight = true;
    const startedAt = Date.now();
    try {
      const ok = await attemptReconnect();
      if (ok) {
        if (Date.now() - startedAt > 2000 && canShowReconnectToast()) {
          toast({ title: "Signer reconnected", description: "Please try your action again." });
        }
        return;
      }
    } finally {
      _reconnectInFlight = false;
    }
  }

  if (typeof window !== "undefined") {
    const banner = document.querySelector('[data-testid="banner-signer-disconnected"]');
    if (banner) banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  toast({
    title: "Signer unavailable",
    description: err instanceof SignerTimeoutError
      ? "Your signer didn't respond in time. Use the \"Reconnect\" button in the banner at the top of the page, or check your extension/remote signer."
      : "Could not complete signing. Use the \"Reconnect\" button in the banner at the top of the page to restore signing.",
    variant: "destructive",
  });
}
