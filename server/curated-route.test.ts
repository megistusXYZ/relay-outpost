/** GET /api/curated serves the shared curated lists (shared/curated-lists.ts). */
import { describe, it, expect } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { registerCuratedRoute } from "./curated-route";
import { CURATED_LISTS } from "@shared/curated-lists";

describe("/api/curated", () => {
  it("serves the lists, cacheable for a few minutes", async () => {
    const app = express();
    registerCuratedRoute(app);
    const server = await new Promise<Server>((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
    const res = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/curated`);
    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
    expect(await res.json()).toEqual(CURATED_LISTS);
    server.close();
  });
});
