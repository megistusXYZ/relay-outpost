/**
 * The Bitcoin price badge's numbers, read server-side.
 *
 * The app used to ask CoinGecko and Binance straight from the browser, and
 * both refuse browser origins (no CORS header), so every visitor paid two
 * failed requests before Coinbase answered with a bare spot price and no
 * 24-hour change. Now one reader here asks the sources in order, keeps the
 * answer for a minute, and every visitor shares it. Nothing about money moves
 * through this; it is a number on a badge.
 */
export interface PriceData {
  price: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  marketCap: number;
  /** Which source answered — the badge says so when it is the thin one. */
  source: "coingecko" | "binance" | "coinbase";
}

export type JsonFetch = (url: string) => Promise<unknown>;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);

export function parseCoinGecko(json: unknown): PriceData | null {
  const md = (json as { market_data?: Record<string, Record<string, unknown>> } | null)?.market_data;
  const price = num(md?.current_price?.usd);
  if (!price) return null;
  return {
    price,
    changePercent24h: num(md?.price_change_percentage_24h),
    high24h: num(md?.high_24h?.usd),
    low24h: num(md?.low_24h?.usd),
    volume24h: num(md?.total_volume?.usd),
    marketCap: num(md?.market_cap?.usd),
    source: "coingecko",
  };
}

export function parseBinance(json: unknown): PriceData | null {
  const d = json as Record<string, unknown> | null;
  const price = num(d?.lastPrice);
  if (!price) return null;
  return { price, changePercent24h: num(d?.priceChangePercent), high24h: num(d?.highPrice), low24h: num(d?.lowPrice), volume24h: num(d?.quoteVolume), marketCap: 0, source: "binance" };
}

export function parseCoinbase(json: unknown): PriceData | null {
  const price = num((json as { data?: { amount?: unknown } } | null)?.data?.amount);
  if (!price) return null;
  return { price, changePercent24h: 0, high24h: 0, low24h: 0, volume24h: 0, marketCap: 0, source: "coinbase" };
}

export function parseSparkline(json: unknown): number[] {
  const prices = (json as { prices?: unknown } | null)?.prices;
  if (!Array.isArray(prices)) return [];
  return prices.map((p) => (Array.isArray(p) ? num(p[1]) : 0)).filter((p) => p > 0);
}

export const PRICE_SOURCES: ReadonlyArray<{ id: PriceData["source"]; url: string; parse: (json: unknown) => PriceData | null }> = [
  { id: "coingecko", url: "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false", parse: parseCoinGecko },
  { id: "binance", url: "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT", parse: parseBinance },
  { id: "coinbase", url: "https://api.coinbase.com/v2/prices/BTC-USD/spot", parse: parseCoinbase },
];
export const SPARKLINE_URL = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=daily";

export const PRICE_TTL_MS = 60_000;
export const SPARKLINE_TTL_MS = 10 * 60_000;

/**
 * One reader for the process: the first source that answers wins; the answer
 * is kept for PRICE_TTL_MS; a stale answer is handed out while a fresh one is
 * being read; concurrent callers share one read.
 */
export function createBtcPriceReader(deps: { fetchJson: JsonFetch; now?: () => number }) {
  const now = deps.now ?? (() => Date.now());
  let price: { data: PriceData; at: number } | null = null;
  let priceInFlight: Promise<PriceData | null> | null = null;
  let spark: { data: number[]; at: number } | null = null;
  let sparkInFlight: Promise<number[]> | null = null;

  async function readPriceFresh(): Promise<PriceData | null> {
    for (const s of PRICE_SOURCES) {
      try {
        const parsed = s.parse(await deps.fetchJson(s.url));
        if (parsed) { price = { data: parsed, at: now() }; return parsed; }
      } catch {}
    }
    return price?.data ?? null;
  }

  return {
    async readPrice(): Promise<PriceData | null> {
      if (price && now() - price.at < PRICE_TTL_MS) return price.data;
      if (!priceInFlight) priceInFlight = readPriceFresh().finally(() => { priceInFlight = null; });
      // Stale is better than a wait: hand out the old number and refresh behind it.
      return price ? price.data : priceInFlight;
    },
    async readSparkline(): Promise<number[]> {
      if (spark && now() - spark.at < SPARKLINE_TTL_MS) return spark.data;
      if (!sparkInFlight) {
        sparkInFlight = deps.fetchJson(SPARKLINE_URL)
          .then((json) => { const data = parseSparkline(json); if (data.length) spark = { data, at: now() }; return data; })
          .catch(() => spark?.data ?? [])
          .finally(() => { sparkInFlight = null; });
      }
      return spark ? spark.data : sparkInFlight;
    },
  };
}
