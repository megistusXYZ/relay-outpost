/**
 * "Both users created accounts using DuckDuckGo browser — why are they not
 * compatible?"
 *
 * They were. Both accounts publish a kind-10050 at signup (CreateAccountFlow),
 * and each was told the other had not: "Their app hasn't said where to deliver
 * private messages — this chat may not reach them."
 *
 * `fetchDMRelayList` treated an empty query result as a CONFIRMED absence and
 * negative-cached it. Its own catch block was written to prevent exactly that
 * — "do NOT negative-cache a network failure" — and could never fire, because
 * `pool.querySync` does not throw when relays are unreachable. It resolves with
 * an empty array, which is indistinguishable from "asked, and there is none"
 * unless you check reachability separately.
 *
 * That negative cache is load-bearing in both directions:
 * `wasDMRelayListConfirmedEmpty` is what auto-publish keys off, so a false
 * "confirmed empty" both slanders the contact and misleads our own repair path.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "client", "src", "lib", "outbox.ts"), "utf8");
const code = SRC
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(?<!:)\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));

describe("a missing DM inbox must be an answer, not a silence", () => {
  it("asks through queryAnswered, so 'nobody answered' is a distinct outcome", () => {
    // The original guard probed canReachAny AFTER an empty querySync. That
    // caught unreachable relays but not a reachable relay that REFUSES the
    // REQ (CLOSED auth-required arrives as an ordinary end-of-stream).
    // queryAnswered's `answered` is true only on a real EOSE — strictly
    // stronger, and no second round-trip.
    expect(code).toMatch(/queryAnswered\(discoveryRelays/);
  });

  it("negative-caches ONLY on a real answer", () => {
    // The whole bug. The write must be gated on `answered`, or an unanswered
    // (or refused) query is filed as a confirmed absence.
    expect(code).toMatch(/if \(answered\) dmRelayNegativeCache\.set\(pubkey, Date\.now\(\)\)/);
  });

  it("warms the target's NIP-65 before concluding anything about their inbox", () => {
    // Found live: a kind-10050 sitting on damus/nos.lol that neither indexer
    // held. Discovery read the target's write relays off a COLD cache, got [],
    // asked only the indexers, and both ANSWERED honestly about their own
    // emptiness — so the `answered` guard passed and the UI said "their app
    // hasn't said where to deliver private messages" about a published list.
    // The 10050 lives in its owner's outbox; you must actually LOAD the
    // outbox before you may conclude. Order in source: the NIP-65 warm-up
    // fetch, then the 10050 query.
    // `authors: [pubkey]` (not `authors: chunk`) pins this to the single-target
    // warm-up inside fetchDMRelayList, not the batched NIP-65 prefetcher.
    const warm = code.search(/kinds: \[KIND_RELAY_LIST\],\s*authors: \[pubkey\]/);
    const ask = code.indexOf("kinds: [KIND_DM_RELAY_LIST]");
    expect(warm).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(-1);
    expect(warm).toBeLessThan(ask);
  });

  it("asks the big default relays too — most clients' 10050s live there", () => {
    // DM_FALLBACK_RELAYS is already where we PUBLISH when we know nothing;
    // asking the same set when READING costs nothing and is what actually
    // found the live 10050 the indexers missed.
    const union = code.indexOf("for (const r of DM_FALLBACK_RELAYS)");
    const ask = code.indexOf("kinds: [KIND_DM_RELAY_LIST]");
    expect(union).toBeGreaterThan(-1);
    expect(union).toBeLessThan(ask);
  });

  it("still records a real absence, so auto-publish keeps working", () => {
    // Deleting the negative cache would "fix" the false positive by breaking
    // the repair path that depends on knowing a list is genuinely missing.
    expect(code).toMatch(/dmRelayNegativeCache\.set\(pubkey, Date\.now\(\)\)/);
    expect(code).toMatch(/export function wasDMRelayListConfirmedEmpty/);
  });

  it("still publishes our own inbox at signup", () => {
    // The other half of "why are they not compatible": if we ever stop
    // advertising our own 10050, every Relay Outpost account really would be
    // unreachable and the warning would be telling the truth.
    const flow = readFileSync(
      join(process.cwd(), "client", "src", "components", "CreateAccountFlow.tsx"),
      "utf8",
    );
    expect(flow).toMatch(/publishDMRelayList\(/);
  });
});
