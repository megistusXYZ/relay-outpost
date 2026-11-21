/**
 * Open the relays the app warms at launch and report each outcome: connected
 * (with how long it took) once the socket really opened, or failed.
 * ensureRelay resolving is the reachability signal; EOSE is not
 * (RELAY_REACHABILITY.md).
 */
export function openLaunchRelays(
  urls: readonly string[],
  ensure: (url: string) => Promise<unknown>,
  on: { connected?: (url: string, ms: number) => void; failed?: (url: string) => void } = {},
): void {
  for (const url of urls) {
    const start = Date.now();
    ensure(url).then(
      () => on.connected?.(url, Date.now() - start),
      () => on.failed?.(url),
    );
  }
}
