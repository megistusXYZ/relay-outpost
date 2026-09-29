/**
 * The "signer offline" notice (owner, 2026-09-29: the old banner was far too
 * big). One short line that names what's actually offline for THIS sign-in,
 * what still works, and a short "why" on request.
 */
import { describe, it, expect } from "vitest";
import { signerNoticeCopy } from "./signer-notice";

describe("signerNoticeCopy", () => {
  it("names the thing that's offline for each way of signing in", () => {
    expect(signerNoticeCopy("extension").title).toBe("Signing extension offline");
    expect(signerNoticeCopy("bunker").title).toBe("Signer app offline");
    expect(signerNoticeCopy("qr").title).toBe("Signer session expired");
  });

  it("says what still works in one short line", () => {
    for (const m of ["extension", "bunker", "qr"] as const) {
      const c = signerNoticeCopy(m);
      expect(c.body).toMatch(/brows/i);
      expect(c.body.length).toBeLessThanOrEqual(60);
    }
  });

  it("an expired QR session is fixed by scanning again, not by waiting", () => {
    expect(signerNoticeCopy("qr").why).toMatch(/scan/i);
  });

  it("the why explains the key never left their device, briefly", () => {
    for (const m of ["extension", "bunker", "qr"] as const) {
      expect(signerNoticeCopy(m).why.length).toBeLessThanOrEqual(200);
    }
    expect(signerNoticeCopy("extension").why).toMatch(/extension/);
  });
});
