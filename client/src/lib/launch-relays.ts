/**
 * Open the relays the app warms at launch, and tell the splash's relay ring
 * (client/index.html, window.__roSplashRelay) about each one: "open" when we
 * start connecting, "up" only once the socket really opened. ensureRelay
 * resolving is the reachability signal; EOSE is not (RELAY_REACHABILITY.md).
 * Once the splash is gone the hook ignores reports, so this runs the same on
 * every call.
 */
type SplashState = "open" | "up";

function tellSplash(url: string, state: SplashState): void {
  try {
    (globalThis as { __roSplashRelay?: (url: string, state: SplashState) => void }).__roSplashRelay?.(url, state);
  } catch { /* the splash is decoration; it never blocks a connection */ }
}

export function openLaunchRelays(
  urls: readonly string[],
  ensure: (url: string) => Promise<unknown>,
  on: { connected?: (url: string, ms: number) => void; failed?: (url: string) => void } = {},
): void {
  for (const url of urls) {
    const start = Date.now();
    tellSplash(url, "open");
    ensure(url).then(
      () => {
        tellSplash(url, "up");
        on.connected?.(url, Date.now() - start);
      },
      () => on.failed?.(url),
    );
  }
}
