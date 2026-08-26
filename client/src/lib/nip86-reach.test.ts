/**
 * "This relay has no management API" vs "we couldn't reach this relay".
 *
 * checkNip86Support drives more than a sentence: AccessControlTab routes every
 * allow/ban to localStorage whenever the status isn't "supported". So a relay
 * that was merely DOWN told its operator it lacks NIP-86 and quietly swallowed
 * their moderation.
 *
 * The payloads below are REAL — captured from our own /api/nip86 proxy against
 * a relay returning 502 from nginx and a live strfry relay with no NIP-86
 * handler. That matters: my first attempt at this fix matched on the error
 * STRING, and would have missed the 502 entirely, because the proxy answers
 * HTTP 200 with an identical `isHtml` body in both cases. The only thing that
 * separates them is the upstream status, which the proxy used to discard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/nostr", () => ({
  pool: { subscribeMany: vi.fn(), ensureRelay: vi.fn() },
  DEFAULT_RELAYS: [] as string[],
  eventStore: { add: vi.fn(), getReplaceable: vi.fn() },
  publishEvent: vi.fn(),
}));
vi.mock("./nip42-auth", () => ({ getGlobalSigner: () => null }));
vi.mock("./nip11", () => ({
  fetchNip11: async () => null,
  supportsNip: () => false,
}));

import { checkNip86Support } from "./nip86";

/** Verbatim from the proxy against wss://tigerbalm.feeds.relay.tools (down). */
const DOWN_RELAY_BODY = {
  error: "Relay returned an HTML page instead of JSON-RPC — NIP-86 HTTP handler may not be configured",
  isHtml: true,
  upstreamStatus: 502,
  raw: "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx/1.29.8</center>\r\n</body>\r\n</html>\r\n",
};

/** Verbatim from the proxy against wss://nos.lol (up, genuinely no NIP-86). */
const NO_NIP86_BODY = {
  error: "Relay returned an HTML page instead of JSON-RPC — NIP-86 HTTP handler may not be configured",
  isHtml: true,
  upstreamStatus: 200,
  raw: "<html> <head> <title>strfry: a nostr relay</title>",
};

const respondWith = (body: unknown, status = 200) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
};

beforeEach(() => { vi.unstubAllGlobals(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("checkNip86Support", () => {
  it("a relay that is DOWN is unreachable, not unsupported", async () => {
    respondWith(DOWN_RELAY_BODY);
    expect(await checkNip86Support("wss://down.example")).toBe("unreachable");
  });

  it("a live relay with no NIP-86 handler is genuinely not_supported", async () => {
    // Same error string, same isHtml, same HTTP 200 from our proxy. Only
    // upstreamStatus separates this from the case above.
    respondWith(NO_NIP86_BODY);
    expect(await checkNip86Support("wss://live.example")).toBe("not_supported");
  });

  it("a dead proxy fetch is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    expect(await checkNip86Support("wss://offline.example")).toBe("unreachable");
  });

  it("a 5xx from our own proxy is unreachable", async () => {
    respondWith({ error: "NIP-86 proxy error: boom" }, 502);
    expect(await checkNip86Support("wss://proxyfail.example")).toBe("unreachable");
  });

  it("a relay that answers the protocol is supported", async () => {
    respondWith({ result: [] });
    expect(await checkNip86Support("wss://good.example")).toBe("supported");
  });

  it("an auth refusal still proves it speaks NIP-86", async () => {
    respondWith({ error: "unauthorized" }, 401);
    expect(await checkNip86Support("wss://strict.example")).toBe("supported");
  });
});
