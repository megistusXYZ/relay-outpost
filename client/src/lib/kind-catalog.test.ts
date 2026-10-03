import { describe, it, expect } from "vitest";
import { findKinds, kindName, plainKindName, KIND_CATALOG } from "./kind-catalog";

describe("finding a kind", () => {
  it("by its number", () => {
    expect(findKinds("1311")[0].kind).toBe(1311);
    expect(findKinds("7")[0].kind).toBe(7);
  });

  it("by its name, or the word people actually use", () => {
    expect(findKinds("reaction")[0].kind).toBe(7);
    expect(findKinds("like")[0].kind).toBe(7);
    expect(findKinds("thanks").map((k) => k.kind)).toContain(9735);
    expect(findKinds("zap").map((k) => k.kind)).toContain(9735);
    expect(findKinds("article")[0].kind).toBe(30023);
    expect(findKinds("live chat")[0].kind).toBe(1311);
  });

  it("by its NIP", () => {
    expect(findKinds("nip-25").map((k) => k.kind)).toContain(7);
    expect(findKinds("NIP 57").map((k) => k.kind)).toEqual(expect.arrayContaining([9734, 9735]));
  });

  it("a number we don't know is still a kind you can pick", () => {
    expect(findKinds("4242")).toEqual([{ kind: 4242, label: "Kind 4242" }]);
  });

  it("nothing for an empty search", () => {
    expect(findKinds("  ")).toEqual([]);
  });
});

describe("a kind in plain words", () => {
  it("the everyday name for the kinds people meet", () => {
    expect(plainKindName(1)).toBe("Note");
    expect(plainKindName(7)).toBe("Reaction");
    expect(plainKindName(9735)).toBe("Thanks");
    expect(plainKindName(30023)).toBe("Article");
  });

  it("the catalogue's name for the rest", () => {
    expect(plainKindName(31990)).toBe(kindName(31990));
  });
});

describe("naming a kind", () => {
  it("uses the catalogue's name", () => {
    expect(kindName(1)).toBe("Short Text Note");
    expect(kindName(4242)).toBe("Kind 4242");
  });

  it("the catalogue has no duplicate kinds", () => {
    expect(new Set(KIND_CATALOG.map((k) => k.kind)).size).toBe(KIND_CATALOG.length);
  });
});
