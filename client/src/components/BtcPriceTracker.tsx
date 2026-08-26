import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { TrendingUp, TrendingDown, Copy, Check, ArrowRightLeft, Box, Fuel, ChevronDown, ArrowUpRight, ArrowDownLeft, Info, RefreshCw, Wallet, Eye, EyeOff } from "lucide-react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNWC } from "@/contexts/NWCContext";
import type { NWCTransaction } from "@/contexts/NWCContext";
import { fetchUserZaps } from "@/lib/primal-cache";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Event } from "nostr-tools";

interface PriceData {
  price: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  marketCap: number;
}

interface BlockData {
  height: number;
  timestamp: number;
}

interface MempoolFees {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
}

interface ZapActivity {
  sent: number;
  received: number;
  sentCount: number;
  receivedCount: number;
}

function parseBolt11Amount(bolt11: string): number {
  const match = bolt11.match(/lnbc(\d+)([munp]?)/i);
  if (!match) return 0;
  const num = parseInt(match[1]);
  const unit = match[2] || "";
  const btcAmount =
    unit === "m" ? num / 1000 :
    unit === "u" ? num / 1000000 :
    unit === "n" ? num / 1000000000 :
    unit === "p" ? num / 1000000000000 :
    num;
  return Math.round(btcAmount * 100_000_000);
}

function parseZapAmount(zapReceipt: Event): number {
  const bolt11Tag = zapReceipt.tags.find(t => t[0] === "bolt11");
  if (bolt11Tag?.[1]) {
    const sats = parseBolt11Amount(bolt11Tag[1]);
    if (sats > 0) return sats;
  }
  const descTag = zapReceipt.tags.find(t => t[0] === "description");
  if (descTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descTag[1]);
      const amountTag = zapRequest.tags?.find((t: string[]) => t[0] === "amount");
      if (amountTag?.[1]) {
        return Math.floor(parseInt(amountTag[1]) / 1000);
      }
    } catch {}
  }
  return 0;
}

function getZapSenderPubkey(zapReceipt: Event): string | null {
  const descTag = zapReceipt.tags.find(t => t[0] === "description");
  if (descTag?.[1]) {
    try {
      const zapRequest = JSON.parse(descTag[1]);
      return zapRequest.pubkey || null;
    } catch {}
  }
  return null;
}

const zapActivityCache: { data: ZapActivity | null; pubkey: string; ts: number } = {
  data: null,
  pubkey: "",
  ts: 0,
};

async function fetchZapActivity(pubkey: string, force?: boolean, nwcTransactions?: NWCTransaction[]): Promise<ZapActivity | null> {
  const now = Date.now();
  const hasNwcData = nwcTransactions && nwcTransactions.length > 0;
  if (!force && !hasNwcData && zapActivityCache.pubkey === pubkey && zapActivityCache.data && now - zapActivityCache.ts < 5 * 60 * 1000) {
    return zapActivityCache.data;
  }

  try {
    const ninetyDaysAgo = Math.floor((now - 90 * 24 * 60 * 60 * 1000) / 1000);

    const { sent: sentReceipts, received: receivedReceipts } = await fetchUserZaps(pubkey, 200);

    let relayReceived = 0;
    let relayReceivedCount = 0;
    let relaySent = 0;
    let relaySentCount = 0;

    const seenIds = new Set<string>();

    for (const event of receivedReceipts) {
      if (seenIds.has(event.id)) continue;
      if (event.created_at < ninetyDaysAgo) continue;
      seenIds.add(event.id);
      const amount = parseZapAmount(event);
      if (amount <= 0) continue;
      relayReceived += amount;
      relayReceivedCount++;
    }

    for (const event of sentReceipts) {
      if (seenIds.has(event.id)) continue;
      if (event.created_at < ninetyDaysAgo) continue;
      seenIds.add(event.id);
      const amount = parseZapAmount(event);
      if (amount <= 0) {
        const descTag = event.tags.find(t => t[0] === "description");
        if (descTag?.[1]) {
          try {
            const zapReq = JSON.parse(descTag[1]);
            const amtTag = zapReq.tags?.find((t: string[]) => t[0] === "amount");
            if (amtTag?.[1]) {
              const sats = Math.floor(parseInt(amtTag[1]) / 1000);
              if (sats > 0) {
                relaySent += sats;
                relaySentCount++;
                continue;
              }
            }
          } catch {}
        }
        continue;
      }
      relaySent += amount;
      relaySentCount++;
    }

    let nwcReceived = 0;
    let nwcReceivedCount = 0;
    let nwcSent = 0;
    let nwcSentCount = 0;

    if (nwcTransactions && nwcTransactions.length > 0) {
      for (const tx of nwcTransactions) {
        const ts = tx.settled_at || tx.created_at;
        if (ts < ninetyDaysAgo) continue;
        const sats = Math.floor((tx.amount || 0) / 1000);
        if (sats <= 0) continue;
        if (tx.type === "incoming") {
          nwcReceived += sats;
          nwcReceivedCount++;
        } else {
          nwcSent += sats;
          nwcSentCount++;
        }
      }
    }

    const useNwcRecv = nwcReceived > relayReceived;
    const useNwcSent = nwcSent > relaySent;
    const received = useNwcRecv ? nwcReceived : relayReceived;
    const receivedCount = useNwcRecv ? nwcReceivedCount : relayReceivedCount;
    const sent = useNwcSent ? nwcSent : relaySent;
    const sentCount = useNwcSent ? nwcSentCount : relaySentCount;

    const relaySource = `relay: recv=${relayReceived}(${relayReceivedCount}) sent=${relaySent}(${relaySentCount})`;
    const nwcSource = nwcTransactions ? ` | nwc: recv=${nwcReceived}(${nwcReceivedCount}) sent=${nwcSent}(${nwcSentCount})` : "";
    console.log(`[BtcTracker] Zap activity → ${relaySource}${nwcSource} → final: recv=${received}(${receivedCount}), sent=${sent}(${sentCount})`);

    const activity: ZapActivity = { sent, received, sentCount, receivedCount };
    zapActivityCache.data = activity;
    zapActivityCache.pubkey = pubkey;
    zapActivityCache.ts = now;
    return activity;
  } catch (err) {
    console.warn("[BtcTracker] Zap activity fetch failed:", err);
    return null;
  }
}

let sharedPriceCache: { price: number; ts: number } | null = null;

async function fetchPrice(): Promise<PriceData | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error("CoinGecko failed");
    const d = await res.json();
    const md = d.market_data;
    return {
      price: md.current_price.usd,
      changePercent24h: md.price_change_percentage_24h ?? 0,
      high24h: md.high_24h?.usd ?? 0,
      low24h: md.low_24h?.usd ?? 0,
      volume24h: md.total_volume?.usd ?? 0,
      marketCap: md.market_cap?.usd ?? 0,
    };
  } catch {
    try {
      const res = await fetch(
        "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) throw new Error("Binance failed");
      const d = await res.json();
      return {
        price: parseFloat(d.lastPrice),
        changePercent24h: parseFloat(d.priceChangePercent),
        high24h: parseFloat(d.highPrice),
        low24h: parseFloat(d.lowPrice),
        volume24h: parseFloat(d.quoteVolume),
        marketCap: 0,
      };
    } catch {
      try {
        const res = await fetch(
          "https://api.coinbase.com/v2/prices/BTC-USD/spot",
          { signal: AbortSignal.timeout(8000) }
        );
        if (!res.ok) throw new Error("Coinbase failed");
        const d = await res.json();
        return {
          price: parseFloat(d.data.amount),
          changePercent24h: 0,
          high24h: 0,
          low24h: 0,
          volume24h: 0,
          marketCap: 0,
        };
      } catch {
        return null;
      }
    }
  }
}

async function fetchSparkline(): Promise<number[]> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=daily",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const d = await res.json();
    return (d.prices as [number, number][]).map(([, p]) => p);
  } catch {
    return [];
  }
}

async function fetchBlockHeight(): Promise<BlockData | null> {
  try {
    const res = await fetch("https://mempool.space/api/blocks/tip/height", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const height = parseInt(await res.text());
    return { height, timestamp: Date.now() };
  } catch {
    return null;
  }
}

async function fetchMempoolFees(): Promise<MempoolFees | null> {
  try {
    const res = await fetch("https://mempool.space/api/v1/fees/recommended", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 40;
  const w = 160;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const color = positive ? "rgb(52, 211, 153)" : "rgb(248, 113, 113)";
  const gradId = "spark-grad";

  const areaPath = `M0,${h} L${data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" L")} L${w},${h} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full h-10">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatCompact(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 10_000) return `${(sats / 1_000).toFixed(1)}k`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}k`;
  return sats.toLocaleString();
}

type BadgeMode = "price" | "wallet";

function formatSatsCompact(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 10_000) return `${(sats / 1_000).toFixed(1)}k`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}k`;
  return sats.toLocaleString();
}

const BTC_ICON_SVG = (
  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M14.97 12.75H14.2H9.53003V15.58H10.84H14.97C15.92 15.58 16.7 14.94 16.7 14.16C16.7 13.38 15.92 12.75 14.97 12.75Z" />
    <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM14.97 17.08H13.32V18.5C13.32 18.91 12.98 19.25 12.57 19.25C12.16 19.25 11.82 18.91 11.82 18.5V17.08H10.84H10.61V18.5C10.61 18.91 10.27 19.25 9.86 19.25C9.45 19.25 9.11 18.91 9.11 18.5V17.08H8.78H7.05C6.64 17.08 6.3 16.74 6.3 16.33C6.3 15.92 6.64 15.58 7.05 15.58H8.03V12V8.42H7.05C6.64 8.42 6.3 8.08 6.3 7.67C6.3 7.26 6.64 6.92 7.05 6.92H8.78H9.11V5.5C9.11 5.09 9.45 4.75 9.86 4.75C10.27 4.75 10.61 5.09 10.61 5.5V6.92H10.84H11.82V5.5C11.82 5.09 12.16 4.75 12.57 4.75C12.98 4.75 13.32 5.09 13.32 5.5V6.92H14.2C15.75 6.92 17.12 8.28 17.12 9.84C17.12 10.51 16.88 11.12 16.5 11.62C17.51 12.11 18.2 13.07 18.2 14.18C18.2 15.77 16.75 17.08 14.97 17.08Z" />
    <path d="M15.62 9.83016C15.62 9.17016 15 8.41016 14.2 8.41016H10.84H9.53003V11.2402H14.2C14.98 11.2502 15.62 10.6102 15.62 9.83016Z" />
  </svg>
);

export function UnifiedBtcBadge() {
  const { pubkey } = useNostrAuth();
  const { isConnected: nwcConnected, balance, balanceLoading, listTransactions } = useNWC();
  const [, navigate] = useLocation();

  const [trackerEnabled, setTrackerEnabled] = useState(() => localStorage.getItem("btcTrackerEnabled") === "true");

  useEffect(() => {
    const sync = () => setTrackerEnabled(localStorage.getItem("btcTrackerEnabled") === "true");
    window.addEventListener("btc-tracker-visibility-changed", sync);
    return () => window.removeEventListener("btc-tracker-visibility-changed", sync);
  }, []);

  const [mode, setMode] = useState<BadgeMode>(() => {
    const saved = localStorage.getItem("btcBadgeMode") as BadgeMode | null;
    if (saved === "wallet" && !nwcConnected) return "price";
    return saved || "price";
  });
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const [data, setData] = useState<PriceData | null>(null);
  const [priceFlash, setPriceFlash] = useState<"up" | "down" | null>(null);
  const prevPriceRef = useRef<number>(0);

  const [walletFlash, setWalletFlash] = useState(false);
  const prevBalanceRef = useRef<number | null>(null);

  const [sparkline, setSparkline] = useState<number[]>([]);
  const [block, setBlock] = useState<BlockData | null>(null);
  const [fees, setFees] = useState<MempoolFees | null>(null);
  const [zapActivity, setZapActivity] = useState<ZapActivity | null>(null);
  const [zapLoading, setZapLoading] = useState(false);
  const [satsInput, setSatsInput] = useState("");
  const [convertMode, setConvertMode] = useState<"usd-to-sats" | "sats-to-usd">("usd-to-sats");
  const [copied, setCopied] = useState(false);
  const [balanceHidden, setBalanceHidden] = useState(() => localStorage.getItem("walletBalanceHidden") === "true");

  const toggleBalanceVisibility = useCallback(() => {
    setBalanceHidden(prev => {
      const next = !prev;
      localStorage.setItem("walletBalanceHidden", String(next));
      window.dispatchEvent(new Event("balance-visibility-changed"));
      return next;
    });
  }, []);

  useEffect(() => {
    const sync = () => setBalanceHidden(localStorage.getItem("walletBalanceHidden") === "true");
    window.addEventListener("balance-visibility-changed", sync);
    return () => window.removeEventListener("balance-visibility-changed", sync);
  }, []);

  useEffect(() => {
    if (!nwcConnected && mode === "wallet") {
      setMode("price");
    }
  }, [nwcConnected, mode]);

  const toggleMode = useCallback(() => {
    if (!nwcConnected) return;
    const next: BadgeMode = mode === "price" ? "wallet" : "price";
    setMode(next);
    localStorage.setItem("btcBadgeMode", next);
  }, [mode, nwcConnected]);

  const refreshZapActivity = useCallback(async (force?: boolean) => {
    if (!pubkey) return;
    setZapLoading(true);
    let nwcTxs: NWCTransaction[] | undefined;
    if (nwcConnected) {
      try {
        nwcTxs = await listTransactions(200);
      } catch {}
    }
    const result = await fetchZapActivity(pubkey, force, nwcTxs);
    setZapActivity(result);
    setZapLoading(false);
  }, [pubkey, nwcConnected, listTransactions]);

  const update = useCallback(async () => {
    const result = await fetchPrice();
    if (!result) return;
    if (prevPriceRef.current > 0 && result.price !== prevPriceRef.current) {
      setPriceFlash(result.price > prevPriceRef.current ? "up" : "down");
      setTimeout(() => setPriceFlash(null), 800);
    }
    prevPriceRef.current = result.price;
    sharedPriceCache = { price: result.price, ts: Date.now() };
    setData(result);
  }, []);

  useEffect(() => {
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [update]);

  useEffect(() => {
    if (prevBalanceRef.current !== null && balance !== null && balance !== prevBalanceRef.current) {
      setWalletFlash(true);
      const t = setTimeout(() => setWalletFlash(false), 1500);
      prevBalanceRef.current = balance;
      return () => clearTimeout(t);
    }
    prevBalanceRef.current = balance;
  }, [balance]);

  useEffect(() => {
    if (!open) return;
    fetchPrice().then((d) => { if (d) setData(d); });
    fetchSparkline().then(setSparkline);
    fetchBlockHeight().then(setBlock);
    fetchMempoolFees().then(setFees);
    if (pubkey) refreshZapActivity();
  }, [open, pubkey, refreshZapActivity]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: PointerEvent | MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    }
    const timer = setTimeout(() => {
      document.addEventListener("pointerdown", handleClick);
      document.addEventListener("mousedown", handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", handleClick);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  useEffect(() => {
    const handler = () => setOpen(false);
    window.addEventListener("header-popout-open", handler);
    return () => window.removeEventListener("header-popout-open", handler);
  }, []);

  const formatPrice = (p: number) =>
    p.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const isPositive = data ? data.changePercent24h >= 0 : true;
  const satsPerDollar = data ? Math.round(100_000_000 / data.price) : 0;

  const convertedValue = (() => {
    const num = parseFloat(satsInput);
    if (!num || !data) return "";
    if (convertMode === "usd-to-sats") {
      return Math.round((num / data.price) * 100_000_000).toLocaleString() + " sats";
    } else {
      return "$" + ((num * data.price) / 100_000_000).toFixed(2);
    }
  })();

  const handleCopyPrice = () => {
    if (!data) return;
    navigator.clipboard.writeText(`$${formatPrice(data.price)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleTogglePanel = () => {
    const next = !open;
    if (next) window.dispatchEvent(new Event("header-popout-open"));
    setOpen(next);
  };

  const badgeFlashClass = mode === "wallet" && walletFlash
    ? "ring-1 ring-brand/50 shadow-[0_0_8px_rgba(139,92,246,0.3)]"
    : "";

  if (!trackerEnabled) return null;

  return (
    <div className="relative" ref={panelRef}>
      <div
        className={`flex items-center gap-0 rounded-lg bg-foreground/[0.04] dark:bg-white/[0.04] border border-transparent select-none shrink-0 transition-all duration-300 ${badgeFlashClass}`}
        data-testid="container-unified-btc-badge"
      >
        <button
          onClick={toggleMode}
          className={`flex items-center gap-1 px-2 py-1 rounded-l-lg text-xs font-semibold tabular-nums cursor-pointer transition-all duration-200 hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] ${!nwcConnected ? "rounded-lg" : ""}`}
          data-testid="button-badge-toggle"
          title={nwcConnected ? `Switch to ${mode === "price" ? "wallet" : "price"} view` : "BTC Price"}
        >
          <div className="relative w-3.5 h-3.5 overflow-hidden">
            <div className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ${mode === "price" ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full"}`}>
              {BTC_ICON_SVG}
            </div>
            <div className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ${mode === "wallet" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full"}`}>
              <BtcZapIcon className="w-3.5 h-3.5 text-brand" />
            </div>
          </div>
          <div className="relative overflow-hidden" style={{ minWidth: "2rem" }}>
            <div className={`transition-all duration-200 ${mode === "price" ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full absolute inset-0"}`}>
              {data ? (
                <span className={`text-xs font-semibold tabular-nums transition-colors duration-300 whitespace-nowrap ${
                  priceFlash === "up" ? "text-emerald-800 dark:text-emerald-400" : priceFlash === "down" ? "text-red-700 dark:text-red-400" : "text-foreground/80"
                }`} data-testid="text-unified-price">
                  ${formatPrice(data.price)}
                </span>
              ) : (
                <span className="flex items-center gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30 animate-pulse" />
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/30 animate-pulse" style={{ animationDelay: "0.2s" }} />
                </span>
              )}
            </div>
            <div className={`transition-all duration-200 ${mode === "wallet" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full absolute inset-0"}`}>
              {balanceLoading && balance === null ? (
                <span className="w-8 h-3 rounded bg-foreground/10 dark:bg-white/10 animate-pulse inline-block" />
              ) : balance !== null ? (
                <span className={`text-xs font-semibold tabular-nums text-foreground/80 whitespace-nowrap transition-all duration-200 ${balanceHidden ? "blur-[6px] select-none" : ""}`} data-testid="text-unified-balance">
                  <span className="hidden sm:inline">{balance.toLocaleString()}</span>
                  <span className="sm:hidden">{formatSatsCompact(balance)}</span>
                </span>
              ) : (
                <span className="text-muted-foreground/40 text-xs">--</span>
              )}
            </div>
          </div>
          {data && mode === "price" && data.changePercent24h !== 0 && (
            <span className={`text-[10px] tabular-nums font-medium flex items-center gap-0.5 ${isPositive ? "text-emerald-800/80 dark:text-emerald-400/80" : "text-red-700/80 dark:text-red-400/80"}`} data-testid="text-unified-change">
              {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
              {isPositive ? "+" : ""}{data.changePercent24h.toFixed(1)}%
            </span>
          )}
        </button>
        <button
          onClick={handleTogglePanel}
          className="flex items-center px-1.5 py-1 rounded-r-lg cursor-pointer hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] transition-colors border-l border-foreground/[0.06] dark:border-white/[0.06]"
          data-testid="button-badge-expand"
          title="Details"
        >
          <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && data && (() => {
        const panelContent = (
          <Card
            ref={dropdownRef}
            className={
              isMobile
                ? "fixed inset-x-3 top-[calc(4.25rem+env(safe-area-inset-top,0px))] p-0 z-[9999] shadow-xl shadow-black/40 border border-white/[0.08] bg-card/95 backdrop-blur-sm max-h-[calc(100dvh-5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] overflow-y-auto overscroll-contain animate-in fade-in slide-in-from-top-2 duration-200"
                : "absolute right-0 top-full mt-2 w-72 p-0 z-[60] shadow-xl shadow-black/40 border border-white/[0.08] bg-card/95 backdrop-blur-sm max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain"
            }
            data-testid="panel-unified-details"
          >
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-6 h-6 text-amber-800 dark:text-amber-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14.97 12.75H14.2H9.53003V15.58H10.84H14.97C15.92 15.58 16.7 14.94 16.7 14.16C16.7 13.38 15.92 12.75 14.97 12.75Z" />
                  <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM14.97 17.08H13.32V18.5C13.32 18.91 12.98 19.25 12.57 19.25C12.16 19.25 11.82 18.91 11.82 18.5V17.08H10.84H10.61V18.5C10.61 18.91 10.27 19.25 9.86 19.25C9.45 19.25 9.11 18.91 9.11 18.5V17.08H8.78H7.05C6.64 17.08 6.3 16.74 6.3 16.33C6.3 15.92 6.64 15.58 7.05 15.58H8.03V12V8.42H7.05C6.64 8.42 6.3 8.08 6.3 7.67C6.3 7.26 6.64 6.92 7.05 6.92H8.78H9.11V5.5C9.11 5.09 9.45 4.75 9.86 4.75C10.27 4.75 10.61 5.09 10.61 5.5V6.92H10.84H11.82V5.5C11.82 5.09 12.16 4.75 12.57 4.75C12.98 4.75 13.32 5.09 13.32 5.5V6.92H14.2C15.75 6.92 17.12 8.28 17.12 9.84C17.12 10.51 16.88 11.12 16.5 11.62C17.51 12.11 18.2 13.07 18.2 14.18C18.2 15.77 16.75 17.08 14.97 17.08Z" />
                  <path d="M15.62 9.83016C15.62 9.17016 15 8.41016 14.2 8.41016H10.84H9.53003V11.2402H14.2C14.98 11.2502 15.62 10.6102 15.62 9.83016Z" />
                </svg>
                <div>
                  <span className="text-lg font-bold text-foreground">${formatPrice(data.price)}</span>
                  <span className={`ml-2 text-xs font-medium ${isPositive ? "text-emerald-800 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                    {isPositive ? "+" : ""}{data.changePercent24h.toFixed(2)}%
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyPrice} data-testid="button-copy-unified-price">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-800 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </Button>
            </div>
            {sparkline.length > 1 && <Sparkline data={sparkline} positive={isPositive} />}
          </div>

          {nwcConnected && balance !== null && (
            <div className="border-t border-white/[0.06] flex items-center">
              <button
                onClick={() => { setOpen(false); navigate("/wallet"); }}
                className="flex-1 px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.03] transition-colors text-left cursor-pointer"
                data-testid="button-open-wallet"
              >
                <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center shrink-0">
                  <Wallet className="w-4 h-4 text-brand" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground/60">Wallet Balance</p>
                  <p className={`text-sm font-semibold tabular-nums text-foreground/90 transition-all duration-200 ${balanceHidden ? "blur-[6px] select-none" : ""}`} data-testid="text-panel-wallet-balance">
                    {balance.toLocaleString()} <span className="text-xs font-normal text-muted-foreground/50">sats</span>
                  </p>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
              </button>
              <button
                onClick={toggleBalanceVisibility}
                className="px-3 py-2.5 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer shrink-0"
                data-testid="button-toggle-balance-panel"
                title={balanceHidden ? "Show balance" : "Hide balance"}
              >
                {balanceHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}

          <div className="px-4 py-2 border-t border-white/[0.06]">
            <div className="grid grid-cols-2 gap-3 text-xs">
              {data.high24h > 0 && (
                <div>
                  <p className="text-muted-foreground/50 mb-0.5">24h High</p>
                  <p className="font-medium text-foreground/80">${formatPrice(data.high24h)}</p>
                </div>
              )}
              {data.low24h > 0 && (
                <div>
                  <p className="text-muted-foreground/50 mb-0.5">24h Low</p>
                  <p className="font-medium text-foreground/80">${formatPrice(data.low24h)}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground/50 mb-0.5">Sats / $1</p>
                <p className="font-medium text-foreground/80">{satsPerDollar.toLocaleString()}</p>
              </div>
              {data.volume24h > 0 && (
                <div>
                  <p className="text-muted-foreground/50 mb-0.5">Volume</p>
                  <p className="font-medium text-foreground/80">{formatCompact(data.volume24h)}</p>
                </div>
              )}
            </div>
          </div>

          {block && (
            <div className="px-4 py-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-xs">
                <Box className="w-3 h-3 text-amber-800/70 dark:text-amber-400/70" />
                <span className="text-muted-foreground/50">Block</span>
                <span className="font-mono font-medium text-foreground/80">{block.height.toLocaleString()}</span>
              </div>
            </div>
          )}

          {fees && (
            <div className="px-4 py-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-1.5 text-xs mb-1.5">
                <Fuel className="w-3 h-3 text-orange-800/70 dark:text-orange-400/70" />
                <span className="text-muted-foreground/50">Mempool Fees (sat/vB)</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground/40 text-[10px]">Fast</p>
                  <p className="font-mono font-medium text-foreground/80">{fees.fastestFee}</p>
                </div>
                <div>
                  <p className="text-muted-foreground/40 text-[10px]">Medium</p>
                  <p className="font-mono font-medium text-foreground/80">{fees.halfHourFee}</p>
                </div>
                <div>
                  <p className="text-muted-foreground/40 text-[10px]">Slow</p>
                  <p className="font-mono font-medium text-foreground/80">{fees.hourFee}</p>
                </div>
              </div>
            </div>
          )}

          {pubkey && (
            <div className="px-4 py-3 border-t border-white/[0.06]" data-testid="container-unified-zap-activity">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Lightning Activity (90d)</p>
                <button
                  onClick={() => refreshZapActivity(true)}
                  disabled={zapLoading}
                  className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors disabled:opacity-30"
                  data-testid="button-unified-refresh-zap"
                >
                  <RefreshCw className={`w-3 h-3 ${zapLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              {zapActivity && !zapLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-start gap-2">
                    <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-800/70 dark:text-emerald-400/70 mt-0.5 shrink-0" />
                    <div>
                      <p className={`text-xs font-semibold tabular-nums text-foreground/80 transition-all duration-200 ${balanceHidden ? "blur-[5px] select-none" : ""}`} data-testid="text-unified-zaps-received">
                        {formatSats(zapActivity.received)} sats
                      </p>
                      <p className="text-[11px] text-muted-foreground/50">
                        {zapActivity.receivedCount} received
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <ArrowUpRight className="w-3.5 h-3.5 text-amber-800/70 dark:text-amber-400/70 mt-0.5 shrink-0" />
                    <div>
                      <p className={`text-xs font-semibold tabular-nums text-foreground/80 transition-all duration-200 ${balanceHidden ? "blur-[5px] select-none" : ""}`} data-testid="text-unified-zaps-sent">
                        {formatSats(zapActivity.sent)} sats
                      </p>
                      <p className="text-[11px] text-muted-foreground/50">
                        {zapActivity.sentCount} sent
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="w-20 h-8 bg-muted/20 rounded animate-pulse" />
                  <div className="w-20 h-8 bg-muted/20 rounded animate-pulse" />
                </div>
              )}
            </div>
          )}

          <div className="px-4 py-3 border-t border-white/[0.06]">
            <div className="flex items-center gap-2 mb-2">
              <ArrowRightLeft className="w-3 h-3 text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground/50">Convert</span>
              <button
                className="ml-auto text-[10px] text-brand/60 hover:text-brand/80 transition-colors"
                onClick={() => {
                  setSatsInput("");
                  setConvertMode((m) => (m === "usd-to-sats" ? "sats-to-usd" : "usd-to-sats"));
                }}
                data-testid="button-unified-convert-toggle"
              >
                {convertMode === "usd-to-sats" ? "USD → Sats" : "Sats → USD"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder={convertMode === "usd-to-sats" ? "USD amount" : "Sats amount"}
                value={satsInput}
                onChange={(e) => setSatsInput(e.target.value)}
                className="h-7 text-xs bg-muted/10 border-white/[0.06]"
                style={{ fontSize: 16 }}
                data-testid="input-unified-convert"
              />
              {convertedValue && (
                <span className="text-xs font-medium text-foreground/80 whitespace-nowrap">{convertedValue}</span>
              )}
            </div>
          </div>

          <div className="px-4 py-2 border-t border-white/[0.06] flex items-center justify-between">
            <a
              href="https://bitcoin.org/bitcoin.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors flex items-center gap-1"
              data-testid="link-unified-whitepaper"
            >
              <Info className="w-2.5 h-2.5" /> Bitcoin Whitepaper
            </a>
          </div>
          </Card>
        );
        return isMobile ? createPortal(panelContent, document.body) : panelContent;
      })()}
    </div>
  );
}
