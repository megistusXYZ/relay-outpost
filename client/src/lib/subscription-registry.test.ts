import { describe, it, expect } from "vitest";
import type { Event, Filter } from "nostr-tools";
import { SubscriptionRegistry, type SubscriptionOpener } from "./subscription-registry";

// A fake opener that records opens/closes and lets tests emit events + eose.
function makeFakeOpener() {
  const opens: Array<{
    relays: string[];
    filters: Filter | Filter[];
    emit: (e: Event) => void;
    eose: () => void;
    closed: boolean;
  }> = [];
  const opener: SubscriptionOpener = (relays, filters, handlers) => {
    const rec = {
      relays,
      filters,
      emit: handlers.onevent,
      eose: handlers.oneose,
      closed: false,
    };
    opens.push(rec);
    return { close: () => { rec.closed = true; } };
  };
  return { opener, opens };
}

const ev = (id: string): Event => ({ id, kind: 1, pubkey: "p", created_at: 1, content: "", tags: [], sig: "s" });
const F: Filter = { kinds: [1], "#p": ["p1"] } as Filter;
const RELAYS = ["wss://a.example", "wss://b.example"];

describe("SubscriptionRegistry", () => {
  it("opens ONE underlying subscription for two identical concurrent consumers", () => {
    const { opener, opens } = makeFakeOpener();
    const reg = new SubscriptionRegistry(opener);
    const a: string[] = [], b: string[] = [];
    reg.subscribe(RELAYS, F, { onevent: (e) => a.push(e.id) });
    reg.subscribe([...RELAYS].reverse(), F, { onevent: (e) => b.push(e.id) });

    expect(opens).toHaveLength(1);
    expect(reg.activeCount).toBe(1);

    opens[0].emit(ev("x"));
    expect(a).toEqual(["x"]);
    expect(b).toEqual(["x"]);
  });

  it("opens separate subscriptions for different filters", () => {
    const { opener, opens } = makeFakeOpener();
    const reg = new SubscriptionRegistry(opener);
    reg.subscribe(RELAYS, { kinds: [1] }, {});
    reg.subscribe(RELAYS, { kinds: [7] }, {});
    expect(opens).toHaveLength(2);
    expect(reg.activeCount).toBe(2);
  });

  it("closes the shared subscription only when the LAST consumer unsubscribes", () => {
    const { opener, opens } = makeFakeOpener();
    const reg = new SubscriptionRegistry(opener);
    const h1 = reg.subscribe(RELAYS, F, {});
    const h2 = reg.subscribe(RELAYS, F, {});
    expect(opens[0].closed).toBe(false);

    h1.close();
    expect(opens[0].closed).toBe(false); // still one consumer
    expect(reg.activeCount).toBe(1);

    h2.close();
    expect(opens[0].closed).toBe(true); // last one gone
    expect(reg.activeCount).toBe(0);
  });

  it("stops delivering to a consumer after it unsubscribes", () => {
    const { opener, opens } = makeFakeOpener();
    const reg = new SubscriptionRegistry(opener);
    const got: string[] = [];
    const h = reg.subscribe(RELAYS, F, { onevent: (e) => got.push(e.id) });
    reg.subscribe(RELAYS, F, {}); // keep shared sub alive
    opens[0].emit(ev("1"));
    h.close();
    opens[0].emit(ev("2"));
    expect(got).toEqual(["1"]);
  });

  it("fans EOSE out to all consumers and replays it to a late joiner", () => {
    const { opener, opens } = makeFakeOpener();
    const reg = new SubscriptionRegistry(opener);
    let eoseA = 0, eoseLate = 0;
    reg.subscribe(RELAYS, F, { oneose: () => { eoseA++; } });
    opens[0].eose();
    expect(eoseA).toBe(1);

    reg.subscribe(RELAYS, F, { oneose: () => { eoseLate++; } });
    expect(eoseLate).toBe(1); // late joiner still gets its loading-cleared signal
    expect(opens).toHaveLength(1); // no new underlying sub
  });

  it("double close is a no-op", () => {
    const { opener, opens } = makeFakeOpener();
    const reg = new SubscriptionRegistry(opener);
    const h = reg.subscribe(RELAYS, F, {});
    h.close();
    h.close();
    expect(opens[0].closed).toBe(true);
    expect(reg.activeCount).toBe(0);
  });

  it("reopens after all consumers left and a new one arrives", () => {
    const { opener, opens } = makeFakeOpener();
    const reg = new SubscriptionRegistry(opener);
    reg.subscribe(RELAYS, F, {}).close();
    expect(reg.activeCount).toBe(0);
    reg.subscribe(RELAYS, F, {});
    expect(opens).toHaveLength(2); // a fresh underlying subscription
    expect(reg.activeCount).toBe(1);
  });
});
