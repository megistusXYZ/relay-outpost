/**
 * Proxy for the GrapeRank scoring service: sign-in challenge, per-person
 * scores, setup and recalculation. The caller's access_token header is passed
 * through. A key in the path is part of the upstream URL, so only a
 * 64-character hex key is forwarded (lower-cased); anything else is a 400 and
 * never reaches upstream — an encoded slash can't reach other upstream paths.
 */
import type { Express, Request, Response } from "express";

export const GRAPERANK_UPSTREAM = "https://brainstormserver.nosfabrica.com";

const HEX_KEY = /^[0-9a-f]{64}$/i;

export function registerGrapeRankProxy(
  app: Express,
  opts: { upstream?: string; fetchImpl?: typeof fetch } = {},
): void {
  const upstream = opts.upstream ?? GRAPERANK_UPSTREAM;
  const doFetch = opts.fetchImpl ?? fetch;

  const tokenHeaders = (req: Request): Record<string, string> => {
    const token = req.headers["access_token"];
    return typeof token === "string" ? { access_token: token } : {};
  };
  const key = (req: Request, res: Response): string | null => {
    const k = req.params.pubkey;
    if (typeof k === "string" && HEX_KEY.test(k)) return k.toLowerCase();
    res.status(400).json({ error: "Expected a hex public key" });
    return null;
  };
  const forward = async (res: Response, label: string, path: string, init: RequestInit) => {
    try {
      const r = await doFetch(`${upstream}${path}`, init);
      const data = await r.text();
      res.status(r.status).set({ "Content-Type": "application/json" }).end(data);
    } catch (err) {
      console.error(`[graperank proxy] ${label} error:`, err);
      res.status(502).json({ error: "Upstream unavailable" });
    }
  };

  app.get("/api/graperank/authChallenge/:pubkey", async (req, res) => {
    const k = key(req, res);
    if (k) await forward(res, "authChallenge", `/authChallenge/${k}`, { signal: AbortSignal.timeout(5000) });
  });

  app.post("/api/graperank/authChallenge/:pubkey/verify", async (req, res) => {
    const k = key(req, res);
    if (!k) return;
    await forward(res, "verify", `/authChallenge/${k}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(5000),
    });
  });

  // Registered before /user/:pubkey so "self" is never read as a key.
  app.get("/api/graperank/user/self", async (req, res) => {
    await forward(res, "user/self", "/user/self", { headers: tokenHeaders(req), signal: AbortSignal.timeout(5000) });
  });

  app.get("/api/graperank/user/:pubkey", async (req, res) => {
    const k = key(req, res);
    if (k) await forward(res, "user", `/user/${k}`, { headers: tokenHeaders(req), signal: AbortSignal.timeout(5000) });
  });

  app.get("/api/graperank/setup/:pubkey", async (req, res) => {
    const k = key(req, res);
    if (k) await forward(res, "setup", `/setup/${k}`, { signal: AbortSignal.timeout(5000) });
  });

  // Trigger a GrapeRank calculation for the authenticated user (their own
  // pubkey, via the forwarded access_token), so people can (re)calculate their
  // web of trust in the app. The upstream rate-limits this per user (~30-min
  // cooldown); the status is passed through so the client can say so.
  app.post("/api/graperank/trigger", async (req, res) => {
    await forward(res, "trigger", "/user/graperank", { method: "POST", headers: tokenHeaders(req), signal: AbortSignal.timeout(8000) });
  });
}
