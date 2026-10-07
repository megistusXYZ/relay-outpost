/**
 * The call-token service (Concord CORD-07 §2, "broker"): a member proves they
 * hold a room's voice key by signing a request with it, and gets a token for
 * that room's call on our LiveKit server. The broker never learns who they
 * are; it hands out a random identity. Real signatures throughout.
 */
import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { request } from "node:http";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { issueAvToken } from "./concord-av";

const NOW = 1_789_240_000;
const API_KEY = "APItest";
const API_SECRET = "s".repeat(48);
const LIVEKIT_URL = "wss://livekit.relayop.xyz";

/** A room's voice key signs the request; its public key IS the room. */
function signedRequest(opts: { url: string; createdAt?: number } ) {
  const sk = generateSecretKey();
  const room = getPublicKey(sk);
  const event = finalizeEvent({
    kind: 27235,
    created_at: opts.createdAt ?? NOW,
    tags: [["u", opts.url.replace("{room}", room)], ["method", "GET"], ["nonce", randomBytes(32).toString("hex")]],
    content: "",
  }, sk);
  const url = opts.url.replace("{room}", room);
  return { room, url, event, authorization: `Concord ${Buffer.from(JSON.stringify(event)).toString("base64")}` };
}

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("call tokens", () => {
  it("gives a correctly signed request a token for that room, a fresh random identity and the media server's address", () => {
    const req = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}" });
    const res = issueAvToken({
      authorization: req.authorization, room: req.room, url: req.url, now: NOW,
      seen: new Set<string>(), apiKey: API_KEY, apiSecret: API_SECRET, livekitUrl: LIVEKIT_URL,
    });

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.url).toBe(LIVEKIT_URL);
    expect(res.body.identity).toMatch(/^[0-9a-f]{32}$/);

    const [h, p, sig] = res.body.token.split(".");
    expect(createHmac("sha256", API_SECRET).update(`${h}.${p}`).digest("base64url")).toBe(sig);
    const claims = decode(p);
    expect(claims).toMatchObject({ iss: API_KEY, sub: res.body.identity, video: { room: req.room, roomJoin: true } });
    expect(claims.exp).toBeGreaterThan(NOW);
  });

  it("refuses a request not signed by the room's own voice key", () => {
    const req = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}" });
    const otherRoom = getPublicKey(generateSecretKey());
    const res = issueAvToken({
      authorization: req.authorization, room: otherRoom, url: req.url.replace(req.room, otherRoom), now: NOW,
      seen: new Set<string>(), apiKey: API_KEY, apiSecret: API_SECRET, livekitUrl: LIVEKIT_URL,
    });
    expect(res.status).toBe(401);
  });

  it("refuses a request made for another link, or as anything but a GET", () => {
    const sk = generateSecretKey();
    const room = getPublicKey(sk);
    const ours = `https://relayop.xyz/.well-known/concord/av/${room}`;
    const ask = (u: string, method: string) => {
      const event = finalizeEvent({ kind: 27235, created_at: NOW, tags: [["u", u], ["method", method]], content: "" }, sk);
      return issueAvToken({
        authorization: `Concord ${Buffer.from(JSON.stringify(event)).toString("base64")}`, room, url: ours, now: NOW,
        seen: new Set<string>(), apiKey: API_KEY, apiSecret: API_SECRET, livekitUrl: LIVEKIT_URL,
      }).status;
    };
    // Signed for Armada's broker, then presented to ours: a replay across servers.
    expect(ask(`https://armada.buzz/.well-known/concord/av/${room}`, "GET")).toBe(401);
    expect(ask(ours, "POST")).toBe(401);
    expect(ask(ours, "GET")).toBe(200);
  });

  it("only honors a request made within a minute of now", () => {
    const status = (createdAt: number) => {
      const req = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}", createdAt });
      return issueAvToken({
        authorization: req.authorization, room: req.room, url: req.url, now: NOW,
        seen: new Set<string>(), apiKey: API_KEY, apiSecret: API_SECRET, livekitUrl: LIVEKIT_URL,
      }).status;
    };
    expect(status(NOW - 61)).toBe(401);
    expect(status(NOW + 61)).toBe(401);
    expect(status(NOW - 59)).toBe(200);
  });

  it("honors each request once: the same signed request can't be replayed for a second token", () => {
    const req = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}" });
    const seen = new Set<string>();
    const ask = () => issueAvToken({
      authorization: req.authorization, room: req.room, url: req.url, now: NOW,
      seen, apiKey: API_KEY, apiSecret: API_SECRET, livekitUrl: LIVEKIT_URL,
    }).status;
    expect(ask()).toBe(200);
    expect(ask()).toBe(401);
  });

  it("gives out nothing while the server has no media-server keys, so no token is ever signed with an empty secret", () => {
    const status = (apiKey: string, apiSecret: string) => {
      const req = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}" });
      return issueAvToken({
        authorization: req.authorization, room: req.room, url: req.url, now: NOW,
        seen: new Set<string>(), apiKey, apiSecret, livekitUrl: LIVEKIT_URL,
      }).status;
    };
    expect(status("", API_SECRET)).toBe(503);
    expect(status(API_KEY, "")).toBe(503);
    const req = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}" });
    expect(issueAvToken({
      authorization: req.authorization, room: req.room, url: req.url, now: NOW,
      seen: new Set<string>(), apiKey: API_KEY, apiSecret: API_SECRET, livekitUrl: "",
    }).status).toBe(503);
  });
});

/**
 * Owner, 2026-10-06: groups made here name our call service, so members using
 * other apps (Armada) join our calls — and our service answers their
 * browsers. Only this endpoint opens to other sites; it stays members-only
 * (the signed request) and rate-limited.
 */
describe("other apps can reach our call service", () => {
  it("answers other sites' browsers on the probe, the preflight and a token request", async () => {
    const express = (await import("express")).default;
    const { registerConcordAvRoutes } = await import("./concord-av");
    const { siteCors } = await import("./site-cors");
    const app = express();
    // The real order: the site-wide CORS layer first (index.ts), then routes.
    app.use(siteCors());
    registerConcordAvRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const base = `http://127.0.0.1:${port}/.well-known/concord/av`;
      const origin = { Origin: "https://armada.buzz" };
      const probe = await fetch(base, { headers: origin });
      expect(probe.status).toBe(204);
      expect(probe.headers.get("access-control-allow-origin")).toBe("*");
      expect(probe.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
      const pre = await fetch(`${base}/${"a".repeat(64)}`, { method: "OPTIONS", headers: { ...origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
      expect(pre.headers.get("access-control-allow-methods")).toContain("GET");
      const token = await fetch(`${base}/${"a".repeat(64)}`, { headers: origin });
      expect(token.headers.get("access-control-allow-origin")).toBe("*"); // even its refusals are readable
    } finally {
      server.close();
    }
  });
});

describe("call limits at the token check", () => {
  const base = () => ({ now: NOW, apiKey: API_KEY, apiSecret: API_SECRET, livekitUrl: LIVEKIT_URL });

  it("a request nobody signed never counts against a room's limit", () => {
    const req = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}" });
    let asked = 0;
    const res = issueAvToken({ ...base(), authorization: "Concord bm90IHNpZ25lZA==", room: req.room, url: req.url, seen: new Set<string>(), admit: () => { asked++; return { ok: true }; } });
    expect(res.status).toBe(400);
    expect(asked).toBe(0);
  });

  it("when calls are busy it says so plainly, gives no token, and the request can be tried again", () => {
    const req = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}" });
    const seen = new Set<string>();
    const busy = issueAvToken({ ...base(), authorization: req.authorization, room: req.room, url: req.url, seen, admit: () => ({ ok: false, reason: "busy" }) });
    expect(busy).toEqual({ status: 503, body: { error: "Calls are busy right now. Try again in a few minutes." } });
    const full = issueAvToken({ ...base(), authorization: req.authorization, room: req.room, url: req.url, seen, admit: () => ({ ok: false, reason: "room" }) });
    expect(full).toEqual({ status: 429, body: { error: "Too many people are joining this call at once. Try again in a moment." } });
    expect(issueAvToken({ ...base(), authorization: req.authorization, room: req.room, url: req.url, seen, admit: () => ({ ok: true }) }).status).toBe(200);
  });
});

describe("how many calls are running, for the team only", () => {
  const nip98 = (sk: Uint8Array, url: string) => {
    const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [["u", url], ["method", "GET"]], content: "" }, sk);
    return `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`;
  };

  it("answers the team's signed request with the count and the limit; nobody else gets it", async () => {
    const express = (await import("express")).default;
    const { registerConcordAvRoutes } = await import("./concord-av");
    const { createCallCapacity } = await import("./call-capacity");
    const team = generateSecretKey();
    const capacity = createCallCapacity({ maxCalls: 50, seatsPerRoomPerMinute: 30, liveRooms: async () => new Set(["a".repeat(64), "b".repeat(64), "c".repeat(64)]) });
    await capacity.refresh(Date.now());
    const app = express();
    registerConcordAvRoutes(app, { owners: [getPublicKey(team)], capacity });
    const server = app.listen(0);
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/calls/usage`;
    try {
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, { headers: { Authorization: nip98(generateSecretKey(), url) } })).status).toBe(403);
      const ok = await fetch(url, { headers: { Authorization: nip98(team, url) } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ calls: 3, max: 50 });
      expect(ok.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      server.close();
    }
  });
});

describe("a request made to another address can't be replayed here", () => {
  // Another call service receives requests signed for ITS address. Sent to
  // our server with that address as the host, it must not get a seat here.
  const send = (port: number, host: string, room: string, authorization: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: `/.well-known/concord/av/${room}`, headers: { Host: host, "X-Forwarded-Proto": "https", Authorization: authorization } }, (res) => {
      let body = ""; res.on("data", (c) => { body += c; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject); req.end();
  });

  it("answers only requests made to our own address", async () => {
    const express = (await import("express")).default;
    const { registerConcordAvRoutes } = await import("./concord-av");
    const app = express();
    app.set("trust proxy", 1);
    registerConcordAvRoutes(app, { ownOrigins: ["https://relayop.xyz"] });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const elsewhere = signedRequest({ url: "https://evil.example/.well-known/concord/av/{room}" });
      const replayed = await send(port, "evil.example", elsewhere.room, elsewhere.authorization);
      expect(replayed.status).toBe(421);
      const ours = signedRequest({ url: "https://relayop.xyz/.well-known/concord/av/{room}" });
      // Reaches the token check (which here says calls aren't set up).
      expect((await send(port, "relayop.xyz", ours.room, ours.authorization)).status).toBe(503);
    } finally {
      server.close();
    }
  });
});
