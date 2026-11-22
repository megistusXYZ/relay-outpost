/**
 * Relay addresses for scheduled posts. This server publishes them later by
 * opening a socket to each relay, so an address is checked twice: its shape
 * when the post is scheduled (isSchedulableRelayUrl), and where its name
 * resolves when the server connects (connectScheduledRelay).
 */
import { Relay } from "nostr-tools";
import type WebSocket from "ws";
import { validateHostSafety } from "./net-safety";
import { CappedWebSocket } from "./relay-socket";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** A ws(s) address with a public-looking DNS name: no user part, no bare IP, no local name. */
export function isSchedulableRelayUrl(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "wss:" && u.protocol !== "ws:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (!HOSTNAME.test(host)) return false; // also refuses bare IPv4/IPv6 and single labels
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  return true;
}

/** How long a relay gets to finish connecting before the scheduler moves on. */
export const RELAY_CONNECT_TIMEOUT_MS = 8_000;

/**
 * nostr-tools types `new Relay(url, options)` as taking only enablePing and
 * enableReconnect, but its constructor hands every option on to AbstractRelay,
 * which also takes the socket class to use.
 */
export type RelayOptions = NonNullable<ConstructorParameters<typeof Relay>[1]> & {
  websocketImplementation?: typeof globalThis.WebSocket;
};

/**
 * Open a relay with a time limit. nostr-tools' `Relay.connect` drops its
 * options, so with no limit a host that accepts the connection and never
 * answers the upgrade kept the caller waiting forever. The relay's own
 * `connect({ timeout })` gives up, but its `close()` only closes a socket
 * that finished connecting, so a failed connect aborts the socket here.
 * The socket class is passed in rather than taken from a global, which
 * Node 20 (production) doesn't have, and carries the message size cap.
 */
export async function openRelay(url: string, timeoutMs: number = RELAY_CONNECT_TIMEOUT_MS): Promise<Relay> {
  const relay = new Relay(url, { websocketImplementation: CappedWebSocket as unknown as typeof globalThis.WebSocket } as RelayOptions);
  try {
    await relay.connect({ timeout: timeoutMs });
  } catch (err) {
    try { (relay as unknown as { ws?: WebSocket }).ws?.terminate(); } catch { /* already gone */ }
    try { relay.close(); } catch { /* already closed */ }
    throw err;
  }
  return relay;
}

interface ConnectDeps {
  isPublicHost: (hostname: string) => Promise<boolean>;
  connect: (url: string, timeoutMs: number) => Promise<Relay>;
}

const defaultDeps: ConnectDeps = {
  isPublicHost: validateHostSafety,
  connect: openRelay,
};

/**
 * Connect to a scheduled post's relay, or null when the address is refused.
 * Rejects with "timed out" when the relay hasn't connected in `timeoutMs`:
 * the scheduler publishes one batch at a time, so one relay that never
 * answered used to hold every later run, and no one's posts went out.
 */
export async function connectScheduledRelay(
  url: string,
  deps: ConnectDeps = defaultDeps,
  timeoutMs: number = RELAY_CONNECT_TIMEOUT_MS,
): Promise<Relay | null> {
  if (!isSchedulableRelayUrl(url)) return null;
  if (!(await deps.isPublicHost(new URL(url).hostname))) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gaveUp = false;
  const connecting = deps.connect(url, timeoutMs);
  // A relay that connects after we gave up is closed, not left open.
  connecting.then((late) => { if (gaveUp) late.close(); }, () => {});
  try {
    return await Promise.race([
      connecting,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { gaveUp = true; reject(new Error(`relay connection timed out after ${timeoutMs} ms`)); }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
