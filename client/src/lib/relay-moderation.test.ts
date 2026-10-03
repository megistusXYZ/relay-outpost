import { describe, it, expect, vi } from "vitest";
import { blockAuthorOnRelay, removeEventOnRelay, type ModerationDeps } from "./relay-moderation";

const deps = (support: string, answer: { result?: unknown; error?: string } = { result: true }): ModerationDeps & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    support: vi.fn(async () => support as any),
    ban: vi.fn(async (_r: string, pk: string) => { calls.push(`ban ${pk}`); return answer as any; }),
    banEvent: vi.fn(async (_r: string, id: string) => { calls.push(`banevent ${id}`); return answer as any; }),
  };
};

describe("blocking someone from the relay", () => {
  it("bans them on the relay when it has a management API", async () => {
    const d = deps("supported");
    expect(await blockAuthorOnRelay("wss://r", "pk", d)).toEqual({ onRelay: true });
    expect(d.calls).toEqual(["ban pk"]);
  });
  it("says the relay refused, with its words, and does not claim success", async () => {
    const d = deps("supported", { error: "restricted: not an admin" });
    expect(await blockAuthorOnRelay("wss://r", "pk", d)).toEqual({ onRelay: false, reason: "error", message: "restricted: not an admin" });
  });
  it("says nothing reached the relay when it has no management API, or can't be reached", async () => {
    expect(await blockAuthorOnRelay("wss://r", "pk", deps("not_supported"))).toEqual({ onRelay: false, reason: "no-api" });
    expect(await blockAuthorOnRelay("wss://r", "pk", deps("advertised_but_nonfunctional"))).toEqual({ onRelay: false, reason: "no-api" });
    expect(await blockAuthorOnRelay("wss://r", "pk", deps("unreachable"))).toEqual({ onRelay: false, reason: "unreachable" });
  });
});

describe("removing a post from the relay", () => {
  it("removes it through the management API when there is one", async () => {
    const d = deps("supported");
    expect(await removeEventOnRelay("wss://r", "ev", d)).toEqual({ onRelay: true });
    expect(d.calls).toEqual(["banevent ev"]);
  });
  it("otherwise tells the caller to fall back, without pretending", async () => {
    expect(await removeEventOnRelay("wss://r", "ev", deps("not_supported"))).toEqual({ onRelay: false, reason: "no-api" });
  });
});
