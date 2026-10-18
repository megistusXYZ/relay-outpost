/**
 * The signup summary lists recent sessions and device flags, so only the
 * team's signed request (NIP-98, the team key) may read it.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { registerSignupTelemetryRoutes } from "./signup-telemetry";

const nip98 = (sk: Uint8Array, url: string) => {
  const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [["u", url], ["method", "GET"]], content: "" }, sk);
  return `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`;
};

describe("the signup summary", () => {
  it("answers only the team's signed request", async () => {
    const team = generateSecretKey();
    const app = express();
    registerSignupTelemetryRoutes(app, { owners: [getPublicKey(team)] });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/telemetry/signup/summary`;
    try {
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, { headers: { Authorization: nip98(generateSecretKey(), url) } })).status).toBe(403);
      const ok = await fetch(url, { headers: { Authorization: nip98(team, url) } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toHaveProperty("counters");
    } finally {
      server.close();
    }
  });
});
