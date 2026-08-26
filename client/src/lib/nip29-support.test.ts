/**
 * "Does this relay host groups?" has THREE answers, and conflating two of them
 * hid a working relay's rooms behind "This outpost doesn't have chat yet".
 *
 * The relay was fine — its websocket served kind-39000 group metadata on
 * request. Its HTTP front end returned a 502, so the NIP-11 document could not
 * be read, and a `|| []` upstream turned "we could not ask" into "it said it
 * supports nothing". Downstream a deliberately permissive `?? true` could never
 * fire, because [] is not nullish.
 */
import { describe, it, expect } from "vitest";
import { nip29Support, supportsNip29, mayHostNip29 } from "./nip29";

describe("nip29Support", () => {
  it("says yes when the relay lists 29", () => {
    expect(nip29Support([1, 11, 29, 42])).toBe("yes");
  });

  it("says no when the relay lists its nips and 29 is absent", () => {
    expect(nip29Support([1, 11, 42])).toBe("no");
  });

  it("says UNKNOWN when there is no document to read", () => {
    // The whole bug: this case must stay distinguishable from "no".
    expect(nip29Support(undefined)).toBe("unknown");
  });

  it("treats an EMPTY list as unknown, not as a denial", () => {
    // A relay that genuinely supports nothing is not a thing; an empty array
    // here is what a failed fetch degrades into. `|| []` at the source is
    // exactly how the original bug was introduced, so the type refuses to read
    // it as a claim.
    expect(nip29Support([])).toBe("unknown");
  });
});

describe("the two readings, which are deliberately opposite", () => {
  it("discovery will not recommend an unconfirmed relay", () => {
    expect(supportsNip29(undefined)).toBe(false);
    expect(supportsNip29([])).toBe(false);
    expect(supportsNip29([29])).toBe(true);
  });

  it("an already-added space does not hide rooms over a failed fetch", () => {
    expect(mayHostNip29(undefined)).toBe(true);   // ← the regression
    expect(mayHostNip29([])).toBe(true);          // ← and its `|| []` variant
    expect(mayHostNip29([29])).toBe(true);
  });

  it("but a space DOES hide chat when the relay actually said no", () => {
    expect(mayHostNip29([1, 11, 42])).toBe(false);
  });
});
