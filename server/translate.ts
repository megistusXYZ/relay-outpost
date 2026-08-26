/**
 * Free server-side translation fallback — the layer that makes "Translate
 * foreign posts" work for EVERY browser (Safari/iOS included) at $0.
 *
 * The client's engine order is: on-device browser translation (private,
 * instant — Chrome/Edge) → THIS proxy → NIP-90 DVMs (none live today).
 * The proxy forwards to Google's public web-translation endpoint
 * (client=gtx — keyless; the same endpoint FOSS translation extensions use).
 * It is UNOFFICIAL and treated as best-effort: any failure returns 502 and
 * the client degrades gracefully (its capability gate hides the Translate UI
 * whenever this endpoint is unreachable).
 *
 * Scope guard: only PUBLIC post text ever reaches this route — the client
 * structurally restricts encrypted surfaces (DMs, Concord) to on-device
 * translation. Costs: one outbound fetch per unique (text, target), 24h
 * server cache, rate-limited per IP (see index.ts), 5k-char cap.
 */
import type { Express, Request, Response } from "express";
import { TTLCache } from "./ttl-cache";

const MAX_CHARS = 5000;
const OUTBOUND_TIMEOUT_MS = 8000;

// One day: post text is immutable, so a repeat translation is pure waste.
const cache = new TTLCache<{ text: string; from: string }>(500, 24 * 60 * 60 * 1000);

/** Parse the gtx nested-array response: [[["<seg>", "<orig>", …], …], _, "<detectedLang>", …].
 *  Returns null on any unexpected shape (the endpoint is unofficial). */
export function parseGtxResponse(data: unknown): { text: string; from: string } | null {
  if (!Array.isArray(data)) return null;
  const segs = data[0];
  if (!Array.isArray(segs)) return null;
  const text = segs
    .map((s) => (Array.isArray(s) && typeof s[0] === "string" ? s[0] : ""))
    .join("");
  if (!text.trim()) return null;
  const from = typeof data[2] === "string" && data[2] ? data[2].slice(0, 5) : "und";
  return { text, from };
}

export function registerTranslateRoute(app: Express) {
  app.post("/api/translate", async (req: Request, res: Response) => {
    const q = typeof req.body?.q === "string" ? req.body.q : "";
    const target = typeof req.body?.target === "string" ? req.body.target.toLowerCase() : "";
    if (!q.trim()) return res.status(400).json({ error: "q required" });
    if (q.length > MAX_CHARS) return res.status(413).json({ error: `q too long (max ${MAX_CHARS} chars)` });
    if (!/^[a-z]{2}$/.test(target)) return res.status(400).json({ error: "target must be an ISO-639-1 code" });

    const key = `${target}:${q}`;
    const hit = cache.get(key);
    if (hit) return res.json(hit);

    try {
      const r = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=" + target, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: new URLSearchParams({ q }),
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      });
      if (!r.ok) return res.status(502).json({ error: "translator unavailable" });
      const parsed = parseGtxResponse(await r.json());
      if (!parsed) return res.status(502).json({ error: "unexpected translator response" });
      cache.set(key, parsed);
      res.json(parsed);
    } catch {
      res.status(502).json({ error: "translator unavailable" });
    }
  });
}
