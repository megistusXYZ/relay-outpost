// The page's side of launching from the cached shell (client/public/sw.js).
//
// The worker answers every launch from its cached page and fetches the fresh
// one behind it, so a load can run the previous build (stale by one launch).
// Two things follow:
//  - the worker posts "ro-shell-updated" when the page it served was out of
//    date: the honest "an update is ready" signal (lib/app-update.ts);
//  - every reload meant to move onto a new build first asks the worker to
//    fetch and keep the fresh page, or the reload would be answered from the
//    old cache again.

type SwContainer = Pick<ServiceWorkerContainer, "controller" | "addEventListener" | "removeEventListener">;

const container = (): SwContainer | undefined =>
  typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;

export function onShellUpdated(cb: () => void, sw: SwContainer | undefined = container()): () => void {
  if (!sw) return () => {};
  const handler = (e: MessageEvent) => {
    if (e?.data && typeof e.data === "object" && e.data.type === "ro-shell-updated") cb();
  };
  sw.addEventListener("message", handler as EventListener);
  return () => sw.removeEventListener("message", handler as EventListener);
}

/** Ask the worker to fetch and keep the fresh page. True once it has. */
export function refreshShell(sw: SwContainer | undefined = container(), timeoutMs = 3000): Promise<boolean> {
  const worker = sw?.controller;
  if (!worker || typeof MessageChannel === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, timeoutMs);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(!!e.data?.ok);
    };
    try {
      worker.postMessage({ type: "ro-refresh-shell" }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/** Reload onto the newest build: refresh the worker's page first, then reload
 *  whatever the outcome, so a restart always happens. */
export async function reloadOntoFreshShell(
  reload: () => void = () => window.location.reload(),
  sw: SwContainer | undefined = container(),
): Promise<void> {
  try { await refreshShell(sw); } catch {}
  reload();
}
