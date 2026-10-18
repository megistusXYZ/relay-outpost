/**
 * Relay addresses for scheduled posts. This server publishes them later by
 * opening a socket to each relay, so an address is checked twice: its shape
 * when the post is scheduled (isSchedulableRelayUrl), and where its name
 * resolves when the server connects (connectScheduledRelay).
 */
import { Relay } from "nostr-tools";
import { validateHostSafety } from "./net-safety";

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

interface ConnectDeps {
  isPublicHost: (hostname: string) => Promise<boolean>;
  connect: (url: string) => Promise<Relay>;
}

const defaultDeps: ConnectDeps = {
  isPublicHost: validateHostSafety,
  connect: (url) => Relay.connect(url),
};

/** Connect to a scheduled post's relay, or null when the address is refused. */
export async function connectScheduledRelay(url: string, deps: ConnectDeps = defaultDeps): Promise<Relay | null> {
  if (!isSchedulableRelayUrl(url)) return null;
  if (!(await deps.isPublicHost(new URL(url).hostname))) return null;
  return deps.connect(url);
}
