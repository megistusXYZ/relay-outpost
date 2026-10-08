/**
 * POST /api/nip86 — the relay console's management calls (NIP-86 plus
 * newlay's extensions), forwarded to the relay with the operator's signed
 * NIP-98 authorization. Moved out of routes.ts (2026-10-08) so it can be
 * exercised end to end against a relay that checks requests the way newlay
 * does (client/src/lib/nip86-wire.test.ts).
 */
import type { Express } from "express";
import { NIP86_METHODS } from "@shared/nip86-methods";
import { safeFetch } from "./safe-fetch";
import { validateHostSafety } from "./net-safety";

/**
 * `fetcher` is production's safeFetch (SSRF-checked, pinned). Only the wire
 * test passes another, to reach the fake relay it runs on loopback.
 */
export function applyNip86Proxy(app: Express, { fetcher = safeFetch }: { fetcher?: typeof safeFetch } = {}): void {
  // One list with the client's (shared/nip86-methods.ts).
  const NIP86_ALLOWED_METHODS = new Set<string>(NIP86_METHODS);

  app.post("/api/nip86", async (req, res) => {
    try {
      const { relayUrl, method, params, authEvent } = req.body;
      if (!relayUrl || typeof relayUrl !== "string") {
        return res.status(400).json({ error: "Missing relayUrl" });
      }
      if (!method || typeof method !== "string" || !NIP86_ALLOWED_METHODS.has(method)) {
        return res.status(400).json({ error: "Invalid or unsupported NIP-86 method" });
      }
      // A list of JSON values (newlay takes on/off, null, numbers and objects
      // as well as text). Anything else would be forwarded as a malformed call.
      if (params !== undefined && params !== null && !Array.isArray(params)) {
        return res.status(400).json({ error: "params must be a list" });
      }

      const httpUrl = relayUrl
        .replace(/^wss:\/\//, "https://")
        .replace(/^ws:\/\//, "http://");
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(httpUrl);
      } catch {
        return res.status(400).json({ error: "Invalid relay URL" });
      }

      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return res.status(400).json({ error: "Relay URL must use http(s) or ws(s) protocol" });
      }

      // Dev only: a local test relay (ws://localhost:PORT) is a legitimate
      // management target. Production keeps the full SSRF guard.
      const devLocalRelay = process.env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1"].includes(parsedUrl.hostname.toLowerCase());
      const isSafe = devLocalRelay || await validateHostSafety(parsedUrl.hostname);
      if (!isSafe) {
        return res.status(403).json({ error: "Relay hostname failed safety check" });
      }

      const normalizedUrl = parsedUrl.origin + parsedUrl.pathname.replace(/\/+$/, "");
      const body = JSON.stringify({ method, params: params || [] });

      const headers: Record<string, string> = {
        "Content-Type": "application/nostr+json+rpc",
        "Accept": "application/nostr+json+rpc, application/json",
      };

      if (authEvent) {
        headers["Authorization"] = "Nostr " + Buffer.from(JSON.stringify(authEvent)).toString("base64");
      }

      const urlsToTry = [normalizedUrl];
      const base = parsedUrl.origin;
      if (normalizedUrl === base || normalizedUrl === base + "/") {
        urlsToTry.push(base + "/api", base + "/rpc");
      }

      let lastResponseText = "";
      let lastStatus = 0;
      let lastContentType = "";

      for (const tryUrl of urlsToTry) {
        const tryHeaders = { ...headers };
        if (authEvent) {
          tryHeaders["Authorization"] = "Nostr " + Buffer.from(JSON.stringify(authEvent)).toString("base64");
        }

        console.log(`[NIP-86 proxy] → POST ${tryUrl} | method=${method} | hasAuth=${!!authEvent}`);
        try {
          // safeFetch re-validates the host on every redirect hop so a relay
          // URL can't 302 this authenticated POST into the private network.
          const response = await fetcher(tryUrl, {
            method: "POST",
            headers: tryHeaders,
            body,
            timeoutMs: 10000,
          });

          const responseText = await response.text();
          // Don't log the response body — relay-admin responses can carry
          // sensitive management data. Status + content-type are enough to debug.
          console.log(`[NIP-86 proxy] ← status=${response.status} | content-type=${response.headers.get("content-type")} | len=${responseText.length}`);
          lastResponseText = responseText;
          lastStatus = response.status;
          lastContentType = response.headers.get("content-type") || "";

          if (response.status === 401 || response.status === 403) {
            try {
              const data = JSON.parse(responseText);
              return res.status(response.status).json(data);
            } catch {}
            return res.status(response.status).json({ error: `HTTP ${response.status}` });
          }

          if (!response.ok) {
            try {
              const errData = JSON.parse(responseText);
              if (errData.error) return res.status(response.status).json(errData);
            } catch {}
            continue;
          }

          try {
            const data = JSON.parse(responseText);
            if (data && typeof data === "object" && ("result" in data || "error" in data)) {
              return res.status(response.status).json(data);
            }
          } catch {}

          const trimmed = responseText.trim().toLowerCase();
          const isHtml = trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<head") || trimmed.startsWith("<body");
          if (isHtml) {
            console.log(`[NIP-86 proxy] ${tryUrl} returned HTML, trying next URL...`);
            continue;
          }
        } catch (fetchErr) {
          console.log(`[NIP-86 proxy] ${tryUrl} failed: ${fetchErr instanceof Error ? fetchErr.message : "unknown"}`);
          continue;
        }
      }

      const trimmed = lastResponseText.trim().toLowerCase();
      const isHtml = trimmed.startsWith("<!doctype") || trimmed.startsWith("<html") || trimmed.startsWith("<head") || trimmed.startsWith("<body");

      // Report WHY we ended up here, not just that we did.
      //
      // Every branch above funnels into this one response, so a relay that
      // 502'd behind its reverse proxy (HTML error page) was indistinguishable
      // from a relay happily serving its landing page — and the client read
      // both as "this relay doesn't support NIP-86". `upstreamStatus` is 0 when
      // no request ever completed (DNS, refused, timeout) and 5xx when the
      // relay's own server failed; neither is an answer about NIP-86 support.
      return res.status(200).json({
        error: isHtml
          ? "Relay returned an HTML page instead of JSON-RPC — NIP-86 HTTP handler may not be configured"
          : "Relay returned non-JSON response",
        isHtml,
        upstreamStatus: lastStatus,
        // Deliberately NOT echoing the upstream body: if a relay URL were pointed
        // at an internal service, reflecting its bytes here would turn this into a
        // read-capable SSRF. A length is enough to debug "empty vs non-JSON".
        bodyLength: lastResponseText.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown proxy error";
      return res.status(502).json({ error: `NIP-86 proxy error: ${message}` });
    }
  });
}
