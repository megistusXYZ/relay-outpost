/**
 * Delivering a push (owner, 2026-10-06): what leaves our server is encrypted
 * to the device (Web Push, RFC 8291) — the push service carries it but can't
 * read it — signed as ours (VAPID), with an expiry so a late ring is dropped.
 * Checked against a receiver that decrypts with the device's own keys.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createServer, Agent, type Server } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
// http_ece is web-push's own encryption library; here it plays the device.
import ece from "http_ece";
import { webPushSend } from "./push-send";
import type { PushDevice } from "./push-devices";

let server: Server | null = null;

/** A throwaway certificate for the test's own push service on 127.0.0.1. */
function testCert() {
  const dir = mkdtempSync(join(tmpdir(), "push-test-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1",
      "-subj", "/CN=127.0.0.1", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
    return { key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const tls = testCert();
const trustTestCert = new Agent({ ca: tls.cert, checkServerIdentity: () => undefined });
afterEach(() => { server?.close(); server = null; });

function device(endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const d: PushDevice = {
    endpoint, watch: null, inboxRelays: [], rooms: [], updatedAt: 0,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
  };
  return { d, decrypt: (body: Buffer) => ece.decrypt(body, { version: "aes128gcm", privateKey: ecdh, authSecret: auth }).toString("utf8") };
}

async function receiver(status: number) {
  const got: Array<{ headers: Record<string, string | string[] | undefined>; body: Buffer }> = [];
  server = createServer(tls, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { got.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.statusCode = status; res.end(); });
  });
  await new Promise<void>((r) => server!.listen(0, r));
  return { url: `https://127.0.0.1:${(server!.address() as { port: number }).port}/push/abc`, got };
}

describe("delivering a push", () => {
  const vapid = { ...webpush.generateVAPIDKeys(), subject: "https://relayop.xyz" };

  it("reaches the device encrypted to it, signed as ours, with the expiry and urgency asked for", async () => {
    const r = await receiver(201);
    const { d, decrypt } = device(r.url);
    expect(await webPushSend(vapid, { agent: trustTestCert })(d, JSON.stringify({ t: "call", room: "a".repeat(64) }), { ttl: 30, urgency: "high" })).toBe("sent");
    expect(r.got).toHaveLength(1);
    const { headers, body } = r.got[0];
    expect(headers.ttl).toBe("30");
    expect(headers.urgency).toBe("high");
    expect(String(headers.authorization)).toMatch(/^vapid t=.+, k=/);
    expect(body.toString("utf8")).not.toContain("call");
    expect(JSON.parse(decrypt(body))).toEqual({ t: "call", room: "a".repeat(64) });
  });

  it("names a device its push service says is gone, and a passing failure as failed", async () => {
    const gone = await receiver(410);
    expect(await webPushSend(vapid, { agent: trustTestCert })(device(gone.url).d, "{}", { ttl: 30, urgency: "high" })).toBe("gone");
    server?.close();
    const busy = await receiver(500);
    expect(await webPushSend(vapid, { agent: trustTestCert })(device(busy.url).d, "{}", { ttl: 30, urgency: "high" })).toBe("failed");
  });
});
