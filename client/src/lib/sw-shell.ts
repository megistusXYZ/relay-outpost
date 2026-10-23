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

/**
 * Ask the worker whether this page runs an older build than the page it has
 * kept. Replaces relying on "ro-shell-updated" alone, which the worker posts
 * while a launching page may not be listening yet. The worker answers once
 * this launch's fresh page has arrived (it caps its own wait at 10 s).
 */
export function askShellStatus(
  build: string | null,
  sw: SwContainer | undefined = container(),
  timeoutMs = 12000,
): Promise<boolean> {
  const worker = sw?.controller;
  if (!build || !worker || typeof MessageChannel === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, timeoutMs);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(e.data?.outdated === true);
    };
    try {
      worker.postMessage({ type: "ro-shell-status", build }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/** The build this page runs: the name of the script that starts it (as the worker reads it). */
export function runningBuild(doc: Document = document): string | null {
  for (const s of Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const m = /\/assets\/(index-[A-Za-z0-9_-]+)\.js/.exec(s.getAttribute("src") || "");
    if (m) return m[1];
  }
  return null;
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

/**
 * What "Repair app" does, without the reload: unregister every service worker
 * and delete every Cache Storage cache. Logins are untouched (localStorage and
 * IndexedDB are not Cache Storage). Every step is best-effort and the whole
 * thing is capped, so whoever reloads next is never left waiting on it.
 */
export async function dropWorkerAndCaches(
  env: {
    sw?: Pick<ServiceWorkerContainer, "getRegistrations"> | undefined;
    caches?: Pick<CacheStorage, "keys" | "delete"> | undefined;
  } = {
    sw: typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
    caches: typeof caches !== "undefined" ? caches : undefined,
  },
  timeoutMs = 4000,
): Promise<void> {
  const work = (async () => {
    try {
      const regs = (await env.sw?.getRegistrations?.()) || [];
      await Promise.allSettled(regs.map((r) => r.unregister()));
    } catch {}
    try {
      const keys = (await env.caches?.keys()) || [];
      await Promise.allSettled(keys.map((k) => env.caches!.delete(k)));
    } catch {}
  })();
  await Promise.race([work, new Promise<void>((done) => setTimeout(done, timeoutMs))]);
}
