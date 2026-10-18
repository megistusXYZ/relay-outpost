import { Agent, fetch as undiciFetch } from "undici";
import { resolveVettedAddresses } from "./net-safety";

/**
 * The one way the server fetches a URL someone else chose. It re-validates the
 * destination host against SSRF on EVERY hop AND pins the connection to the
 * vetted IP.
 *
 * Two bugs this closes:
 *  1. Redirect-follow SSRF — a fetcher that validates only the INITIAL hostname
 *     and then lets fetch follow a 3xx can be sent into the private network
 *     (169.254.169.254, loopback, RFC1918). Every hop is validated here.
 *  2. DNS-rebinding TOCTOU — validating a hostname and then letting fetch resolve
 *     it AGAIN at connect time is a race: a hostile DNS server can answer a public
 *     IP during the check and a private IP at connect. Here we resolve ONCE, vet
 *     the addresses, and PIN the socket to exactly those IPs. The original
 *     hostname is still used for TLS SNI + Host, so certificates validate.
 *
 * undici's own fetch is used with its own Agent: pairing the npm Agent with
 * Node's built-in fetch has broken response headers on some Node versions.
 *
 * Only http(s) is permitted. A refusal throws SafeFetchBlocked.
 */

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT = 10000;

export class SafeFetchBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafeFetchBlocked";
  }
}

export type SafeResponse = Awaited<ReturnType<typeof undiciFetch>>;

export interface SafeFetchOptions {
  method?: string;
  /** Fixed headers, or headers worked out for each hop's URL (e.g. a Referer). */
  headers?: Record<string, string> | ((url: URL) => Record<string, string>);
  body?: string;
  timeoutMs?: number;
  /** Redirects to follow. When they run out, the redirect itself is returned. */
  maxRedirects?: number;
  /** For sites with very large response headers. */
  maxHeaderSize?: number;
  /** An outer abort, e.g. one budget shared with a body read. */
  signal?: AbortSignal;
  /**
   * "all" (default): timeoutMs bounds the whole exchange, body included.
   * "headers": it bounds only the wait for the final response's headers, for
   * callers that stream a body which may legitimately arrive slowly.
   */
  timeoutCovers?: "all" | "headers";
}

/** An undici dispatcher whose DNS lookup only ever returns the vetted IPs, so a
 *  connection can't be rebound to a different address after validation. */
function pinnedAgent(addresses: string[], maxHeaderSize?: number): Agent {
  // Params are loosely typed to satisfy undici's LookupFunction across versions;
  // the behavior is: always return the vetted IPs, honoring the `all` flavor
  // when undici asks for the full list.
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
    ...(maxHeaderSize ? { maxHeaderSize } : {}),
  });
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export async function safeFetch(url: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const headersOnly = opts.timeoutCovers === "headers";
  const headerTimer = new AbortController();
  const timer = headersOnly ? setTimeout(() => headerTimer.abort(new DOMException("timed out", "TimeoutError")), timeoutMs) : null;
  const timeoutSignal = headersOnly ? headerTimer.signal : AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  try {
    return await fetchHops(url, opts, signal);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchHops(url: string, opts: SafeFetchOptions, signal: AbortSignal): Promise<SafeResponse> {
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;

  let current = url;
  let method = opts.method ?? "GET";
  let body = opts.body;

  for (let hop = 0; ; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      throw new SafeFetchBlocked("safeFetch: invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SafeFetchBlocked("safeFetch: only http(s) URLs are allowed");
    }
    const vetted = await resolveVettedAddresses(parsed.hostname.replace(/^\[|\]$/g, ""));
    if (!vetted) {
      throw new SafeFetchBlocked("safeFetch: host failed SSRF safety check");
    }
    const agent = pinnedAgent(vetted, opts.maxHeaderSize);
    const headers = typeof opts.headers === "function" ? opts.headers(parsed) : opts.headers;

    const resp = await undiciFetch(current, {
      method,
      headers,
      body,
      redirect: "manual",
      signal,
      dispatcher: agent,
    });

    const location = REDIRECTS.has(resp.status) ? resp.headers.get("location") : null;
    if (!location || hop >= maxRedirects) {
      // Final response (or a redirect we were told not to follow): the caller
      // reads its body, so the agent can't be closed here. keepAliveTimeout:1ms
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
}

/** What readBodyCapped needs from a response (undici's and the DOM's both fit). */
interface BodySource {
  headers: { get(name: string): string | null };
  body: {
    cancel(): Promise<void>;
    getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> };
  } | null;
}

/**
 * Read a response body up to maxBytes. Returns null — without buffering the
 * rest — when the declared length or the bytes actually sent pass the cap.
 * With truncate, returns the first maxBytes instead (for reading just the
 * start of a page).
 */
export async function readBodyCapped(
  resp: BodySource,
  maxBytes: number,
  opts: { truncate?: boolean } = {},
): Promise<Buffer | null> {
  const declared = parseInt(resp.headers.get("content-length") || "", 10);
  if (!opts.truncate && Number.isFinite(declared) && declared > maxBytes) {
    try { await resp.body?.cancel(); } catch { /* ignore */ }
    return null;
  }
  if (!resp.body) return Buffer.alloc(0);
  const reader = resp.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (received + value.length > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      if (!opts.truncate) return null;
      chunks.push(Buffer.from(value.subarray(0, maxBytes - received)));
      return Buffer.concat(chunks);
    }
    received += value.length;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
