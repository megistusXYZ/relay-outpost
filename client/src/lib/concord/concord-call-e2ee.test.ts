/**
 * Call encryption, set up exactly as Armada sets it up (its SenderKeyProvider in
 * PersistentVoiceRoom.tsx): LiveKit's frame encryption with one key per caller,
 * each key derived outside LiveKit and never ratcheted by it. Any difference
 * here and the two apps can't hear each other.
 */
import { describe, it, expect } from "vitest";
import { CallKeyProvider, joinCall } from "./concord-call-e2ee";
import { voiceKeys, voiceSenderKey } from "./concord-voice";
import { issueAvToken } from "../../../../server/concord-av";

describe("call encryption", () => {
  it("uses Armada's frame-key profile: a key per caller, 256-bit, never ratcheted by LiveKit", () => {
    expect(new CallKeyProvider().getOptions()).toMatchObject({
      sharedKey: false,
      ratchetWindowSize: 0,
      failureTolerance: -1,
      keySize: 256,
      ratchetSalt: "LKFrameEncryptionKey",
    });
  });

  it("installs a caller's frame key as HKDF material LiveKit can derive from but nobody can read back", async () => {
    const { mediaKey } = voiceKeys(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22), 0n);
    const seat = "0123456789abcdef0123456789abcdef";
    const provider = new CallKeyProvider();
    await provider.setCallerKey(voiceSenderKey(mediaKey, seat), seat);
    const installed = provider.getKeys().find((k) => k.participantIdentity === seat);
    expect(installed?.key.algorithm.name).toBe("HKDF");
    expect(installed?.key.extractable).toBe(false);
    expect([...(installed?.key.usages ?? [])].sort()).toEqual(["deriveBits", "deriveKey"]);
  });

  it("never joins a call unencrypted: if encryption can't start, it asks for no token and connects to nothing", async () => {
    const keys = voiceKeys(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22), 0n);
    const calls: string[] = [];
    const room = {
      setE2EEEnabled: async () => { calls.push("encrypt"); },
      connect: async () => { calls.push("connect"); },
      disconnect: async () => {},
    };
    await expect(joinCall({
      keys,
      brokerOrigin: "https://relayop.xyz",
      now: () => 1_789_240_000,
      fetch: (async () => { calls.push("token"); return new Response("{}"); }) as typeof fetch,
      startWorker: () => { throw new Error("module workers blocked"); },
      createRoom: () => room,
    })).rejects.toThrow(/encrypt/i);
    expect(calls).toEqual([]);
  });

  it("joins with its own key installed and encryption on before connecting, using a token our real call-token check hands out", async () => {
    const keys = voiceKeys(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22), 0n);
    const NOW = 1_789_240_000;
    const requested: string[] = [];
    // The real server check answers the join, so the app and the service must agree.
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      const res = issueAvToken({
        authorization: new Headers(init?.headers).get("Authorization") ?? undefined,
        room: url.split("/").pop()!, url, now: NOW, seen: new Set<string>(),
        apiKey: "APItest", apiSecret: "s".repeat(48), livekitUrl: "wss://livekit.relayop.xyz",
      });
      return new Response(JSON.stringify(res.body), { status: res.status });
    }) as typeof fetch;

    const steps: string[] = [];
    let keyedWhenEncrypting: (string | undefined)[] = [];
    const joined = await joinCall({
      keys,
      brokerOrigin: "https://relayop.xyz",
      now: () => NOW,
      fetch: fakeFetch,
      startWorker: () => ({ terminate() {} }) as unknown as Worker,
      createRoom: (e2ee) => ({
        setE2EEEnabled: async () => {
          steps.push("encrypt");
          keyedWhenEncrypting = e2ee.keyProvider.getKeys().map((k) => k.participantIdentity);
        },
        connect: async (url: string, token: string) => { steps.push(`connect ${url} ${token ? "with-token" : "no-token"}`); },
        disconnect: async () => {},
      }),
    });

    expect(requested).toEqual([`https://relayop.xyz/.well-known/concord/av/${keys.room}`]);
    expect(joined.identity).toMatch(/^[0-9a-f]{32}$/);
    // Our own key was already in place when encryption was switched on.
    expect(keyedWhenEncrypting).toContain(joined.identity);
    expect(steps).toEqual(["encrypt", "connect wss://livekit.relayop.xyz with-token"]);
    expect(joined.keyProvider.getKeys().some((k) => k.participantIdentity === joined.identity)).toBe(true);
  });

  it("tells you why when the call service says no, and leaves nothing running", async () => {
    const keys = voiceKeys(new Uint8Array(32).fill(0x11), new Uint8Array(32).fill(0x22), 0n);
    let terminated = false;
    let roomMade = false;
    await expect(joinCall({
      keys,
      brokerOrigin: "https://relayop.xyz",
      now: () => 1_789_240_000,
      fetch: (async () => new Response(JSON.stringify({ error: "Calls aren't set up on this server" }), { status: 503 })) as typeof fetch,
      startWorker: () => ({ terminate() { terminated = true; } }) as unknown as Worker,
      createRoom: () => { roomMade = true; return { setE2EEEnabled: async () => {}, connect: async () => {}, disconnect: async () => {} }; },
    })).rejects.toThrow("Calls aren't set up on this server");
    expect(terminated).toBe(true);
    expect(roomMade).toBe(false);
  });
});
