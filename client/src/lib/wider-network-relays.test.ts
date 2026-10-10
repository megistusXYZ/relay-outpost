/**
 * What flipping the wider-network switch publishes (owner, 2026-10-10).
 * kind-10002 is REPLACEABLE: a list built on a read nobody answered would
 * erase the real one, so the flip refuses rather than guesses — the same
 * rule as every other relay-list write here. On: the account's current
 * list plus the expanded defaults. Off: the floor plus the communities the
 * person joined. The DM inbox (kind 10050) follows: floor when off, the
 * open fallbacks when on.
 */
import { describe, it, expect } from "vitest";
import { publishRelayListForMode } from "./wider-network-relays";

const PK = "ef".repeat(32);

function harness(current: { tags: string[][]; answered: boolean }) {
  const published: { kind: number; tags: string[][] }[] = [];
  const dmLists: string[][] = [];
  const deps = {
    pubkey: PK,
    signer: { signEvent: async (t: { kind: number; tags: string[][] }) => ({ ...t, id: "x", pubkey: PK, sig: "s" }) },
    fetchCurrent: async () => current,
    publish: async (ev: { kind: number; tags: string[][] }) => { published.push(ev); return true; },
    publishDmList: async (relays: string[]) => { dmLists.push(relays); return true; },
    joinedCommunityRelays: ["wss://my-community.example"],
  };
  return { deps, published, dmLists };
}

describe("publishRelayListForMode", () => {
  it("on: publishes the current list grown by the expanded defaults, and the open DM fallbacks", async () => {
    const { deps, published, dmLists } = harness({ tags: [["r", "wss://relay.damus.io"], ["r", "wss://nos.lol"], ["r", "wss://my-community.example"]], answered: true });
    expect(await publishRelayListForMode(true, deps)).toBe("published");
    const urls = published[0].tags.map((t) => t[1]);
    expect(published[0].kind).toBe(10002);
    expect(urls).toContain("wss://my-community.example");
    expect(urls).toContain("wss://relay.primal.net");
    expect(dmLists[0]).toEqual(["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"]);
  });

  it("off: publishes the floor plus joined communities, and the floor as the DM inbox", async () => {
    const { deps, published, dmLists } = harness({ tags: [["r", "wss://relay.damus.io"], ["r", "wss://nos.lol"], ["r", "wss://relay.primal.net"], ["r", "wss://my-community.example"]], answered: true });
    expect(await publishRelayListForMode(false, deps)).toBe("published");
    expect(published[0].tags).toEqual([["r", "wss://relay.damus.io"], ["r", "wss://nos.lol"], ["r", "wss://my-community.example"]]);
    expect(dmLists[0]).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
  });

  it("refuses when no relay answered for the current list — never publishes over what might be there", async () => {
    const { deps, published } = harness({ tags: [], answered: false });
    expect(await publishRelayListForMode(true, deps)).toBe("unanswered");
    expect(published).toHaveLength(0);
  });

  it("reports a failed publish so the switch can revert", async () => {
    const { deps } = harness({ tags: [], answered: true });
    deps.publish = async () => false;
    expect(await publishRelayListForMode(true, deps)).toBe("failed");
  });
});
