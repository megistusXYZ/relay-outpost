/**
 * Cross-site requests are allowed only from the listed origins. With no list
 * set (local development), only localhost is allowed; the old hosting
 * provider's domains are not.
 */
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { siteCors } from "./site-cors";

const saved = process.env.ALLOWED_ORIGINS;
afterEach(() => { if (saved === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = saved; });

async function allowOriginFor(origin: string): Promise<string | null> {
  const app = express();
  app.use(siteCors());
  app.get("/x", (_req, res) => res.send("ok"));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const r = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, { headers: { Origin: origin } });
    return r.headers.get("access-control-allow-origin");
  } finally {
    server.close();
  }
}

describe("siteCors", () => {
  it("with no list, allows localhost and nothing else", async () => {
    delete process.env.ALLOWED_ORIGINS;
    expect(await allowOriginFor("http://localhost:5002")).toBe("http://localhost:5002");
    expect(await allowOriginFor("https://someone.replit.app")).toBeNull();
    expect(await allowOriginFor("https://evil.example")).toBeNull();
  });

  it("with a list, allows exactly the listed origins", async () => {
    process.env.ALLOWED_ORIGINS = "https://relayop.xyz, https://www.relayop.xyz";
    expect(await allowOriginFor("https://www.relayop.xyz")).toBe("https://www.relayop.xyz");
    expect(await allowOriginFor("http://localhost:5002")).toBeNull();
  });
});
