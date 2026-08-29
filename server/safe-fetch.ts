import { validateHostSafety } from "./net-safety";

/**
 * fetch() that re-validates the destination host against SSRF on EVERY hop.
 *
 * The bug this closes: several proxies validated only the INITIAL hostname, then
 * let fetch transparently follow a 3xx to a new host — so a public URL could
 * 302 the server into the cluster's private network (169.254.169.254, loopback,
 * RFC1918), and some of those proxies then reflected the internal response to
 * the caller. Here the initial host is validated AND each redirect target is
 * re-validated before we follow it. Only http(s) is permitted.
 *
 * This is the same manual-redirect + per-hop-validate pattern the well-guarded
 * endpoints (/api/og, /api/stream/proxy) already use, extracted so every
 * outbound fetcher can share one door. (DNS-rebinding TOCTOU is handled at the
 * network layer by the cluster egress policy, which also backstops any fetch
 * path that doesn't route through here.)
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
    if (!(await validateHostSafety(parsed.hostname))) {
      throw new Error("safeFetch: host failed SSRF safety check");
    }

    const resp = await fetch(current, {
      method,
      headers: opts.headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (![301, 302, 303, 307, 308].includes(resp.status)) return resp;
    const location = resp.headers.get("location");
    if (!location) return resp;

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
