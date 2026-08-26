/**
 * Sweep core (lib/npubcash-sweep-core.ts) — the decidable half of the in-app
 * npub.cash sweep. Everything here is pure or localStorage-only, because the
 * failure modes are LOSS OF FUNDS and must be pinned:
 *
 *  - The proof STASH is bearer money. Once quotes are minted into proofs, the
 *    quotes are ISSUED server-side — the proofs in localStorage are the only
 *    copy of the funds until the melt lands. The stash must therefore
 *    write-then-verify, survive partial failures, dedupe by proof secret
 *    (re-minting retries must never double-count), and never be cleared
 *    except by explicit removal of specific spent proofs.
 *
 *  - Invoice planning must leave fee headroom (a mint's melt needs
 *    amount + fee_reserve ≤ proofs total) and must never plan a negative or
 *    zero invoice.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

const __local = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__local.has(k) ? __local.get(k)! : null),
  setItem: (k: string, v: string) => { __local.set(k, String(v)); },
  removeItem: (k: string) => { __local.delete(k); },
  clear: () => { __local.clear(); },
});

import {
  invoiceAmountFor,
  meltFits,
  readStash,
  appendToStash,
  removeSpentFromStash,
  stashTotalSats,
  witnessKeyFor,
  type StashProof,
} from "./npubcash-sweep-core";

const PK = "a".repeat(64);
const MINT = "https://mint.example";
const proof = (secret: string, amount: number): StashProof => ({
  id: "keyset", amount, secret, C: "c-" + secret,
});

beforeEach(() => { __local.clear(); });

describe("invoiceAmountFor", () => {
  it("leaves fee headroom: max(2 sats, 1%) below the total", () => {
    expect(invoiceAmountFor(63)).toBe(61);   // 1% of 63 rounds to 1 → floor 2
    expect(invoiceAmountFor(1000)).toBe(990); // 1% = 10
  });

  it("never plans a zero or negative invoice", () => {
    expect(invoiceAmountFor(2)).toBe(0);
    expect(invoiceAmountFor(0)).toBe(0);
    expect(invoiceAmountFor(1)).toBe(0);
  });
});

describe("meltFits", () => {
  it("requires amount plus fee reserve within the available proofs", () => {
    expect(meltFits({ amount: 61, fee_reserve: 2 }, 63)).toBe(true);
    expect(meltFits({ amount: 61, fee_reserve: 3 }, 63)).toBe(false);
  });
});

describe("proof stash", () => {
  it("appends, persists, and reads back per pubkey and mint", () => {
    appendToStash(PK, MINT, [proof("s1", 32), proof("s2", 16)]);
    const stash = readStash(PK);
    expect(stash[MINT]).toHaveLength(2);
    expect(stashTotalSats(stash)).toBe(48);
  });

  it("dedupes by proof secret — a retried mint must never double-count", () => {
    appendToStash(PK, MINT, [proof("s1", 32)]);
    appendToStash(PK, MINT, [proof("s1", 32), proof("s3", 8)]);
    expect(stashTotalSats(readStash(PK))).toBe(40);
  });

  it("removes ONLY the named spent proofs; change and other mints survive", () => {
    appendToStash(PK, MINT, [proof("s1", 32), proof("s2", 16)]);
    appendToStash(PK, "https://other.mint", [proof("o1", 4)]);
    removeSpentFromStash(PK, MINT, ["s1", "s2"]);
    const stash = readStash(PK);
    expect(stash[MINT] ?? []).toHaveLength(0);
    expect(stash["https://other.mint"]).toHaveLength(1);
  });

  it("append verifies the write and throws when storage lies", () => {
    const originalSet = localStorage.setItem;
    // Storage that ACCEPTS the write but drops it (private-mode quota class).
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    expect(() => appendToStash(PK, MINT, [proof("s9", 8)])).toThrow();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (__local.has(k) ? __local.get(k)! : null),
      setItem: originalSet,
      removeItem: (k: string) => { __local.delete(k); },
    });
  });

  it("stashes are per pubkey — account A's funds never appear under B", () => {
    appendToStash(PK, MINT, [proof("s1", 32)]);
    expect(stashTotalSats(readStash("b".repeat(64)))).toBe(0);
  });
});

describe("witnessKeyFor", () => {
  const KEY = "ab".repeat(32);

  it("locked quote (pubkey present) gets the witness key", () => {
    expect(witnessKeyFor("02" + "cd".repeat(32), KEY)).toBe(KEY);
    expect(witnessKeyFor("cd".repeat(32), KEY)).toBe(KEY); // x-only spelling counts too
  });

  it("unlocked quote (no pubkey) must claim UNSIGNED — CDK rejects a signature on an unlocked quote", () => {
    expect(witnessKeyFor(undefined, KEY)).toBeUndefined();
    expect(witnessKeyFor(null, KEY)).toBeUndefined();
    expect(witnessKeyFor("", KEY)).toBeUndefined();
  });
});

describe("amount normalization (live-fire regression: 63 sats became a 32,493,424-sat invoice)", () => {
  it("append normalizes cashu-ts Amount objects and string amounts to plain numbers", () => {
    const amountLike = { toNumber: () => 32, toJSON: () => "32" } as unknown as number;
    appendToStash(PK, MINT, [
      { id: "k", amount: amountLike, secret: "n1", C: "c1" },
      { id: "k", amount: "16" as unknown as number, secret: "n2", C: "c2" },
    ]);
    const stash = readStash(PK);
    expect(stash[MINT].map((p) => p.amount)).toEqual([32, 16]);
    expect(stashTotalSats(stash)).toBe(48); // numeric 48 — NOT "03216"
  });

  it("heals a stash already persisted with string amounts (the phone that hit the bug)", () => {
    __local.set(`ro_npc_ecash_stash_v1:${PK}`, JSON.stringify({
      [MINT]: [
        { id: "k", amount: "32", secret: "s1", C: "c1" },
        { id: "k", amount: "16", secret: "s2", C: "c2" },
        { id: "k", amount: 8, secret: "s3", C: "c3" },
      ],
    }));
    const stash = readStash(PK);
    expect(stash[MINT].map((p) => p.amount)).toEqual([32, 16, 8]);
    expect(stashTotalSats(stash)).toBe(56);
  });

  it("append refuses unparseable amounts — never persist garbage money metadata", () => {
    expect(() => appendToStash(PK, MINT, [{ id: "k", amount: "wat" as unknown as number, secret: "g1", C: "c" }])).toThrow();
  });
});
