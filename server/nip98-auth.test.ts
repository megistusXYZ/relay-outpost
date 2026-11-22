/**
 * A NIP-98 token says which URL it was signed for. The server compared only
 * the path, so a token someone signed for another site with the same paths
 * (any copy of this open-source server, or a custom scheduler) was accepted
 * here for a minute: listing or deleting that person's scheduled posts, or
 * signing up a device for their messages. The token's site must be this one.
 */
import { describe, expect, it } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { verifyNip98 } from "./nip98-auth";

const sk = generateSecretKey();
const token = (url: string, method = "GET", at = Math.floor(Date.now() / 1000)) =>
  `Nostr ${Buffer.from(JSON.stringify(finalizeEvent({ kind: 27235, created_at: at, tags: [["u", url], ["method", method]], content: "" }, sk))).toString("base64")}`;
const req = (auth: string, path = "/api/schedule", method = "GET", host = "relayop.xyz") =>
  ({ headers: { authorization: auth, host }, method, path });
const SITE = { origins: ["https://relayop.xyz", "https://www.relayop.xyz"] };

describe("verifyNip98", () => {
  it("accepts a fresh token for this site, this path and this method", () => {
    expect(verifyNip98(req(token("https://relayop.xyz/api/schedule?pubkey=x")), SITE)).toEqual({ pubkey: getPublicKey(sk) });
    expect(verifyNip98(req(token("https://www.relayop.xyz/api/schedule")), SITE)).toEqual({ pubkey: getPublicKey(sk) });
  });

  it("refuses a token signed for another site with the same path", () => {
    for (const other of ["https://other-outpost.example/api/schedule", "https://relayop.xyz.evil.example/api/schedule", "http://relayop.xyz:8080/api/schedule"]) {
      const r = verifyNip98(req(token(other)), SITE);
      expect("error" in r && r.status, other).toBe(401);
    }
  });

  it("with no site configured (a laptop), the site is the host the request came to", () => {
    expect(verifyNip98(req(token("http://localhost:5002/api/schedule"), "/api/schedule", "GET", "localhost:5002"), { origins: [] })).toEqual({ pubkey: getPublicKey(sk) });
    const r = verifyNip98(req(token("https://relayop.xyz/api/schedule"), "/api/schedule", "GET", "localhost:5002"), { origins: [] });
    expect("error" in r).toBe(true);
  });

  it("still refuses another path, another method, or an old token", () => {
    for (const [auth, path, method] of [
      [token("https://relayop.xyz/api/push/device"), "/api/schedule", "GET"],
      [token("https://relayop.xyz/api/schedule", "DELETE"), "/api/schedule", "GET"],
      [token("https://relayop.xyz/api/schedule", "GET", Math.floor(Date.now() / 1000) - 600), "/api/schedule", "GET"],
    ] as const) {
      const r = verifyNip98(req(auth, path, method), SITE);
      expect("error" in r && r.status).toBe(401);
    }
  });
});
