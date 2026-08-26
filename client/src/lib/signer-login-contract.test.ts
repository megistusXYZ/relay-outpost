import { describe, it, expect } from "vitest";

// Regression guard for the NIP-07 login contract.
//
// Login must depend ONLY on getPublicKey() + signEvent(). Some valid signers
// (e.g. the Continuum desktop signer) expose NO nip04/nip44/getRelays. Keeping
// those three optional on the NostrExtension type is exactly what keeps such
// signers able to log in. If a future change makes any of them required, the
// `NostrExtension` annotations below fail to compile (tsc / vitest catches it),
// and the runtime assertions document the contract.
describe("NIP-07 login contract", () => {
  const PUBKEY = "abcd1234".repeat(8); // valid 64-hex pubkey

  it("accepts a signer with only getPublicKey + signEvent (no nip04/nip44/getRelays)", async () => {
    const minimalSigner: NostrExtension = {
      async getPublicKey() {
        return PUBKEY;
      },
      async signEvent(e) {
        return { ...e, id: "f".repeat(64), sig: "0".repeat(128), pubkey: PUBKEY } as any;
      },
      // intentionally NO nip04, nip44, or getRelays — Continuum lacks them
    };

    expect(await minimalSigner.getPublicKey()).toBe(PUBKEY);
    const signed = await minimalSigner.signEvent({ kind: 1, created_at: 0, tags: [], content: "login" });
    expect(signed.pubkey).toBe(PUBKEY);
    expect(typeof signed.sig).toBe("string");
  });

  it("treats nip04 / nip44 / getRelays as optional (encryption is lazy, DMs only)", () => {
    const signer: NostrExtension = {
      async getPublicKey() {
        return PUBKEY;
      },
      async signEvent(e) {
        return e as any;
      },
    };

    // Optional members are absent on a minimal signer; access must compile and be undefined.
    expect(signer.nip04).toBeUndefined();
    expect(signer.nip44).toBeUndefined();
    expect(signer.getRelays).toBeUndefined();
  });
});
