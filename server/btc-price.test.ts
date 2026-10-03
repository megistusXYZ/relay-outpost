import { describe, it, expect } from "vitest";
import { createBtcPriceReader, parseCoinGecko, parseBinance, parseCoinbase, parseSparkline, PRICE_SOURCES, PRICE_TTL_MS } from "./btc-price";

// Real response shapes, trimmed to the fields read (captured 2026-10-03).
const GECKO = { market_data: { current_price: { usd: 61234.5 }, price_change_percentage_24h: -1.23, high_24h: { usd: 62000 }, low_24h: { usd: 60500 }, total_volume: { usd: 25e9 }, market_cap: { usd: 1.2e12 } } };
const BINANCE = { lastPrice: "61200.10", priceChangePercent: "-1.100", highPrice: "62010.00", lowPrice: "60490.00", quoteVolume: "1500000000.00" };
const COINBASE = { data: { base: "BTC", currency: "USD", amount: "61190.42" } };

describe("the price sources", () => {
  it("are read in order: the rich ones first, the bare spot last", () => {
    expect(PRICE_SOURCES.map((s) => s.id)).toEqual(["coingecko", "binance", "coinbase"]);
  });
  it("each parse their own shape and say who answered", () => {
    expect(parseCoinGecko(GECKO)).toMatchObject({ price: 61234.5, changePercent24h: -1.23, high24h: 62000, source: "coingecko" });
    expect(parseBinance(BINANCE)).toMatchObject({ price: 61200.1, changePercent24h: -1.1, source: "binance" });
    expect(parseCoinbase(COINBASE)).toMatchObject({ price: 61190.42, changePercent24h: 0, source: "coinbase" });
  });
  it("turn an empty or odd answer into nothing, not a zero price", () => {
    expect(parseCoinGecko({})).toBeNull();
    expect(parseBinance({ lastPrice: "n/a" })).toBeNull();
    expect(parseCoinbase(null)).toBeNull();
    expect(parseSparkline({ prices: [[1, 100], [2, "x"], "bad"] })).toEqual([100]);
  });
});

describe("the shared reader", () => {
  const fetcherThat = (answers: Record<string, unknown | Error>) => {
    const calls: string[] = [];
    const fetchJson = async (url: string) => {
      calls.push(new URL(url).host);
      const a = answers[new URL(url).host];
      if (a instanceof Error) throw a;
      if (a === undefined) throw new Error("no answer");
      return a;
    };
    return { fetchJson, calls };
  };

  it("takes the first source that answers and stops asking", async () => {
    const f = fetcherThat({ "api.coingecko.com": GECKO });
    const r = createBtcPriceReader({ fetchJson: f.fetchJson });
    expect((await r.readPrice())?.source).toBe("coingecko");
    expect(f.calls).toEqual(["api.coingecko.com"]);
  });

  it("falls through to the next when one is down", async () => {
    const f = fetcherThat({ "api.coingecko.com": new Error("503"), "api.binance.com": new Error("451"), "api.coinbase.com": COINBASE });
    const r = createBtcPriceReader({ fetchJson: f.fetchJson });
    expect((await r.readPrice())?.source).toBe("coinbase");
    expect(f.calls).toEqual(["api.coingecko.com", "api.binance.com", "api.coinbase.com"]);
  });

  it("answers from memory for a minute, then refreshes behind a stale answer", async () => {
    let t = 1_000_000;
    const f = fetcherThat({ "api.coingecko.com": GECKO });
    const r = createBtcPriceReader({ fetchJson: f.fetchJson, now: () => t });
    await r.readPrice();
    await r.readPrice();
    expect(f.calls.length).toBe(1);
    t += PRICE_TTL_MS + 1;
    const stale = await r.readPrice();
    expect(stale?.price).toBe(61234.5);
    await new Promise((res) => setTimeout(res, 0));
    expect(f.calls.length).toBe(2);
  });

  it("gives nothing, not a crash, when every source is down", async () => {
    const f = fetcherThat({});
    const r = createBtcPriceReader({ fetchJson: f.fetchJson });
    expect(await r.readPrice()).toBeNull();
    expect(await r.readSparkline()).toEqual([]);
  });
});
