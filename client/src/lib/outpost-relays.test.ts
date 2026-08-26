import { describe, it, expect } from "vitest";
import { mergeOutpostMeta, type OutpostDisplayMeta } from "./outpost-relays";

// The cached "what a joined community looks like" map. Its whole job is to let
// a list of communities paint real avatars on the first frame, so the rules
// that matter are: one relay is one entry regardless of URL spelling, and a
// thin NIP-11 response can never erase a good icon we already had.
describe("mergeOutpostMeta", () => {
  it("stores a relay's icon and name", () => {
    const out = mergeOutpostMeta({}, "wss://relay.example", {
      icon: "https://cdn.example/icon.png",
      name: "Example Community",
    });
    expect(out["wss://relay.example"]).toEqual({
      icon: "https://cdn.example/icon.png",
      name: "Example Community",
    });
  });

  it("treats trailing slash and case as the same relay", () => {
    let out: Record<string, OutpostDisplayMeta> = {};
    out = mergeOutpostMeta(out, "wss://Relay.Example/", { icon: "a.png" });
    out = mergeOutpostMeta(out, "wss://relay.example", { name: "Example" });
    expect(Object.keys(out)).toEqual(["wss://relay.example"]);
    expect(out["wss://relay.example"]).toEqual({ icon: "a.png", name: "Example" });
  });

  it("keeps an existing icon when a later response omits one", () => {
    // The failure this prevents: relay hiccups, drops `icon` from its NIP-11
    // doc for one fetch, and every avatar in the list blanks to a placeholder.
    let out = mergeOutpostMeta({}, "wss://relay.example", { icon: "good.png", name: "Old" });
    out = mergeOutpostMeta(out, "wss://relay.example", { name: "New" });
    expect(out["wss://relay.example"]).toEqual({ icon: "good.png", name: "New" });
  });

  it("ignores blank and whitespace-only values", () => {
    let out = mergeOutpostMeta({}, "wss://relay.example", { icon: "good.png" });
    out = mergeOutpostMeta(out, "wss://relay.example", { icon: "   ", name: "" });
    expect(out["wss://relay.example"]).toEqual({ icon: "good.png" });
  });

  it("does not create an entry for a relay that told us nothing", () => {
    const out = mergeOutpostMeta({}, "wss://relay.example", { icon: "", name: undefined });
    expect(out).toEqual({});
  });

  it("leaves other relays untouched", () => {
    const start = { "wss://a.example": { icon: "a.png" } };
    const out = mergeOutpostMeta(start, "wss://b.example", { icon: "b.png" });
    expect(out["wss://a.example"]).toEqual({ icon: "a.png" });
    expect(out["wss://b.example"]).toEqual({ icon: "b.png" });
    expect(start["wss://a.example"]).toEqual({ icon: "a.png" }); // input not mutated
  });

  it("trims stored values", () => {
    const out = mergeOutpostMeta({}, "wss://relay.example", { icon: " i.png ", name: " Name " });
    expect(out["wss://relay.example"]).toEqual({ icon: "i.png", name: "Name" });
  });
});
