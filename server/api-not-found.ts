/**
 * An API path nobody registered is a miss, and says so: 404, a small JSON
 * body, never cached. Mounted on /api by both page fallbacks (static.ts in
 * production, vite.ts in dev), after every API route and ahead of the page.
 *
 * Without it the request fell through to index.html with status 200, so
 * `res.ok` was true and the caller only found out when the page failed to
 * parse as JSON: "we never got to ask" read as an answer
 * (RELAY_REACHABILITY.md). A page still running an older build asks for
 * routes a later deploy removed.
 */
import type { RequestHandler } from "express";

export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).set("Cache-Control", "no-store").json({ error: "Not found" });
};
