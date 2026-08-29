import { Agent } from "undici";
import { resolveVettedAddresses } from "./net-safety";

/**
 * fetch() that re-validates the destination host against SSRF on EVERY hop AND
 * pins the connection to the vetted IP.
 *
 * Two bugs this closes:
 *  1. Redirect-follow SSRF — several proxies validated only the INITIAL hostname,
 *     then let fetch transparently follow a 3xx to a new host, so a public URL
 *     could 302 the server into the private network (169.254.169.254, loopback,
 *     RFC1918) and some reflected the internal response. Every hop is validated.
 *  2. DNS-rebinding TOCTOU — validating a hostname and then letting fetch resolve
 *     it AGAIN at connect time is a race: a hostile DNS server can answer a public
 *     IP during the check and a private IP at connect. Here we resolve ONCE, vet
 *     the addresses, and PIN the socket to exactly those IPs (undici Agent with a
 *     fixed lookup) — the original hostname is still used for TLS SNI + Host, so
 *     certificates validate normally, but the connection can't be rebound.
 *
 * Only http(s) is permitted.
 */

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT = 10000;

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** An undici dispatcher whose DNS lookup only ever returns the vetted IPs, so a
 *  connection can't be rebound to a different address after validation. */
function pinnedAgent(addresses: string[]): Agent {
  // Params are loosely typed to satisfy undici's LookupFunction across versions;
  // the behavior (proven on the wire) is: always return the vetted IPs, honoring
  // the `all` flavor when undici asks for the full list.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lookup = (_hostname: string, options: any, cb: any): void => {
    const entries = addresses.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }));
    if (options && options.all) return cb(null, entries);
    return cb(null, entries[0].address, entries[0].family);
  };
  return new Agent({
    keepAliveTimeout: 1,
    keepAliveMaxTimeout: 10,
    connect: { lookup },
  });
}

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;

  let current = url;
  let method = opts.method ?? "GET";
  let body = opts.body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new Error("safeFetch: invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("safeFetch: only http(s) URLs are allowed");
    }
    const vetted = await resolveVettedAddresses(parsed.hostname);
    if (!vetted) {
      throw new Error("safeFetch: host failed SSRF safety check");
    }
    const agent = pinnedAgent(vetted);

    const resp = await fetch(current, {
      method,
      headers: opts.headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      // undici (Node's fetch impl) reads `dispatcher`; not in the DOM types.
      dispatcher: agent,
    } as RequestInit & { dispatcher: Agent });

    const isRedirect = [301, 302, 303, 307, 308].includes(resp.status);
    const location = isRedirect ? resp.headers.get("location") : null;
    if (!isRedirect || !location) {
      // Final response (or a redirect with no Location we can follow): the caller
      // reads its body, so we can't close the agent here. keepAliveTimeout:1ms
      // drops the socket right after the read.
      return resp;
    }

    // Following a redirect: release this hop's socket/agent before the next hop.
    try { await resp.body?.cancel(); } catch { /* already drained */ }
    try { await agent.close(); } catch { /* best-effort */ }

    current = new URL(location, current).href;
    // Match fetch's method handling across redirects: 303 (and 301/302 on POST)
    // downgrade to GET with no body; 307/308 preserve the method.
    if (resp.status === 303 || ((resp.status === 301 || resp.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
  }
  throw new Error("safeFetch: too many redirects");
}
