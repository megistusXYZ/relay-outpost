/**
 * Free server-side translation fallback — the layer that makes "Translate
 * foreign posts" work for EVERY browser (Safari/iOS included) at $0.
 *
 * The client's engine order is: on-device browser translation (private,
 * instant — Chrome/Edge) → THIS proxy → NIP-90 DVMs (none live today).
 * The proxy forwards to Google's public web-translation endpoints — keyless
 * and UNOFFICIAL, so there are two lanes and the proxy sticks with whichever
 * last answered: client=gtx (the one FOSS translation extensions use) and
 * client=dict-chrome-ex (Chrome's dictionary extension). Google 429-blocks
 * gtx for some egress IPs — production's, as of 2026-10-10, which left the
 * proxy answering 502 for everyone and the client's fail-closed gate hiding
 * every Translate link (owner: a new account on an iPhone, Chinese posts, no
 * link). Any failure on every lane returns 502 and the client degrades
 * gracefully (its capability gate hides the Translate UI).
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

/** Parse the dict-chrome-ex wire shape: `[["<text>", "<detectedLang>"]]` with
 *  sl=auto, a bare `["<text>"]` with an explicit source. Null on anything else. */
export function parseDictChromeExResponse(data: unknown): { text: string; from: string } | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (typeof first === "string") return first.trim() ? { text: first, from: "und" } : null;
  if (!Array.isArray(first) || typeof first[0] !== "string" || !first[0].trim()) return null;
  const from = typeof first[1] === "string" && first[1] ? first[1].slice(0, 5) : "und";
  return { text: first[0], from };
}

type Fetcher = (url: string, init?: RequestInit) => Promise<globalThis.Response>;
type Translated = { text: string; from: string };

const FORM = { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" };
const LANES: { name: string; url: (target: string) => string; parse: (data: unknown) => Translated | null }[] = [
  { name: "gtx", url: (t) => "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=" + t, parse: parseGtxResponse },
  { name: "dict", url: (t) => "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=" + t, parse: parseDictChromeExResponse },
];

export function registerTranslateRoute(app: Express, opts: { fetcher?: Fetcher } = {}) {
  const fetcher: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, init));
  // The lane that last answered goes first: a blocked lane costs a round
  // trip per post otherwise, and keeps poking the host that blocked us.
  let preferred = 0;

  const askLane = async (lane: (typeof LANES)[number], q: string, target: string): Promise<Translated | null> => {
    try {
      const r = await fetcher(lane.url(target), { method: "POST", headers: FORM, body: new URLSearchParams({ q }), signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) });
      if (!r.ok) return null;
      return lane.parse(await r.json());
    } catch {
      return null;
    }
  };

  app.post("/api/translate", async (req: Request, res: Response) => {
    const q = typeof req.body?.q === "string" ? req.body.q : "";
    const target = typeof req.body?.target === "string" ? req.body.target.toLowerCase() : "";
    if (!q.trim()) return res.status(400).json({ error: "q required" });
    if (q.length > MAX_CHARS) return res.status(413).json({ error: `q too long (max ${MAX_CHARS} chars)` });
    if (!/^[a-z]{2}$/.test(target)) return res.status(400).json({ error: "target must be an ISO-639-1 code" });

    const key = `${target}:${q}`;
    const hit = cache.get(key);
    if (hit) return res.json(hit);

    for (let i = 0; i < LANES.length; i++) {
      const idx = (preferred + i) % LANES.length;
      const parsed = await askLane(LANES[idx], q, target);
      if (parsed) {
        preferred = idx;
        cache.set(key, parsed);
        return res.json(parsed);
      }
    }
    res.status(502).json({ error: "translator unavailable" });
  });
}
