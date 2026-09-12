/**
 * The call-token service (Concord CORD-07 §2, "broker"): a member proves they
 * hold a room's voice key by signing a request with it, and gets a token for
 * that room's call on our LiveKit server. The broker never learns who they
 * are; it hands out a random identity. Real signatures throughout.
 */
import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
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
