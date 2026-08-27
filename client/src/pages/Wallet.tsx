import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { MissionBriefing, WALLET_BRIEFING } from "@/components/MissionBriefing";
import { isToday, isYesterday, isThisWeek, isThisMonth, format as formatDate } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { QRCodeSVG } from "qrcode.react";
import { decode as decodeBolt11Invoice } from "light-bolt11-decoder";
import { useNWC } from "@/contexts/NWCContext";
import type { NWCTransaction } from "@/contexts/NWCContext";
import { useToast } from "@/hooks/use-toast";
import { signWithTimeout } from "@/lib/signer-timeout";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { BtcZapIcon } from "@/components/NostrPost";
import { ProfileLink } from "@/components/analytics/ProfileLink";
import { ProfileSearchInput, type SelectedRecipient } from "@/components/ProfileSearchInput";
import { fetchProfilesCached, pool, DEFAULT_RELAYS, eventStore, getRelaysForPurpose, publishEvent, verifySignedEventKind } from "@/lib/nostr";
import { fetchNpubCashClaimable } from "@/lib/npubcash-api";
import { localSweepKey, sweepNpubCash, type SweepOutcome } from "@/lib/npubcash-sweep";
import { readIssuedQuotes, readStash, stashTotalSats } from "@/lib/npubcash-sweep-core";
import type { ISigner } from "applesauce-signers";
import type { Event as NostrToolsEvent } from "nostr-tools";
import { isNpubCashAddress, sumZapSats, NPUB_CASH_CLAIM_URL } from "@/lib/npubcash";
import { getLightningAddress, resolveLnurl, buildZapRequest, fetchZapInvoice } from "@/lib/zap";
import { getProfileContent, KIND_METADATA } from "@/lib/nostr-helpers";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { sendDM } from "@/lib/dm";
import { fetchRelayLists } from "@/lib/outbox";
import { use$ } from "applesauce-react/hooks";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { Link } from "wouter";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  RefreshCw,
  Unplug,
  QrCode,
  Send,
  Clock,
  AlertCircle,
  Radio,
  ChevronDown,
  ChevronUp,
  Share2,
  Zap,
  TrendingUp,
  TrendingDown,
  Hash,
  BarChart3,
  CircleDollarSign,
  Orbit,
  Eye,
  MessageCircle,
  X,
  ExternalLink,
  ArrowLeftRight,
  Filter,
  ScanLine,
  Camera,
  EyeOff,
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Pencil,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Settings2 } from "lucide-react";
import {
  type ZapPreset, DEFAULT_ZAP_PRESETS, getZapPresets, saveZapPresets,
  getDefaultZapAmount, saveDefaultZapAmount, EMOJI_OPTIONS } from "@/lib/zap-presets";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

function QRScannerDialog({ open, onClose, onScan }: { open: boolean; onClose: () => void; onScan: (data: string) => void }) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrRef = useRef<{ stop: () => Promise<void>; clear: () => Promise<void> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const hasScannedRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  onScanRef.current = onScan;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      hasScannedRef.current = false;
      return;
    }

    let mounted = true;
    setError(null);
    setScanning(false);

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!mounted || !scannerRef.current) return;

        const scannerId = "qr-scanner-region";
        let el = document.getElementById(scannerId);
        if (!el && scannerRef.current) {
          el = document.createElement("div");
          el.id = scannerId;
          scannerRef.current.appendChild(el);
        }
        if (!el) return;

        const scanner = new Html5Qrcode(scannerId);
        html5QrRef.current = scanner;
        setScanning(true);

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0 },
          (decodedText: string) => {
            if (hasScannedRef.current) return;
            hasScannedRef.current = true;
            onScanRef.current(decodedText);
            scanner.stop().then(() => scanner.clear()).catch((e) => console.warn("[Wallet] Scanner cleanup failed:", e?.message));
            onCloseRef.current();
          },
          () => {},
        );
      } catch (err: unknown) {
        if (!mounted) return;
        const e = err as { name?: string; message?: string };
        if (e?.name === "NotAllowedError") {
          setError("Camera permission denied. Please allow camera access in your browser settings.");
        } else if (e?.name === "NotFoundError") {
          setError("No camera found on this device.");
        } else {
          setError(e?.message || "Could not start camera. Try using a mobile device.");
        }
        setScanning(false);
      }
    };

    const timer = setTimeout(startScanner, 300);

    return () => {
      mounted = false;
      clearTimeout(timer);
      if (html5QrRef.current) {
        const s = html5QrRef.current;
        s.stop().then(() => s.clear()).catch((e) => console.warn("[Wallet] Scanner cleanup on unmount failed:", e?.message));
        html5QrRef.current = null;
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden border-border" data-testid="dialog-qr-scanner">
        <VisuallyHidden><DialogTitle>Scan QR Code</DialogTitle></VisuallyHidden>
        <VisuallyHidden><p id="qr-scanner-desc">Scan a Lightning invoice or address QR code to pay</p></VisuallyHidden>
        <div className="p-4 space-y-3" aria-describedby="qr-scanner-desc">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-brand" />
              <span className="text-sm font-semibold">Scan QR Code</span>
            </div>
          </div>

          <div
            ref={scannerRef}
            className="relative w-full aspect-square rounded-lg overflow-hidden bg-black/90"
            data-testid="container-qr-scanner"
          >
            {!scanning && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <Camera className="w-8 h-8 text-white/30 animate-pulse" />
                <span className="text-xs text-white/40">Starting camera...</span>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <p className="text-[11px] text-center text-muted-foreground/60">
            Point your camera at a Lightning invoice, LNURL, or lightning address QR code
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

let payloadIdCounter = 0;

function PayloadReceiveIcon({ className }: { className?: string }) {
  const [id] = useState(() => `recv-${++payloadIdCounter}`);
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`payload-tx-icon ${className || ""}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-g`} x1="12" y1="4" x2="12" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <path
        d="M8 13 C8 11.5, 9 10.5, 12 10.5 C15 10.5, 16 11.5, 16 13 L16 17 C16 18.5, 15 19.5, 12 19.5 C9 19.5, 8 18.5, 8 17 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={`url(#${id}-g)`}
      />
      <rect x="9.5" y="13.5" width="5" height="4" rx="1" fill="currentColor" opacity="0.2" />
      <path d="M12 4 L12 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" strokeDasharray="2 2">
        <animate attributeName="stroke-dashoffset" values="0;-4" dur="1s" repeatCount="indefinite" />
      </path>
      <path d="M10 8 L12 10.5 L14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <circle cx="12" cy="5.5" r="1.3" fill="currentColor" opacity="0.7">
        <animate attributeName="cy" values="4;9;4" dur="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" />
        <animate attributeName="opacity" values="0.8;0.15;0.8" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function PayloadDeployIcon({ className }: { className?: string }) {
  const [id] = useState(() => `send-${++payloadIdCounter}`);
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`payload-tx-icon ${className || ""}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-g`} x1="12" y1="20" x2="12" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <path
        d="M8 13 C8 11.5, 9 10.5, 12 10.5 C15 10.5, 16 11.5, 16 13 L16 17 C16 18.5, 15 19.5, 12 19.5 C9 19.5, 8 18.5, 8 17 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={`url(#${id}-g)`}
        strokeDasharray="3 2"
        opacity="0.6"
      />
      <path d="M12 10.5 L12 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" strokeDasharray="2 2">
        <animate attributeName="stroke-dashoffset" values="0;4" dur="1s" repeatCount="indefinite" />
      </path>
      <path d="M10 6.5 L12 4 L14 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <circle cx="12" cy="8" r="1.3" fill="currentColor" opacity="0.7">
        <animate attributeName="cy" values="9;3;9" dur="2s" repeatCount="indefinite" calcMode="spline" keySplines="0.4 0 0.2 1;0.4 0 0.2 1" />
        <animate attributeName="opacity" values="0.8;0.15;0.8" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

type ZapPrivacy = "public" | "anonymous";

interface ZapEnrichment {
  senderPubkey: string | null;
  recipientPubkey: string | null;
  eventId: string | null;
  message: string;
  lnAddress: string | null;
  isZap?: boolean;
}

/**
 * "Claim your zaps" — shown whenever the profile's lightning address points at
 * npub.cash (owner request, 2026-08-18, after the "how did this account get
 * zapped with no wallet?" confusion). npub.cash answers for every npub with no
 * signup, so zaps sent there are REAL and settled — they sit at its Cashu mint
 * credited to this npub until the key-holder claims them. The card names that
 * state and hands over the two exits: claim, or point the address elsewhere.
 *
 * The waiting total is reach-honest: it renders only after relays actually
 * answered the kind-9735 query, as an "at least" (receipts can live on relays
 * we didn't ask, and unparseable amounts add zero). No answer → no number —
 * the card still explains where zaps go, which is the part that must not wait.
 */
/** "1 sat", "63 sats" — money copy must never say "1 sats" (live-fire 2026-08-26). */
const fmtSats = (n: number) => `${n.toLocaleString()} sat${n === 1 ? "" : "s"}`;

/** Sweep stages in words a first-time user understands — never the raw stage names. */
function sweepProgressLabel(stage: string, detail?: string): string {
  switch (stage) {
    case "quotes": return "Checking what's waiting for you…";
    case "minting": return detail ? `Collecting ${detail}…` : "Collecting your sats…";
    case "invoice": return detail ? `Preparing to send ${detail}…` : "Preparing to send…";
    case "melting": return detail ? `Sending ${detail} to your wallet…` : "Sending to your wallet…";
    default: return "Working…";
  }
}

function NpubCashClaimCard({ myPubkey, lud16, signer }: { myPubkey: string | null; lud16: string | null; signer: ISigner | null }) {
  const show = isNpubCashAddress(lud16);
  const [showHow, setShowHow] = useState(false);
  // Two sources, one honest ladder: the service's OWN claimable ledger when
  // its API answers (exact, works for every signer type — NIP-98 is a plain
  // nostr event), else the relay receipts as an "at least" floor, else no
  // number. Never a confident zero from silence.
  const [exact, setExact] = useState<{ sats: number; count: number } | null>(null);
  const [waiting, setWaiting] = useState<{ sats: number; count: number } | null>(null);
  useEffect(() => {
    if (!show || !myPubkey) return;
    let cancelled = false;
    if (signer) {
      fetchNpubCashClaimable(signer, readIssuedQuotes(myPubkey))
        .then((r) => { if (!cancelled && r.reached && r.data) setExact(r.data); })
        .catch(() => {});
    }
    const relays = Array.from(new Set([...getRelaysForPurpose("notes"), ...DEFAULT_RELAYS])).slice(0, 8);
    pool.querySync(relays, { kinds: [9735], "#p": [myPubkey], limit: 500 })
      .then((receipts) => { if (!cancelled) setWaiting(sumZapSats(receipts)); })
      .catch(() => { /* unreached → the card stays numberless, never wrong */ });
    return () => { cancelled = true; };
  }, [show, myPubkey, signer]);

  // ── In-app sweep (local-key accounts only — see npubcash-sweep.ts) ────────
  const { isConnected: nwcConnected, makeInvoice } = useNWC();
  const sweepKey = localSweepKey(signer);
  const [stashVersion, setStashVersion] = useState(0);
  const stashSats = useMemo(
    () => (myPubkey ? stashTotalSats(readStash(myPubkey)) : 0),
    [myPubkey, stashVersion],
  );
  const [sweeping, setSweeping] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SweepOutcome | null>(null);
  // The paste-an-invoice handshake: the sweep asks for an invoice of an exact
  // amount mid-flow; this state renders the ask and the resolver hands the
  // pasted bolt11 back into the (still-awaiting) sweep.
  const [askInvoice, setAskInvoice] = useState<{ amount: number } | null>(null);
  const invoiceResolver = useRef<((inv: string | null) => void) | null>(null);
  // Accepts a bolt11 invoice OR a lightning address (live-fire lesson,
  // 2026-08-18: consumer wallets bury the raw invoice — the owner couldn't
  // find one. An address like you@wallet.com is what people actually know,
  // and the zap flow's server-proxied LNURL client already fetches invoices
  // for arbitrary addresses). Last-used address is remembered for next time.
  const [pastedInvoice, setPastedInvoice] = useState(() => {
    try { return localStorage.getItem("ro_sweep_last_addr") ?? ""; } catch { return ""; }
  });
  const [resolvingAddr, setResolvingAddr] = useState(false);
  const [invoiceErr, setInvoiceErr] = useState<string | null>(null);
  const isLnAddress = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

  const useDestination = async () => {
    const raw = pastedInvoice.trim();
    setInvoiceErr(null);
    if (raw.toLowerCase().startsWith("lnbc")) {
      invoiceResolver.current?.(raw);
      setAskInvoice(null);
      return;
    }
    if (!isLnAddress(raw) || !askInvoice) return;
    setResolvingAddr(true);
    try {
      const info = await resolveLnurl(raw);
      const msat = askInvoice.amount * 1000;
      if (msat < info.minSendable || msat > info.maxSendable) {
        throw new Error(`${raw.split("@")[1]} can't receive exactly ${askInvoice.amount} sats (allowed: ${Math.ceil(info.minSendable / 1000)}–${Math.floor(info.maxSendable / 1000)}).`);
      }
      const inv = await fetchZapInvoice(info, msat);
      try { localStorage.setItem("ro_sweep_last_addr", raw); } catch {}
      invoiceResolver.current?.(inv);
      setAskInvoice(null);
    } catch (e) {
      setInvoiceErr(e instanceof Error ? e.message : "Couldn't get an invoice from that address.");
    } finally {
      setResolvingAddr(false);
    }
  };

  const canSweep = !!sweepKey && !sweeping && ((exact?.sats ?? 0) > 0 || stashSats > 0);

  const getInvoice = useCallback(async (amountSats: number) => {
    if (nwcConnected) return await makeInvoice(amountSats * 1000, "npub.cash sweep");
    setAskInvoice({ amount: amountSats });
    setPastedInvoice("");
    return await new Promise<string | null>((resolve) => { invoiceResolver.current = resolve; });
  }, [nwcConnected, makeInvoice]);

  const runSweep = async () => {
    if (!sweepKey || !signer || !myPubkey) return;
    setSweeping(true);
    setOutcome(null);
    try {
      const res = await sweepNpubCash({
        pubkey: myPubkey,
        signer,
        privkeyHex: sweepKey,
        getInvoice,
        onProgress: (p) => setProgress(sweepProgressLabel(p.stage, p.detail)),
      });
      setOutcome(res);
      fetchNpubCashClaimable(signer, readIssuedQuotes(myPubkey))
        .then((r) => { if (r.reached && r.data) setExact(r.data); })
        .catch(() => {});
    } catch (e) {
      setOutcome({
        results: [],
        strandedSats: myPubkey ? stashTotalSats(readStash(myPubkey)) : 0,
        problems: [e instanceof Error ? e.message : "Sweep failed — nothing moved."],
        alreadyClaimedSats: 0,
      });
    } finally {
      setSweeping(false);
      setProgress(null);
      setAskInvoice(null);
      invoiceResolver.current = null;
      setStashVersion((v) => v + 1);
    }
  };

  if (!show || !lud16) return null;
  return (
    <Card className="glass-card border-amber-500/30" data-testid="card-npubcash-claim">
      <CardContent className="p-4 space-y-2.5">
        <div className="flex items-center gap-2">
          <BtcZapIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-semibold">
            {(exact?.sats ?? 0) + stashSats > 0 ? "You have sats ready to collect" : "Where your zaps land"}
          </span>
        </div>
        {/* One honest sentence up front; the full custody detail is a tap away.
            The short line must still say WHO holds the money — that part never
            hides behind the fold. */}
        <p className="text-xs text-muted-foreground leading-relaxed">
          When someone zaps you, the sats wait for you at npub.cash — an independent service.
          Relay Outpost never holds your money.{" "}
          <button
            type="button"
            onClick={() => setShowHow((v) => !v)}
            className="underline underline-offset-2 hover:text-foreground"
            data-testid="button-npubcash-how"
          >
            {showHow ? "Hide details" : "How this works"}
          </button>
        </p>
        {showHow && (
          <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-npubcash-how">
            Your profile's lightning address (<span className="font-mono break-all">{lud16.length > 40 ? `${lud16.slice(0, 14)}…@npub.cash` : lud16}</span>)
            points at npub.cash, so zaps sent to you really do go through — they settle there,
            locked to this account's key. Only this account can collect them; collecting moves
            them first onto this device, then on to any wallet you choose. Until then they're
            held by npub.cash, not by Relay Outpost.
          </p>
        )}
        {(exact !== null || stashSats > 0) && (exact?.sats ?? 0) + stashSats > 0 ? (
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="text-npubcash-exact">
              {fmtSats((exact?.sats ?? 0) + stashSats)} ready to move to your own wallet.
            </p>
            {/* Breakdown only when the total has two homes — one number is
                calmer when it doesn't. */}
            {(exact?.sats ?? 0) > 0 && stashSats > 0 ? (
              <p className="text-[11px] text-muted-foreground" data-testid="text-npubcash-stash">
                {fmtSats(exact!.sats)} waiting at npub.cash · {fmtSats(stashSats)} already collected on this device.
              </p>
            ) : stashSats > 0 ? (
              <p className="text-[11px] text-muted-foreground" data-testid="text-npubcash-stash">
                Already collected on this device — send them on to finish.
              </p>
            ) : null}
          </div>
        ) : exact !== null && exact.count === 0 && stashSats === 0 ? (
          // The service itself answered "nothing unclaimed" — an honest
          // all-clear, distinct from silence.
          <p className="text-xs text-muted-foreground" data-testid="text-npubcash-clear">
            Nothing waiting right now. When someone zaps you, it shows up here.
          </p>
        ) : exact === null && waiting !== null && waiting.count > 0 ? (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="text-npubcash-waiting">
            At least {fmtSats(waiting.sats)} across {waiting.count} {waiting.count === 1 ? "zap" : "zaps"} have been sent to you.
          </p>
        ) : null}

        {sweeping && (
          <p className="text-xs text-muted-foreground flex items-center gap-2" data-testid="text-sweep-progress">
            <RelayOutpostInlineLoader className="w-3 h-3" />
            {progress ?? "Working…"}
          </p>
        )}

        {/* The paste-an-invoice handshake (no NWC wallet connected). */}
        {askInvoice && (
          <div className="space-y-2" data-testid="sweep-invoice-ask">
            <p className="text-xs text-foreground/80">
              Where should the <span className="font-semibold">{askInvoice.amount.toLocaleString()} sats</span> go?
              Type your wallet's Lightning address (like <span className="font-mono">you@coinos.io</span>) —
              or paste an invoice for that exact amount.
            </p>
            <Input
              value={pastedInvoice}
              onChange={(e) => { setPastedInvoice(e.target.value); setInvoiceErr(null); }}
              placeholder="you@wallet.com or lnbc…"
              className="font-mono text-xs"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              data-testid="input-sweep-invoice"
            />
            {invoiceErr && (
              <p className="text-xs text-red-600 dark:text-red-400" data-testid="text-sweep-invoice-error">{invoiceErr}</p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={resolvingAddr || !(pastedInvoice.trim().toLowerCase().startsWith("lnbc") || isLnAddress(pastedInvoice))}
                onClick={useDestination}
                data-testid="button-sweep-use-invoice"
              >
                {resolvingAddr ? "Getting invoice…" : "Send there"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { invoiceResolver.current?.(null); setAskInvoice(null); }}
                data-testid="button-sweep-cancel-invoice"
              >
                Cancel
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/80" data-testid="text-sweep-no-wallet-hint">
              No Lightning wallet yet?{" "}
              <a href="https://primal.net/downloads" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Primal</a>
              {" "}or{" "}
              <a href="https://coinos.io" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Coinos</a>
              {" "}takes about a minute to set up — then come back and type your new address here.
            </p>
          </div>
        )}

        {outcome && (
          <div className="space-y-1" data-testid="sweep-outcome">
            {outcome.results.map((r) => (
              <p key={r.mintUrl} className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                ⚡ {fmtSats(r.sweptSats)} arrived in your wallet
                {r.feeSats > 0 ? ` (network fee: ${fmtSats(r.feeSats)})` : ""}
                {r.changeSats > 0 ? `. ${fmtSats(r.changeSats)} in change stayed on this device and will go along next time` : ""}.
              </p>
            ))}
            {/* "Quote already issued" used to render here as two scary errors
                about money the user already HAS. One calm line instead. */}
            {outcome.alreadyClaimedSats > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="text-sweep-already-claimed">
                {fmtSats(outcome.alreadyClaimedSats)} listed as waiting were already collected earlier —
                nothing is missing, and they won't be counted again.
              </p>
            )}
            {outcome.problems.map((p, i) => (
              <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{p}</p>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-0.5 flex-wrap">
          {sweepKey ? (
            <Button
              size="sm"
              onClick={runSweep}
              disabled={!canSweep}
              className="h-9 bg-amber-500/90 hover:bg-amber-500 text-black"
              data-testid="button-npubcash-sweep"
            >
              {sweeping ? "Sending…" : nwcConnected ? "Send to connected wallet" : "Send to my wallet"}
            </Button>
          ) : (
            <a
              href={NPUB_CASH_CLAIM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 transition-colors"
              data-testid="link-npubcash-claim"
            >
              Collect at npub.cash
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <Link
            href="/account?edit=profile"
            className="inline-flex items-center h-9 px-3 rounded-lg border border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            data-testid="link-npubcash-change-address"
          >
            Use a different address
          </Link>
        </div>
        {/* Honest boundary: signing the mint claim needs the key ON this
            device (NUT-20 is not a nostr event), which extension/remote
            signers rightly never hand over. */}
        {!sweepKey && (
          <p className="text-[11px] text-muted-foreground/70">
            Collecting inside the app needs this account's key on this device. Extension and remote-signer accounts collect at npub.cash instead.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Get zappable" — the CREATE half of the npub.cash connection (owner request,
 * 2026-08-18): shown only when the loaded profile has NO lightning address.
 * npub.cash answers for every npub with no signup, so becoming zappable is one
 * profile edit — but it is a PUBLISH and it names a custodial-ish default, so
 * the card says both plainly and asks for the tap before doing anything.
 *
 * The write follows MyOutpost.saveProfile's wipe discipline: merge onto the
 * freshest kind-0 we can get (store, then relays), refuse when a profile
 * might exist that we failed to load, and never blank a field
 * (replaceable-event rule: an empty replaceable is a delete).
 */
function MakeZappableCard({ myPubkey, signer, profileEvent, profileLoaded }: {
  myPubkey: string | null;
  signer: ISigner | null;
  profileEvent: NostrToolsEvent | undefined;
  profileLoaded: boolean;
}) {
  const { toast } = useToast();
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState(false);

  if (!myPubkey || !signer || !profileLoaded || done) return null;
  const content = profileEvent ? getProfileContent(profileEvent) : null;
  if (content?.lud16 || content?.lud06) return null;

  const npub = (() => { try { return nip19.npubEncode(myPubkey); } catch { return null; } })();
  if (!npub) return null;
  const address = `${npub}@npub.cash`;

  const enable = async () => {
    setPublishing(true);
    try {
      // Freshest base: the loaded event, else one last relay ask. If neither
      // answers but the profile clearly exists elsewhere we cannot know — but
      // this card only renders once the store's replaceable RESOLVED (loaded),
      // so `undefined` here genuinely means "no kind-0 found anywhere".
      let base = profileEvent;
      if (!base) {
        try {
          const fetched = await pool.querySync(DEFAULT_RELAYS.slice(0, 5), { kinds: [KIND_METADATA], authors: [myPubkey], limit: 1 });
          if (fetched.length > 0) base = fetched[0] as NostrToolsEvent;
        } catch { /* keep base undefined — empty profile is the true state */ }
      }
      let existing: Record<string, unknown> = {};
      if (base) {
        try {
          const parsed = JSON.parse(base.content);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) existing = parsed;
          else if (base.content.trim() !== "") throw new Error("unparseable");
        } catch {
          // A profile EXISTS but we can't parse it — publishing a merge from
          // {} would wipe it. Refuse, loudly.
          toast({ title: "Couldn't read your profile", description: "Your existing profile couldn't be parsed, so nothing was changed.", variant: "destructive" });
          return;
        }
      }
      const event = {
        kind: KIND_METADATA,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify({ ...existing, lud16: address }),
      };
      const signed = await signWithTimeout(signer, event);
      if (!verifySignedEventKind(signed, KIND_METADATA)) {
        toast({ title: "Signer error", description: "Your signer modified the event type — profile was not updated.", variant: "destructive" });
        return;
      }
      const ok = await publishEvent(signed as NostrToolsEvent);
      if (ok) {
        setDone(true);
        toast({ title: "You're zappable", description: "Zaps now land at npub.cash under your key — claim them any time from this page." });
      } else {
        toast({ title: "Broadcast failed", description: "Could not publish your profile update.", variant: "destructive" });
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Card className="glass-card" data-testid="card-make-zappable">
      <CardContent className="p-4 space-y-2.5">
        <div className="flex items-center gap-2">
          <BtcZapIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-semibold">Get zappable — no wallet needed</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Your profile has no lightning address, so nobody can zap you yet. npub.cash — an
          independent third-party service — gives every Nostr key a working address with no signup:
          zaps settle there, held by npub.cash (not Relay Outpost) and locked to your key, until you
          claim them. This publishes <span className="font-mono">{`${npub.slice(0, 12)}…@npub.cash`}</span> as
          your profile's lightning address — you can change it any time.
        </p>
        <Button
          size="sm"
          onClick={enable}
          disabled={publishing}
          className="bg-amber-500/90 hover:bg-amber-500 text-black"
          data-testid="button-make-zappable"
        >
          {publishing ? "Publishing…" : "Use npub.cash address"}
        </Button>
      </CardContent>
    </Card>
  );
}

type TransactionCategory = "zap" | "direct" | "self" | "lightning";

const CATEGORY_CONFIG: Record<TransactionCategory, { label: string; color: string; bgClass: string }> = {
  zap: { label: "Zap", color: "text-amber-600 dark:text-amber-400", bgClass: "bg-amber-500/10" },
  direct: { label: "Direct", color: "text-brand", bgClass: "bg-brand/10" },
  self: { label: "Self", color: "text-blue-600 dark:text-blue-400", bgClass: "bg-blue-500/10" },
  lightning: { label: "Invoice", color: "text-muted-foreground/70", bgClass: "bg-foreground/[0.04]" } };

function getTransactionCategory(
  tx: NWCTransaction,
  enrichment: ZapEnrichment | null | undefined,
  myPubkey: string | null,
): TransactionCategory {
  if (!enrichment) return "lightning";

  const sender = enrichment.senderPubkey;
  const recipient = enrichment.recipientPubkey;

  if (myPubkey && sender && recipient && sender === myPubkey && recipient === myPubkey) return "self";
  if (myPubkey && tx.type === "outgoing" && recipient === myPubkey) return "self";

  if (enrichment.isZap) return "zap";
  if (sender || recipient) return "direct";

  return "lightning";
}

function extractZapMetaFromReceipt(receipt: Event): ZapEnrichment | null {
  const descTag = receipt.tags.find(t => t[0] === "description");
  if (!descTag?.[1]) return null;
  try {
    const zapRequest = JSON.parse(descTag[1]);
    if (!zapRequest || zapRequest.kind !== 9734) return null;
    const senderPubkey = zapRequest.pubkey || null;
    const pTag = (zapRequest.tags || []).find((t: string[]) => t[0] === "p");
    const eTag = (zapRequest.tags || []).find((t: string[]) => t[0] === "e");
    const lnurlTag = (zapRequest.tags || []).find((t: string[]) => t[0] === "lnurl");
    let lnAddress: string | null = null;
    if (lnurlTag?.[1]) {
      try {
        const decoded = new TextDecoder().decode(
          Uint8Array.from(atob(lnurlTag[1].replace(/[^A-Za-z0-9+/=]/g, "")), c => c.charCodeAt(0))
        );
        if (decoded.includes("@") || decoded.includes(".well-known/lnurlp")) {
          const urlMatch = decoded.match(/\/\.well-known\/lnurlp\/([^/?]+)/);
          const hostMatch = decoded.match(/https?:\/\/([^/]+)/);
          if (urlMatch && hostMatch) {
            lnAddress = `${urlMatch[1]}@${hostMatch[1]}`;
          } else {
            lnAddress = decoded;
          }
        }
      } catch {}
    }
    return {
      senderPubkey,
      recipientPubkey: pTag ? pTag[1] : null,
      eventId: eTag ? eTag[1] : null,
      message: zapRequest.content || "",
      lnAddress,
      isZap: true };
  } catch {}
  return null;
}

interface DecodedInvoiceInfo {
  /** Sats encoded in the invoice, or null when the invoice is amountless (sender chooses). */
  amountSats: number | null;
  description: string;
  /** Destination node pubkey (66-char hex) if the invoice carries one. */
  payeePubkey: string | null;
  /** Unix seconds at which the invoice expires, or null if not derivable. */
  expiresAt: number | null;
}

// Robustly decode a bolt11 invoice using a real bech32 decoder rather than a regex.
// Returns null for anything that isn't a parseable Lightning invoice so callers can
// refuse to pay it. Amountless invoices return amountSats: null (never 0) so the UI
// prompts the user for an amount instead of silently sending 0.
function decodeBolt11(bolt11: string): DecodedInvoiceInfo | null {
  const trimmed = bolt11.trim().replace(/^lightning:/i, "");
  if (!/^ln[a-z0-9]/i.test(trimmed)) return null;
  try {
    const decoded = decodeBolt11Invoice(trimmed);
    const sections = decoded.sections as Array<{ name: string; value?: unknown }>;
    let amountSats: number | null = null;
    let description = "";
    let payeePubkey: string | null = null;
    let timestamp = 0;
    for (const section of sections) {
      if (section.name === "amount" && typeof section.value === "string") {
        const msat = Number(section.value);
        if (Number.isFinite(msat) && msat > 0) amountSats = Math.round(msat / 1000);
      } else if (section.name === "description" && typeof section.value === "string") {
        description = section.value;
      } else if (section.name === "payee" && typeof section.value === "string") {
        payeePubkey = section.value;
      } else if (section.name === "timestamp" && typeof section.value === "number") {
        timestamp = section.value;
      }
    }
    const expiry = typeof decoded.expiry === "number" ? decoded.expiry : 3600;
    const expiresAt = timestamp > 0 ? timestamp + expiry : null;
    return { amountSats, description, payeePubkey, expiresAt };
  } catch {
    return null;
  }
}

// Amount of an invoice in sats for transaction-matching purposes; 0 when amountless or unparseable.
function parseBolt11AmountSats(bolt11: string): number {
  return decodeBolt11(bolt11)?.amountSats ?? 0;
}

function parseZapRequestFromDescription(description: string): ZapEnrichment | null {
  if (!description) return null;
  try {
    const parsed = JSON.parse(description);
    if (parsed && parsed.kind === 9734) {
      const senderPubkey = parsed.pubkey || null;
      const pTag = (parsed.tags || []).find((t: string[]) => t[0] === "p");
      const eTag = (parsed.tags || []).find((t: string[]) => t[0] === "e");
      return {
        senderPubkey,
        recipientPubkey: pTag ? pTag[1] : null,
        eventId: eTag ? eTag[1] : null,
        message: parsed.content || "",
        lnAddress: null,
        isZap: true };
    }
  } catch {}
  return null;
}

async function fetchZapEnrichments(
  pubkey: string,
  transactions: NWCTransaction[]
): Promise<Map<string, ZapEnrichment>> {
  const enrichmentMap = new Map<string, ZapEnrichment>();
  if (!pubkey || transactions.length === 0) return enrichmentMap;

  try {
    const { fetchUserZaps } = await import("@/lib/primal-cache");

    const timestamps = transactions
      .map(tx => tx.settled_at || tx.created_at)
      .filter(t => t > 0);
    if (timestamps.length === 0) return enrichmentMap;

    const { sent: sentReceipts, received: receivedReceipts } = await fetchUserZaps(pubkey, 200);

    const receiptsByBolt11 = new Map<string, ZapEnrichment>();
    const receivedByAmount = new Map<number, { ts: number; meta: ZapEnrichment }[]>();

    const receiptsByPreimage = new Map<string, ZapEnrichment>();

    for (const receipt of receivedReceipts) {
      const meta = extractZapMetaFromReceipt(receipt);
      if (!meta) continue;
      const bolt11Tag = receipt.tags.find(t => t[0] === "bolt11");
      if (bolt11Tag?.[1]) {
        receiptsByBolt11.set(bolt11Tag[1].toLowerCase(), meta);
      }
      const preimageTag = receipt.tags.find(t => t[0] === "preimage");
      if (preimageTag?.[1]) {
        receiptsByPreimage.set(preimageTag[1].toLowerCase(), meta);
      }
      const amountSats = bolt11Tag?.[1] ? parseBolt11AmountSats(bolt11Tag[1]) : 0;
      if (amountSats > 0) {
        const list = receivedByAmount.get(amountSats) || [];
        list.push({ ts: receipt.created_at, meta });
        receivedByAmount.set(amountSats, list);
      }
    }

    const sentByAmount = new Map<number, { ts: number; meta: ZapEnrichment }[]>();
    for (const receipt of sentReceipts) {
      const meta = extractZapMetaFromReceipt(receipt);
      if (!meta) continue;
      const bolt11Tag = receipt.tags.find(t => t[0] === "bolt11");
      if (bolt11Tag?.[1]) {
        receiptsByBolt11.set(bolt11Tag[1].toLowerCase(), { ...meta, senderPubkey: pubkey });
      }
      const preimageTag = receipt.tags.find(t => t[0] === "preimage");
      if (preimageTag?.[1]) {
        receiptsByPreimage.set(preimageTag[1].toLowerCase(), { ...meta, senderPubkey: pubkey });
      }
      const amountSats = bolt11Tag?.[1] ? parseBolt11AmountSats(bolt11Tag[1]) : 0;
      if (amountSats <= 0) continue;
      const enrichMeta: ZapEnrichment = {
        senderPubkey: pubkey,
        recipientPubkey: meta.recipientPubkey,
        eventId: meta.eventId,
        message: meta.message,
        lnAddress: meta.lnAddress };
      const list = sentByAmount.get(amountSats) || [];
      list.push({ ts: receipt.created_at, meta: enrichMeta });
      sentByAmount.set(amountSats, list);
    }

    console.log(`[Wallet] Enrichments: ${receivedReceipts.length} received, ${sentReceipts.length} sent zap receipts from Primal`);

    const usedReceiptTs = new Set<string>();
    const profilePubkeys = new Set<string>();

    function addEnrichment(txKey: string, meta: ZapEnrichment) {
      enrichmentMap.set(txKey, meta);
      if (meta.senderPubkey) profilePubkeys.add(meta.senderPubkey);
      if (meta.recipientPubkey) profilePubkeys.add(meta.recipientPubkey);
    }

    function findNearestMatch(
      candidates: { ts: number; meta: ZapEnrichment }[] | undefined,
      txTime: number,
      maxDelta: number
    ): ZapEnrichment | null {
      if (!candidates || candidates.length === 0) return null;
      let best: { ts: number; meta: ZapEnrichment } | null = null;
      let bestDelta = Infinity;
      for (const c of candidates) {
        const key = `${c.ts}-${c.meta.senderPubkey || ""}-${c.meta.recipientPubkey || ""}`;
        if (usedReceiptTs.has(key)) continue;
        const delta = Math.abs(txTime - c.ts);
        if (delta <= maxDelta && delta < bestDelta) {
          best = c;
          bestDelta = delta;
        }
      }
      if (best) {
        const key = `${best.ts}-${best.meta.senderPubkey || ""}-${best.meta.recipientPubkey || ""}`;
        usedReceiptTs.add(key);
        return best.meta;
      }
      return null;
    }

    for (const tx of transactions) {
      const txKey = tx.payment_hash || `${tx.amount}-${tx.settled_at || tx.created_at}`;

      const descMeta = parseZapRequestFromDescription(tx.description);
      if (descMeta) {
        addEnrichment(txKey, descMeta);
        continue;
      }

      if (tx.preimage) {
        const match = receiptsByPreimage.get(tx.preimage.toLowerCase());
        if (match) {
          addEnrichment(txKey, match);
          continue;
        }
      }

      if (tx.invoice) {
        const match = receiptsByBolt11.get(tx.invoice.toLowerCase());
        if (match) {
          addEnrichment(txKey, match);
          continue;
        }
      }

      const amountSats = Math.floor((tx.amount || 0) / 1000);
      const txTime = tx.settled_at || tx.created_at;
      if (amountSats > 0 && txTime > 0) {
        const isIncoming = tx.type === "incoming";
        const candidates = isIncoming ? receivedByAmount.get(amountSats) : sentByAmount.get(amountSats);
        const match = findNearestMatch(candidates, txTime, 600);
        if (match) {
          addEnrichment(txKey, match);
        }
      }
    }

    const unmatchedTxs = transactions.filter(tx => {
      const txKey = tx.payment_hash || `${tx.amount}-${tx.settled_at || tx.created_at}`;
      return tx.type === "incoming" && !enrichmentMap.has(txKey);
    });

    if (unmatchedTxs.length > 0) {
      try {
        const since = Math.min(...unmatchedTxs.map(tx => (tx.settled_at || tx.created_at) - 600));
        const relayReceipts = await pool.querySync(DEFAULT_RELAYS.slice(0, 3), {
          kinds: [9735],
          "#p": [pubkey],
          since,
          limit: 100 });

        const relayByBolt11 = new Map<string, ZapEnrichment>();
        const relayByAmount = new Map<number, { ts: number; meta: ZapEnrichment }[]>();

        for (const receipt of relayReceipts) {
          const meta = extractZapMetaFromReceipt(receipt);
          if (!meta) continue;
          const bolt11Tag = receipt.tags.find(t => t[0] === "bolt11");
          if (bolt11Tag?.[1]) {
            relayByBolt11.set(bolt11Tag[1].toLowerCase(), meta);
          }
          const amountSats = bolt11Tag?.[1] ? parseBolt11AmountSats(bolt11Tag[1]) : 0;
          if (amountSats > 0) {
            const list = relayByAmount.get(amountSats) || [];
            list.push({ ts: receipt.created_at, meta });
            relayByAmount.set(amountSats, list);
          }
        }

        console.log(`[Wallet] Relay fallback: ${relayReceipts.length} receipts for ${unmatchedTxs.length} unmatched txs`);

        for (const tx of unmatchedTxs) {
          const txKey = tx.payment_hash || `${tx.amount}-${tx.settled_at || tx.created_at}`;
          if (enrichmentMap.has(txKey)) continue;

          if (tx.invoice) {
            const match = relayByBolt11.get(tx.invoice.toLowerCase());
            if (match) {
              addEnrichment(txKey, match);
              continue;
            }
          }

          const amountSats = Math.floor((tx.amount || 0) / 1000);
          const txTime = tx.settled_at || tx.created_at;
          if (amountSats > 0 && txTime > 0) {
            const match = findNearestMatch(relayByAmount.get(amountSats), txTime, 600);
            if (match) {
              addEnrichment(txKey, match);
            }
          }
        }
      } catch (err) {
        console.warn("[Wallet] Relay fallback enrichment failed:", err);
      }
    }

    if (profilePubkeys.size > 0) {
      fetchProfilesCached(Array.from(profilePubkeys));
    }
  } catch (err) {
    console.error("[Wallet] Failed to fetch zap enrichments:", err);
  }
  return enrichmentMap;
}

function GalaxyStars() {
  const stars = useMemo(() => {
    const s = [];
    for (let i = 0; i < 40; i++) {
      const isBright = i < 5;
      s.push({
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        size: isBright ? Math.random() * 2 + 1.5 : Math.random() * 1.5 + 0.5,
        opacity: isBright ? Math.random() * 0.25 + 0.35 : Math.random() * 0.3 + 0.08,
        delay: `${Math.random() * 5}s`,
        duration: isBright ? "4s" : "3s",
        glow: isBright });
    }
    return s;
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {stars.map((star, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white animate-pulse"
          style={{
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            opacity: star.opacity,
            animationDelay: star.delay,
            animationDuration: star.duration,
            boxShadow: star.glow ? `0 0 ${star.size * 3}px ${star.size}px rgba(167,139,250,0.3)` : undefined }}
        />
      ))}
    </div>
  );
}

function TransactionRow({ tx, index, enrichment, txNumber, myPubkey, balanceHidden, onSelect }: { tx: NWCTransaction; index: number; enrichment?: ZapEnrichment | null; txNumber: number; myPubkey: string | null; balanceHidden?: boolean; onSelect: () => void }) {
  const isIncoming = tx.type === "incoming";
  const amountSats = Math.floor((tx.amount || 0) / 1000);
  const ts = tx.settled_at || tx.created_at;
  const category = useMemo(() => getTransactionCategory(tx, enrichment, myPubkey), [tx, enrichment, myPubkey]);
  const catConfig = CATEGORY_CONFIG[category];

  const counterpartyPubkey = useMemo(() => {
    if (!enrichment) return null;
    if (isIncoming) return enrichment.senderPubkey;
    return enrichment.recipientPubkey;
  }, [enrichment, isIncoming]);

  const formatTxTime = (ts: number) => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  const rawDesc = tx.description && !tx.description.startsWith("{") ? tx.description : "";
  const cleanDesc = rawDesc.replace(/^["']|["']$/g, "").trim();
  const descriptionLabel = cleanDesc || (isIncoming ? "Received" : "Sent");

  return (
    <div
      className={`rounded-lg transition-colors hover:bg-foreground/[0.04] dark:hover:bg-white/[0.04] cursor-pointer ${
        index % 2 === 0 ? "bg-foreground/[0.02]" : ""
      }`}
      onClick={onSelect}
      data-testid={`row-transaction-${index}`}
    >
      <div
        className="flex items-start gap-3 px-3 py-3 select-none"
        data-testid={`button-expand-transaction-${index}`}
      >
        <div className="shrink-0 mt-0.5 min-w-[4.5rem] text-left">
          <div className="flex items-center gap-1">
            <BtcZapIcon className={`w-3.5 h-3.5 ${isIncoming ? "text-emerald-500/70" : "text-amber-500/70"}`} />
            <span className={`text-sm font-semibold tabular-nums transition-all duration-200 ${
              isIncoming ? "text-emerald-500 dark:text-emerald-400" : "text-foreground/80"
            } ${balanceHidden ? "blur-[6px] select-none" : ""}`}>
              {isIncoming ? "+" : "-"}{amountSats.toLocaleString()}
            </span>
          </div>
          <span className={`text-[10px] text-muted-foreground/40 font-mono uppercase ml-[1.125rem] transition-all duration-200 ${balanceHidden ? "blur-[6px] select-none" : ""}`}>sats</span>
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className={`transition-all duration-200 ${balanceHidden ? "blur-[6px] select-none" : ""}`}>
            {counterpartyPubkey ? (
              <ProfileLink
                pubkey={counterpartyPubkey}
                className="text-sm font-medium text-foreground/90 dark:text-white/85"
                fallbackClassName="text-sm font-mono text-primary dark:text-brand"
                avatarSize="sm"
              />
            ) : (
              <span className="text-sm text-foreground/70">
                {descriptionLabel}
              </span>
            )}
            </span>
            <span className={`text-[9px] font-brand uppercase tracking-wider px-1.5 py-0.5 rounded ${catConfig.bgClass} ${catConfig.color}`} data-testid={`badge-tx-category-${index}`}>
              {catConfig.label}
            </span>
          </div>

          {enrichment?.message && (
            <p className={`text-xs text-muted-foreground/70 italic truncate transition-all duration-200 ${balanceHidden ? "blur-[6px] select-none" : ""}`}>
              "{enrichment.message}"
            </p>
          )}

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-brand/40 font-mono tabular-nums">#{txNumber}</span>
            <p className="text-[11px] text-muted-foreground/50 font-mono">
              {formatTxTime(ts)}
            </p>
          </div>
        </div>

        <div className="shrink-0 ml-2 mt-1">
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
        </div>
      </div>
    </div>
  );
}

const ITEMS_PER_TX_PAGE = 15;

function getTxDateBucket(timestamp: number): { key: string; label: string; defaultExpanded: boolean; order: number } {
  const date = new Date(timestamp * 1000);
  if (isToday(date)) return { key: "today", label: "Today", defaultExpanded: true, order: 1 };
  if (isYesterday(date)) return { key: "yesterday", label: "Yesterday", defaultExpanded: false, order: 2 };
  if (isThisWeek(date)) return { key: "this-week", label: "This Week", defaultExpanded: false, order: 3 };
  if (isThisMonth(date)) return { key: "this-month", label: "This Month", defaultExpanded: false, order: 4 };
  const monthKey = formatDate(date, "yyyy-MM");
  const monthLabel = formatDate(date, "MMM yyyy");
  return { key: monthKey, label: monthLabel, defaultExpanded: false, order: 5 };
}

type TxBucket = {
  key: string;
  label: string;
  defaultExpanded: boolean;
  order: number;
  transactions: { tx: NWCTransaction; originalIndex: number }[];
  totalSats: number;
};

function useTxBuckets(filteredTransactions: NWCTransaction[]) {
  return useMemo(() => {
    const bucketMap = new Map<string, TxBucket>();
    filteredTransactions.forEach((tx, filteredIdx) => {
      const ts = tx.settled_at || tx.created_at;
      if (!ts) return;
      const bucket = getTxDateBucket(ts);
      let b = bucketMap.get(bucket.key);
      if (!b) {
        b = { ...bucket, transactions: [], totalSats: 0 };
        bucketMap.set(bucket.key, b);
      }
      b.transactions.push({ tx, originalIndex: filteredIdx });
      b.totalSats += Math.floor((tx.amount || 0) / 1000);
    });
    return Array.from(bucketMap.values()).sort((a, b) => a.order - b.order || b.key.localeCompare(a.key));
  }, [filteredTransactions]);
}

function TransactionDateGroup({
  bucket,
  enrichments,
  myPubkey,
  balanceHidden,
  filteredTotal,
  onSelectTx }: {
  bucket: TxBucket;
  enrichments: Map<string, ZapEnrichment>;
  myPubkey: string | null;
  balanceHidden: boolean;
  filteredTotal: number;
  onSelectTx: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(bucket.defaultExpanded);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_TX_PAGE);
  const prevLen = useRef(bucket.transactions.length);

  useEffect(() => {
    if (bucket.transactions.length !== prevLen.current) {
      prevLen.current = bucket.transactions.length;
      setVisibleCount(ITEMS_PER_TX_PAGE);
    }
  }, [bucket.transactions.length]);

  const Icon = expanded ? ChevronDown : ChevronRight;
  const visible = bucket.transactions.slice(0, visibleCount);
  const hasMore = visibleCount < bucket.transactions.length;

  return (
    <div data-testid={`tx-date-group-${bucket.key}`}>
      <button
        type="button"
        className="flex items-center gap-1.5 px-3 py-1.5 w-full bg-muted/5 dark:bg-muted/3 hover:bg-muted/15 dark:hover:bg-muted/8 transition-colors cursor-pointer rounded-md"
        onClick={() => setExpanded(e => !e)}
        data-testid={`button-toggle-tx-date-${bucket.key}`}
      >
        <Icon className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0 transition-transform" />
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-foreground/55 dark:text-muted-foreground/60 flex-1 text-left">
          {bucket.label}
        </span>
        <span className={`text-[9px] text-muted-foreground/40 tabular-nums mr-1.5 transition-all duration-200 ${balanceHidden ? "blur-[6px] select-none" : ""}`}>
          {bucket.totalSats.toLocaleString()} sats
        </span>
        <span className="text-[9px] text-muted-foreground/45 dark:text-muted-foreground/40 tabular-nums" data-testid={`text-tx-date-count-${bucket.key}`}>
          {bucket.transactions.length}
        </span>
      </button>
      {expanded && (
        <div className="mt-0.5 space-y-0.5">
          {visible.map(({ tx, originalIndex }, vi) => {
            const txKey = tx.payment_hash || `${tx.amount}-${tx.settled_at || tx.created_at}`;
            return (
              <TransactionRow
                key={`${tx.payment_hash || vi}-${tx.settled_at || tx.created_at}`}
                tx={tx}
                index={originalIndex}
                txNumber={filteredTotal - originalIndex}
                enrichment={enrichments.get(txKey)}
                myPubkey={myPubkey}
                balanceHidden={balanceHidden}
                onSelect={() => onSelectTx(txKey)}
              />
            );
          })}
          {hasMore && (
            <button
              type="button"
              className="w-full px-3 py-2 text-[10px] text-brand/60 hover:text-brand/80 hover:bg-muted/10 transition-colors cursor-pointer font-medium rounded-md"
              onClick={() => setVisibleCount(c => c + ITEMS_PER_TX_PAGE)}
              data-testid={`button-show-more-tx-${bucket.key}`}
            >
              Show more ({bucket.transactions.length - visibleCount} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TransactionDetailModal({ tx, enrichment, myPubkey, balanceHidden, onClose }: {
  tx: NWCTransaction;
  enrichment?: ZapEnrichment | null;
  myPubkey: string | null;
  balanceHidden?: boolean;
  onClose: () => void;
}) {
  const isIncoming = tx.type === "incoming";
  const amountSats = Math.floor((tx.amount || 0) / 1000);
  const ts = tx.settled_at || tx.created_at;
  const category = useMemo(() => getTransactionCategory(tx, enrichment, myPubkey), [tx, enrichment, myPubkey]);
  const catConfig = CATEGORY_CONFIG[category];
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const counterpartyPubkey = useMemo(() => {
    if (!enrichment) return null;
    if (isIncoming) return enrichment.senderPubkey;
    return enrichment.recipientPubkey;
  }, [enrichment, isIncoming]);

  const counterpartyProfile = use$(() =>
    counterpartyPubkey ? eventStore.replaceable(KIND_METADATA, counterpartyPubkey) : undefined,
  [counterpartyPubkey]);

  const resolvedLnAddress = useMemo(() => {
    if (enrichment?.lnAddress) return enrichment.lnAddress;
    if (!counterpartyProfile) return null;
    const content = getProfileContent(counterpartyProfile);
    return getLightningAddress(content) || null;
  }, [enrichment?.lnAddress, counterpartyProfile]);

  const [eventContent, setEventContent] = useState<string | null>(null);

  useEffect(() => {
    setEventContent(null);
    if (!enrichment?.eventId) return;
    let cancelled = false;
    pool.querySync(DEFAULT_RELAYS.slice(0, 3), {
      ids: [enrichment.eventId],
      limit: 1 }).then(events => {
      if (!cancelled && events.length > 0) {
        setEventContent(events[0].content);
      }
    }).catch((e) => console.warn("[Wallet] Event content fetch failed:", e?.message));
    return () => { cancelled = true; };
  }, [enrichment?.eventId]);

  const formatFullDate = (ts: number) => {
    if (!ts) return "N/A";
    return new Date(ts * 1000).toLocaleString();
  };

  const rawDesc = tx.description && !tx.description.startsWith("{") ? tx.description : "";
  const cleanDesc = rawDesc.replace(/^["']|["']$/g, "").trim();

  const headerTitle = useMemo(() => {
    const isZap = category === "zap";
    if (isZap) return isIncoming ? "Zap Received" : "Zap Sent";
    if (category === "self") return "Self Transfer";
    return isIncoming ? "Payment Received" : "Payment Sent";
  }, [category, isIncoming]);

  const copyToClipboard = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }).catch((e) => console.warn("[Wallet] Clipboard copy failed:", e?.message));
  }, []);

  const truncateHash = (hash: string) => {
    if (hash.length <= 20) return hash;
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  const blur = balanceHidden ? "blur-[6px] select-none" : "";

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 bg-background border-border dark:border-brand/10 overflow-hidden max-h-[90vh] overflow-y-auto" data-testid="modal-transaction-detail">
        <VisuallyHidden><DialogTitle>{headerTitle}</DialogTitle></VisuallyHidden>

        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/10">
          <div className="flex items-center gap-3 px-4 py-3">
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] transition-colors"
              data-testid="button-tx-detail-back"
            >
              <ArrowLeft className="w-4 h-4 text-foreground/70" />
            </button>
            <h2 className="text-sm font-semibold text-foreground flex-1" data-testid="text-tx-detail-title">{headerTitle}</h2>
            <span className={`text-[9px] font-brand uppercase tracking-wider px-1.5 py-0.5 rounded ${catConfig.bgClass} ${catConfig.color}`}>
              {catConfig.label}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center py-6 px-4">
          <div className={`text-center transition-all duration-200 ${blur}`}>
            <span className={`text-4xl font-bold tabular-nums ${
              isIncoming ? "text-emerald-500 dark:text-emerald-400" : "text-foreground/90"
            }`} data-testid="text-tx-detail-amount">
              {amountSats.toLocaleString()}
            </span>
            <span className={`text-lg ml-1.5 ${
              isIncoming ? "text-emerald-500/70 dark:text-emerald-400/70" : "text-muted-foreground/60"
            }`}>sats</span>
          </div>
          {tx.amount > 0 && (
            <p className={`text-xs text-muted-foreground/40 mt-1 tabular-nums transition-all duration-200 ${blur}`} data-testid="text-tx-detail-msats">
              {tx.amount.toLocaleString()} msats
            </p>
          )}
        </div>

        <div className="px-4 pb-4 space-y-4">
          <div>
            <p className="text-[10px] text-muted-foreground/40 font-brand uppercase tracking-wider mb-2">
              {isIncoming ? "Received From" : "Sent To"}
            </p>
            {counterpartyPubkey ? (
              <div className={`flex items-center gap-3 p-3 rounded-lg glass-card border transition-all duration-200 ${blur}`} data-testid="container-tx-detail-profile">
                <ProfileLink
                  pubkey={counterpartyPubkey}
                  className="text-sm font-medium text-foreground/90 dark:text-white/85"
                  fallbackClassName="text-sm font-mono text-primary dark:text-brand"
                  avatarSize="md"
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 rounded-lg glass-card border" data-testid="container-tx-detail-anon">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Orbit className="w-4.5 h-4.5 text-brand/60" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/70">Lightning Payment</p>
                  <p className="text-[11px] text-muted-foreground/40">Identity not available</p>
                </div>
              </div>
            )}
            {resolvedLnAddress && (
              <div className={`flex items-center gap-2 mt-2 px-1 transition-all duration-200 ${blur}`}>
                <Zap className="w-3 h-3 text-amber-500/50 shrink-0" />
                <span className="text-[11px] text-muted-foreground/60 font-mono truncate">{resolvedLnAddress}</span>
              </div>
            )}
          </div>

          {enrichment?.message && (
            <div className={`p-3 rounded-lg bg-primary/5 border border-primary/10 transition-all duration-200 ${blur}`}>
              <p className="text-[10px] text-muted-foreground/40 font-brand uppercase tracking-wider mb-1.5">Message</p>
              <p className="text-sm text-foreground/80 italic leading-relaxed" data-testid="text-tx-detail-message">"{enrichment.message}"</p>
            </div>
          )}

          {!enrichment?.message && cleanDesc && (
            <div className={`p-3 rounded-lg bg-foreground/[0.02] border border-border/10 transition-all duration-200 ${blur}`}>
              <p className="text-[10px] text-muted-foreground/40 font-brand uppercase tracking-wider mb-1.5">Payment Note</p>
              <p className="text-sm text-foreground/70 italic leading-relaxed" data-testid="text-tx-detail-note">"{cleanDesc}"</p>
            </div>
          )}

          {eventContent && enrichment?.eventId && (
            <Link
              href={`/thread/${nip19.noteEncode(enrichment.eventId)}`}
              className={`block p-3 rounded-lg bg-foreground/[0.02] border border-border/10 hover:border-primary/20 hover:bg-primary/5 transition-colors group/linked ${blur}`}
              data-testid="link-tx-detail-post"
            >
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] text-muted-foreground/40 font-brand uppercase tracking-wider">Linked Post</p>
                <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover/linked:text-brand/60 transition-colors" />
              </div>
              <p className="text-[12px] text-foreground/60 group-hover/linked:text-foreground/70 leading-relaxed line-clamp-3 transition-colors">
                {eventContent.length > 300 ? eventContent.slice(0, 300) + "…" : eventContent}
              </p>
            </Link>
          )}

          <div className="space-y-0">
            {[
              { label: "Date", value: formatFullDate(ts), testId: "text-tx-detail-date" },
              { label: "Status", value: "Succeeded", testId: "text-tx-detail-status" },
              { label: "Transaction Type", value: category === "zap" ? "Zap" : "Lightning Payment", testId: "text-tx-detail-type" },
              ...(tx.fees_paid > 0 ? [{ label: "Transaction Fee", value: `${Math.floor(tx.fees_paid / 1000)} sats`, testId: "text-tx-detail-fee", sensitive: true }] : []),
            ].map((row, i) => (
              <div key={row.label} className={`flex items-center justify-between py-2.5 ${i > 0 ? "border-t border-border/10" : ""}`}>
                <span className="text-xs text-muted-foreground/60">{row.label}</span>
                <span className={`text-xs text-foreground/80 tabular-nums transition-all duration-200 ${(row as any).sensitive ? blur : ""}`} data-testid={row.testId}>{row.value}</span>
              </div>
            ))}

            {tx.payment_hash && (
              <div className="flex items-center justify-between py-2.5 border-t border-border/10">
                <span className="text-xs text-muted-foreground/60">Payment Hash</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs text-foreground/60 font-mono transition-all duration-200 ${blur}`} data-testid="text-tx-detail-hash">{truncateHash(tx.payment_hash)}</span>
                  {!balanceHidden && (
                    <button
                      onClick={() => copyToClipboard(tx.payment_hash, "hash")}
                      className="w-5 h-5 rounded flex items-center justify-center hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] transition-colors"
                      data-testid="button-copy-hash"
                    >
                      {copiedField === "hash" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-muted-foreground/40" />}
                    </button>
                  )}
                </div>
              </div>
            )}

            {tx.preimage && (
              <div className="flex items-center justify-between py-2.5 border-t border-border/10">
                <span className="text-xs text-muted-foreground/60">Preimage</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs text-foreground/60 font-mono transition-all duration-200 ${blur}`} data-testid="text-tx-detail-preimage">{truncateHash(tx.preimage)}</span>
                  {!balanceHidden && (
                    <button
                      onClick={() => copyToClipboard(tx.preimage, "preimage")}
                      className="w-5 h-5 rounded flex items-center justify-center hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] transition-colors"
                      data-testid="button-copy-preimage"
                    >
                      {copiedField === "preimage" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-muted-foreground/40" />}
                    </button>
                  )}
                </div>
              </div>
            )}

            {tx.invoice && (
              <div className="flex items-center justify-between py-2.5 border-t border-border/10">
                <span className="text-xs text-muted-foreground/60">Invoice</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs text-foreground/60 font-mono transition-all duration-200 ${blur}`} data-testid="text-tx-detail-invoice">{truncateHash(tx.invoice)}</span>
                  {!balanceHidden && (
                    <button
                      onClick={() => copyToClipboard(tx.invoice, "invoice")}
                      className="w-5 h-5 rounded flex items-center justify-center hover:bg-foreground/[0.06] dark:hover:bg-white/[0.06] transition-colors"
                      data-testid="button-copy-invoice"
                    >
                      {copiedField === "invoice" ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-muted-foreground/40" />}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TransactionMetrics {
  totalSent: number;
  totalReceived: number;
  netFlow: number;
  txCount: number;
  avgPayment: number;
  totalFees: number;
}

function computeTransactionMetrics(transactions: NWCTransaction[]): TransactionMetrics {
  let totalSent = 0;
  let totalReceived = 0;
  let totalFees = 0;

  for (const tx of transactions) {
    const amountSats = Math.floor((tx.amount || 0) / 1000);
    if (tx.type === "incoming") {
      totalReceived += amountSats;
    } else {
      totalSent += amountSats;
    }
    totalFees += Math.floor((tx.fees_paid || 0) / 1000);
  }

  const txCount = transactions.length;
  const avgPayment = txCount > 0 ? Math.round((totalSent + totalReceived) / txCount) : 0;

  return {
    totalSent,
    totalReceived,
    netFlow: totalReceived - totalSent,
    txCount,
    avgPayment,
    totalFees };
}

function MetricCard({ label, value, icon: Icon, iconColor, suffix = "sats", valueColor, blurred }: {
  label: string;
  value: string;
  icon: any;
  iconColor: string;
  suffix?: string;
  valueColor?: string;
  blurred?: boolean;
}) {
  return (
    <Card className="glass-card" data-testid={`card-metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <span className="text-[10px] font-brand uppercase tracking-wider text-muted-foreground/60 block">{label}</span>
            <div className="flex items-baseline gap-1 flex-wrap">
              <span className={`text-base sm:text-lg font-bold tabular-nums transition-all duration-200 ${valueColor || "text-foreground/90 dark:text-white/85"} ${blurred ? "blur-[6px] select-none" : ""}`} data-testid={`text-metric-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                {value}
              </span>
              <span className={`text-[10px] text-muted-foreground/40 font-brand transition-all duration-200 ${blurred ? "blur-[6px] select-none" : ""}`}>{suffix}</span>
            </div>
          </div>
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TransactionMetricsDashboard({ transactions, balanceHidden }: { transactions: NWCTransaction[]; balanceHidden?: boolean }) {
  const metrics = useMemo(() => computeTransactionMetrics(transactions), [transactions]);

  if (transactions.length === 0) return null;

  return (
    <div className="space-y-3 mb-4" data-testid="container-transaction-metrics">
      <p className="text-[10px] font-brand uppercase tracking-wider text-muted-foreground/50">Recent Activity Summary</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        <MetricCard
          label="Sent"
          value={metrics.totalSent.toLocaleString()}
          icon={ArrowUpRight}
          iconColor="bg-amber-500/10 text-amber-500 dark:text-amber-400"
          valueColor="text-amber-600 dark:text-amber-400"
          blurred={balanceHidden}
        />
        <MetricCard
          label="Received"
          value={metrics.totalReceived.toLocaleString()}
          icon={ArrowDownLeft}
          iconColor="bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
          valueColor="text-emerald-600 dark:text-emerald-400"
          blurred={balanceHidden}
        />
        <MetricCard
          label="Net Flow"
          value={`${metrics.netFlow >= 0 ? "+" : ""}${metrics.netFlow.toLocaleString()}`}
          icon={metrics.netFlow >= 0 ? TrendingUp : TrendingDown}
          iconColor={metrics.netFlow >= 0 ? "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400" : "bg-red-500/10 text-red-500 dark:text-red-400"}
          valueColor={metrics.netFlow >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
          blurred={balanceHidden}
        />
        <MetricCard
          label="Transactions"
          value={metrics.txCount.toLocaleString()}
          icon={Hash}
          iconColor="bg-primary/10 text-primary dark:text-brand"
          suffix=""
          blurred={balanceHidden}
        />
        <MetricCard
          label="Avg Payment"
          value={metrics.avgPayment.toLocaleString()}
          icon={BarChart3}
          iconColor="bg-blue-500/10 text-blue-500 dark:text-blue-400"
          blurred={balanceHidden}
        />
        <MetricCard
          label="Total Fees"
          value={metrics.totalFees.toLocaleString()}
          icon={CircleDollarSign}
          iconColor="bg-orange-500/10 text-orange-500 dark:text-orange-400"
          blurred={balanceHidden}
        />
      </div>
    </div>
  );
}

const AMOUNT_PRESETS = [21, 100, 500, 1000, 5000];

function AmountSelector({ value, customValue, onSelect, onCustomChange, label }: {
  value: number | null;
  customValue: string;
  onSelect: (v: number | null) => void;
  onCustomChange: (v: string) => void;
  label?: string;
}) {
  const isCustom = value === -1;

  return (
    <div className="space-y-2">
      {label && (
        <label className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70 block">{label}</label>
      )}
      <div className="flex flex-wrap gap-1.5">
        {AMOUNT_PRESETS.map(preset => (
          <button
            key={preset}
            onClick={() => { onSelect(preset); onCustomChange(""); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-all ${
              value === preset
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                : "bg-foreground/[0.04] dark:bg-white/[0.04] text-foreground/70 dark:text-white/60 hover:bg-foreground/[0.08] dark:hover:bg-white/[0.08]"
            }`}
            data-testid={`button-amount-${preset}`}
          >
            <BtcZapIcon className="w-3 h-3 inline-block mr-0.5 -mt-0.5" />
            {preset >= 1000 ? `${preset / 1000}k` : preset}
          </button>
        ))}
        <button
          onClick={() => onSelect(-1)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            isCustom
              ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
              : "bg-foreground/[0.04] dark:bg-white/[0.04] text-foreground/70 dark:text-white/60 hover:bg-foreground/[0.08] dark:hover:bg-white/[0.08]"
          }`}
          data-testid="button-amount-custom"
        >
          Custom
        </button>
      </div>
      {isCustom && (
        <Input
          type="number"
          placeholder="Enter amount in sats"
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          min={1}
          inputMode="numeric"
          enterKeyHint="done"
          autoFocus
          className="mt-1"
          data-testid="input-custom-amount"
        />
      )}
    </div>
  );
}

function ZapPresetsEditor() {
  const [presets, setPresets] = useState<ZapPreset[]>(() => getZapPresets());
  const [defaultAmount, setDefaultAmount] = useState(() => getDefaultZapAmount());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editEmoji, setEditEmoji] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const { toast } = useToast();

  const startEdit = (idx: number) => {
    const p = presets[idx];
    setEditEmoji(p.emoji);
    setEditLabel(p.label);
    setEditAmount(String(p.amount));
    setEditingIdx(idx);
    setShowEmojiPicker(false);
  };

  const saveEdit = () => {
    if (editingIdx === null) return;
    const amt = parseInt(editAmount, 10);
    if (!amt || amt < 1 || !isFinite(amt)) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    const hasDuplicate = presets.some((p, i) => i !== editingIdx && p.amount === amt);
    if (hasDuplicate) {
      toast({ title: "Another preset already uses this amount", variant: "destructive" });
      return;
    }
    const updated = [...presets];
    updated[editingIdx] = { emoji: editEmoji, label: editLabel.trim() || "Zap", amount: amt };
    setPresets(updated);
    saveZapPresets(updated);
    if (defaultAmount === presets[editingIdx].amount) {
      setDefaultAmount(amt);
      saveDefaultZapAmount(amt);
    }
    setEditingIdx(null);
    setShowEmojiPicker(false);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setShowEmojiPicker(false);
  };

  const setDefault = (idx: number) => {
    const amt = presets[idx].amount;
    setDefaultAmount(amt);
    saveDefaultZapAmount(amt);
  };

  const resetToDefaults = () => {
    setPresets([...DEFAULT_ZAP_PRESETS]);
    saveZapPresets([...DEFAULT_ZAP_PRESETS]);
    setDefaultAmount(100);
    saveDefaultZapAmount(100);
    setEditingIdx(null);
    toast({ title: "Zap presets reset to defaults" });
  };

  const formatAmount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : String(n);

  return (
    <div className="space-y-3" data-testid="section-zap-presets">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground/70 dark:text-foreground/60 flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-amber-500/70" />
          Zap Presets
        </p>
        <button
          onClick={resetToDefaults}
          className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 flex items-center gap-1 transition-colors"
          data-testid="button-reset-zap-presets"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>
      <p className="text-[11px] text-foreground/45 dark:text-muted-foreground/50">
        Tap to set as default. Long-press or use the edit icon to customize.
      </p>

      <div className="grid grid-cols-3 gap-1.5">
        {presets.map((preset, idx) => (
          <div
            key={idx}
            role="button"
            tabIndex={0}
            onClick={() => setDefault(idx)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDefault(idx); } }}
            className={`relative rounded-lg px-1.5 py-2 sm:py-2.5 text-center transition-all cursor-pointer border group ${ defaultAmount === preset.amount ? "border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/15 shadow-[0_0_8px_rgba(245,158,11,0.08)]" : "border-border dark:border-brand/10 bg-white/[0.02] hover:border-brand/25 hover:bg-brand/5" }`}
            data-testid={`button-zap-preset-${idx}`}
          >
            <button
              onClick={(e) => { e.stopPropagation(); startEdit(idx); }}
              className="absolute top-1 right-1 p-0.5 rounded reveal-on-hover touch-target text-muted-foreground/30 hover:text-muted-foreground/60"
              aria-label={`Edit preset ${idx + 1}`}
              data-testid={`button-edit-preset-${idx}`}
            >
              <Pencil className="w-2.5 h-2.5" />
            </button>
            <span className="text-base sm:text-lg leading-none">{preset.emoji}</span>
            <p className={`text-[10px] sm:text-[11px] font-medium mt-0.5 leading-tight truncate ${
              defaultAmount === preset.amount ? "text-amber-700 dark:text-amber-300" : "text-foreground/60"
            }`}>{preset.label}</p>
            <p className={`text-[9px] sm:text-[10px] mt-0.5 leading-tight font-mono ${
              defaultAmount === preset.amount ? "text-amber-600/70 dark:text-amber-400/60" : "text-muted-foreground/40"
            }`}>{formatAmount(preset.amount)} sats</p>
            {defaultAmount === preset.amount && (
              <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 flex items-center justify-center">
                <Check className="w-2 h-2 text-white" />
              </div>
            )}
          </div>
        ))}
      </div>

      {editingIdx !== null && (
        <div className="glass-card rounded-lg border p-3 space-y-2.5" data-testid="zap-preset-editor">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-foreground/70">Edit Preset {editingIdx + 1}</p>
            <button onClick={cancelEdit} className="text-muted-foreground/40 hover:text-muted-foreground/60">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="w-10 h-10 rounded-lg border border-border dark:border-brand/10 bg-brand/5 flex items-center justify-center text-lg hover:bg-brand/10 transition-colors shrink-0"
              data-testid="button-emoji-picker-toggle"
            >
              {editEmoji}
            </button>
            <Input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="Label"
              maxLength={12}
              className="text-base bg-white/[0.03] border-border dark:border-brand/15 focus-visible:border-brand h-10"
              data-testid="input-preset-label"
            />
            <div className="relative">
              <Input
                type="number"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                placeholder="Sats"
                min={1}
                inputMode="numeric"
                className="text-base bg-white/[0.03] border-border dark:border-brand/15 focus-visible:border-brand h-10 w-24 sm:w-28 pr-8"
                data-testid="input-preset-amount"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/40 pointer-events-none">sat</span>
            </div>
          </div>

          {showEmojiPicker && (
            <div className="grid grid-cols-8 sm:grid-cols-12 gap-1" data-testid="emoji-picker-grid">
              {EMOJI_OPTIONS.map((em) => (
                <button
                  key={em}
                  onClick={() => { setEditEmoji(em); setShowEmojiPicker(false); }}
                  className={`w-8 h-8 rounded-md flex items-center justify-center text-base hover:bg-primary/10 transition-colors ${
                    editEmoji === em ? "bg-primary/10 ring-1 ring-ring" : ""
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={saveEdit}
              size="sm"
              className="flex-1 text-xs font-brand uppercase tracking-widest"
              data-testid="button-save-preset"
            >
              <Check className="w-3 h-3 mr-1.5" />
              Save
            </Button>
            <Button
              onClick={cancelEdit}
              size="sm"
              variant="outline"
              className="text-xs font-brand uppercase tracking-widest border-border dark:border-brand/15"
              data-testid="button-cancel-preset"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/40">
        {defaultAmount.toLocaleString()} sats is your default zap amount
      </p>
    </div>
  );
}

function BtcTrackerToggle() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("btcTrackerEnabled") === "true");
  const toggle = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      localStorage.setItem("btcTrackerEnabled", String(next));
      window.dispatchEvent(new Event("btc-tracker-visibility-changed"));
      return next;
    });
  }, []);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground/75">BTC Tracker</p>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5 leading-relaxed">Show the Bitcoin price and wallet badge in the header bar.</p>
      </div>
      <button
        role="switch"
        aria-checked={enabled}
        onClick={toggle}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          enabled ? "bg-primary" : "bg-muted-foreground/30"
        }`}
        data-testid="toggle-btc-tracker"
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
            enabled ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export default function WalletPage({ embedded = false }: { embedded?: boolean } = {}) {
  const {
    isConnected, relay, balance, balanceLoading, walletPubkey,
    connectWallet, disconnectWallet, payInvoice,
    listTransactions, makeInvoice, payAddress, isProcessing, refreshBalance,
    triggerPoll } = useNWC();
  const { toast } = useToast();
  const { pubkey: myPubkey, signer } = useNostrAuth();
  useDocumentTitle("Wallet");

  const [nwcUri, setNwcUri] = useState("");
  const [nwcError, setNwcError] = useState("");
  const [zapEnrichments, setZapEnrichments] = useState<Map<string, ZapEnrichment>>(new Map());

  const [sendRecipient, setSendRecipient] = useState<SelectedRecipient | null>(null);
  const [sendAmount, setSendAmount] = useState<number | null>(null);
  const [sendCustomAmount, setSendCustomAmount] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sendSuccessAmount, setSendSuccessAmount] = useState<number | null>(null);
  const [zapPrivacy, setZapPrivacy] = useState<ZapPrivacy>(() => {
    return (localStorage.getItem("zapPrivacy") as ZapPrivacy) || "public";
  });

  const [receiveAmount, setReceiveAmount] = useState<number | null>(null);
  const [receiveCustomAmount, setReceiveCustomAmount] = useState("");
  const [receiveDescription, setReceiveDescription] = useState("");
  const [generatedInvoice, setGeneratedInvoice] = useState("");
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const [invoiceCopied, setInvoiceCopied] = useState(false);
  const [showLightningQR, setShowLightningQR] = useState(false);
  const [lnQRCopied, setLnQRCopied] = useState(false);
  const [showDMSend, setShowDMSend] = useState(false);
  const [dmRecipient, setDMRecipient] = useState<SelectedRecipient | null>(null);
  const [dmSending, setDMSending] = useState(false);

  const [transactions, setTransactions] = useState<NWCTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txLoaded, setTxLoaded] = useState(false);
  const [txFilterDirection, setTxFilterDirection] = useState<"all" | "incoming" | "outgoing">("all");
  const [txFilterCategory, setTxFilterCategory] = useState<"all" | TransactionCategory>("all");
  const [selectedTxKey, setSelectedTxKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("history");
  const [showScanner, setShowScanner] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnectStep, setDisconnectStep] = useState(1);
  const [nwcStringRevealed, setNwcStringRevealed] = useState(false);
  const [nwcCopied, setNwcCopied] = useState(false);
  const isMobile = useIsMobile();
  const [balanceHidden, setBalanceHidden] = useState(() => localStorage.getItem("walletBalanceHidden") === "true");

  useEffect(() => {
    const sync = () => setBalanceHidden(localStorage.getItem("walletBalanceHidden") === "true");
    window.addEventListener("balance-visibility-changed", sync);
    return () => window.removeEventListener("balance-visibility-changed", sync);
  }, []);

  const toggleBalanceVisibility = useCallback(() => {
    setBalanceHidden(prev => {
      const next = !prev;
      localStorage.setItem("walletBalanceHidden", String(next));
      window.dispatchEvent(new Event("balance-visibility-changed"));
      return next;
    });
  }, []);

  const myProfile = use$(() => myPubkey ? eventStore.replaceable(KIND_METADATA, myPubkey) : undefined, [myPubkey]);

  const myLightningAddress = useMemo(() => {
    if (!myProfile) return null;
    const content = getProfileContent(myProfile);
    return content?.lud16 || null;
  }, [myProfile]);

  const handleConnect = () => {
    const trimmed = nwcUri.trim();
    if (!trimmed) {
      setNwcError("Paste your wallet connection string");
      return;
    }
    if (!trimmed.startsWith("nostr+walletconnect://")) {
      setNwcError("Must start with nostr+walletconnect://");
      return;
    }
    setNwcError("");
    connectWallet(trimmed);
    setNwcUri("");
  };

  const effectiveSendAmount = sendAmount === -1
    ? (parseInt(sendCustomAmount, 10) || 0)
    : (sendAmount || 0);

  // Decode the invoice up front so the user sees amount/destination/memo before paying.
  const invoiceDetails = useMemo(
    () => (sendRecipient?.type === "invoice" && sendRecipient.invoice ? decodeBolt11(sendRecipient.invoice) : null),
    [sendRecipient],
  );
  const invoiceAmountless = sendRecipient?.type === "invoice" && invoiceDetails?.amountSats == null;
  const invoiceExpired = invoiceDetails?.expiresAt != null && invoiceDetails.expiresAt * 1000 < Date.now();

  const handleRecipientChange = useCallback((r: SelectedRecipient | null) => {
    setSendRecipient(r);
    setSendAmount(null);
    setSendCustomAmount("");
    setSendMessage("");
  }, []);

  const handleZapPrivacyChange = useCallback((privacy: ZapPrivacy) => {
    setZapPrivacy(privacy);
    localStorage.setItem("zapPrivacy", privacy);
  }, []);

  const resetSendForm = useCallback(() => {
    setSendRecipient(null);
    setSendAmount(null);
    setSendCustomAmount("");
    setSendMessage("");
    setSendSuccessAmount(null);
  }, []);

  const handleQRScan = useCallback((data: string) => {
    let cleaned = data.trim();
    if (cleaned.toLowerCase().startsWith("lightning:")) {
      cleaned = cleaned.slice("lightning:".length);
    }
    if (cleaned.toLowerCase().startsWith("lnbc") || cleaned.toLowerCase().startsWith("lntb") || cleaned.toLowerCase().startsWith("lnurl")) {
      setSendRecipient({ type: "invoice", invoice: cleaned, displayName: "Scanned Invoice" });
      setActiveTab("send");
    } else if (cleaned.includes("@") && cleaned.includes(".")) {
      setSendRecipient({ type: "address", lightningAddress: cleaned, displayName: cleaned });
      setActiveTab("send");
    } else {
      setSendRecipient({ type: "invoice", invoice: cleaned, displayName: "Scanned QR" });
      setActiveTab("send");
    }
  }, []);

  const handleSendPayment = async () => {
    if (!sendRecipient) return;

    if (sendRecipient.type === "invoice" && sendRecipient.invoice) {
      const details = decodeBolt11(sendRecipient.invoice);
      if (!details) {
        toast({ title: "Invalid invoice", description: "This doesn't look like a valid Lightning invoice.", variant: "destructive" });
        return;
      }
      // Amountless invoices must not be paid silently — require the sender to choose an amount.
      let amountMsat: number | undefined;
      let paidSats = details.amountSats ?? 0;
      if (details.amountSats === null) {
        if (effectiveSendAmount < 1) {
          toast({ title: "Enter an amount to send", description: "This invoice doesn't specify an amount.", variant: "destructive" });
          return;
        }
        amountMsat = effectiveSendAmount * 1000;
        paidSats = effectiveSendAmount;
      }
      const success = await payInvoice(sendRecipient.invoice, amountMsat);
      if (success) {
        setSendSuccessAmount(paidSats);
        setTimeout(resetSendForm, 2000);
        refreshBalance();
        schedulePostPayRefresh();
      }
      return;
    }

    const lnAddr = sendRecipient.lightningAddress || (sendRecipient.pubkey ? getLightningAddress(sendRecipient.pubkey) : null);
    if (!lnAddr) {
      toast({ title: "This user doesn't have a lightning address set up", variant: "destructive" });
      return;
    }

    if (effectiveSendAmount < 1) {
      toast({ title: "Enter an amount to send", variant: "destructive" });
      return;
    }

    const comment = sendMessage.trim() || undefined;

    if (zapPrivacy === "public" && sendRecipient.pubkey && signer) {
      try {
        const lnurlInfo = await resolveLnurl(lnAddr);
        const amountMsat = effectiveSendAmount * 1000;
        if (amountMsat < lnurlInfo.minSendable || amountMsat > lnurlInfo.maxSendable) {
          toast({ title: `Amount must be between ${Math.ceil(lnurlInfo.minSendable / 1000)} and ${Math.floor(lnurlInfo.maxSendable / 1000)} sats`, variant: "destructive" });
          return;
        }
        let zapRequestEvent: Event | undefined;
        if (lnurlInfo.allowsNostr) {
          const zapTemplate = buildZapRequest(
            sendRecipient.pubkey,
            "",
            amountMsat,
            DEFAULT_RELAYS.slice(0, 4),
            lnAddr,
            comment,
          );
          zapRequestEvent = await signWithTimeout(signer, zapTemplate) as Event;
        }
        const bolt11 = await fetchZapInvoice(lnurlInfo, amountMsat, zapRequestEvent, comment);
        const success = await payInvoice(bolt11);
        if (success) {
          setSendSuccessAmount(effectiveSendAmount);
          setTimeout(resetSendForm, 2000);
          refreshBalance();
          schedulePostPayRefresh();
        }
        return;
      } catch (err: any) {
        toast({ title: "Public zap failed", description: err.message || "Could not create zap request. Try switching to anonymous.", variant: "destructive" });
        return;
      }
    }

    const success = await payAddress(lnAddr, effectiveSendAmount, comment);
    if (success) {
      setSendSuccessAmount(effectiveSendAmount);
      setTimeout(resetSendForm, 2000);
      refreshBalance();
      schedulePostPayRefresh();
    }
  };

  const effectiveReceiveAmount = receiveAmount === -1
    ? (parseInt(receiveCustomAmount, 10) || 0)
    : (receiveAmount || 0);

  const handleGenerateInvoice = async () => {
    if (effectiveReceiveAmount < 1) {
      toast({ title: "Enter an amount in sats", variant: "destructive" });
      return;
    }
    setInvoiceLoading(true);
    const invoice = await makeInvoice(effectiveReceiveAmount * 1000, receiveDescription || undefined);
    setInvoiceLoading(false);
    if (invoice) {
      setGeneratedInvoice(invoice);
    }
  };

  const handleCopyAddress = async () => {
    if (!myLightningAddress) return;
    try {
      await navigator.clipboard.writeText(myLightningAddress);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleCopyInvoice = async () => {
    if (!generatedInvoice) return;
    try {
      await navigator.clipboard.writeText(generatedInvoice);
      setInvoiceCopied(true);
      setTimeout(() => setInvoiceCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleShareInvoice = async () => {
    if (!generatedInvoice) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Lightning Invoice - ${effectiveReceiveAmount} sats`,
          text: generatedInvoice });
      } catch {}
    } else {
      handleCopyInvoice();
    }
  };

  const handleSendInvoiceDM = async () => {
    if (!generatedInvoice || !dmRecipient?.pubkey || !myPubkey || !signer) return;
    setDMSending(true);
    try {
      fetchRelayLists([dmRecipient.pubkey]);
      const amountSats = effectiveReceiveAmount;
      const messageContent = `Lightning invoice for ${amountSats.toLocaleString()} sats:\n\n${generatedInvoice}`;
      const result = await sendDM({
        signer,
        senderPubkey: myPubkey,
        recipientPubkey: dmRecipient.pubkey,
        content: messageContent });
      if (result.success) {
        toast({
          title: "Invoice sent via DM",
          description: `Sent to ${dmRecipient.displayName || dmRecipient.pubkey.slice(0, 12) + "..."} using ${result.method.toUpperCase()}` });
        setShowDMSend(false);
        setDMRecipient(null);
      } else {
        toast({
          title: "Failed to send DM",
          description: result.error || "Could not send the invoice via DM",
          variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Failed to send DM",
        description: err instanceof Error ? err.message : "Something went wrong",
        variant: "destructive" });
    } finally {
      setDMSending(false);
    }
  };

  const txFetchIdRef = useRef(0);
  const postPayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTransactions = useCallback(async (silent = false) => {
    const fetchId = ++txFetchIdRef.current;
    if (!silent) setTxLoading(true);
    const txs = await listTransactions(50);
    if (txFetchIdRef.current !== fetchId) return;
    setTransactions(txs);
    setTxLoaded(true);
    if (!silent) setTxLoading(false);
    if (myPubkey && txs.length > 0) {
      fetchZapEnrichments(myPubkey, txs).then(map => {
        if (txFetchIdRef.current === fetchId) {
          setZapEnrichments(map);
        }
      });
    }
  }, [listTransactions, myPubkey]);

  const schedulePostPayRefresh = useCallback(() => {
    if (postPayTimerRef.current) clearTimeout(postPayTimerRef.current);
    postPayTimerRef.current = setTimeout(() => {
      loadTransactions(true);
      triggerPoll();
      postPayTimerRef.current = null;
    }, 2000);
  }, [loadTransactions, triggerPoll]);

  useEffect(() => {
    return () => {
      if (postPayTimerRef.current) clearTimeout(postPayTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (isConnected && !txLoaded) {
      loadTransactions();
    }
  }, [isConnected, txLoaded, loadTransactions]);

  useEffect(() => {
    if (!isConnected || !txLoaded) return;
    const interval = setInterval(() => {
      loadTransactions(true);
      refreshBalance();
    }, 30000);
    return () => clearInterval(interval);
  }, [isConnected, txLoaded, loadTransactions, refreshBalance]);

  const filteredTransactions = useMemo(() => {
    if (txFilterDirection === "all" && txFilterCategory === "all") return transactions;
    return transactions.filter(tx => {
      if (txFilterDirection !== "all" && tx.type !== txFilterDirection) return false;
      if (txFilterCategory !== "all") {
        const txKey = tx.payment_hash || `${tx.amount}-${tx.settled_at || tx.created_at}`;
        const cat = getTransactionCategory(tx, zapEnrichments.get(txKey) || null, myPubkey);
        if (cat !== txFilterCategory) return false;
      }
      return true;
    });
  }, [transactions, txFilterDirection, txFilterCategory, zapEnrichments, myPubkey]);

  const filteredTotal = useMemo(() => {
    return filteredTransactions.reduce((sum, tx) => sum + Math.floor((tx.amount || 0) / 1000), 0);
  }, [filteredTransactions]);

  const hasActiveFilter = txFilterDirection !== "all" || txFilterCategory !== "all";

  const availableCategories = useMemo(() => {
    const cats = new Set<TransactionCategory>();
    for (const tx of transactions) {
      const txKey = tx.payment_hash || `${tx.amount}-${tx.settled_at || tx.created_at}`;
      cats.add(getTransactionCategory(tx, zapEnrichments.get(txKey) || null, myPubkey));
    }
    return cats;
  }, [transactions, zapEnrichments, myPubkey]);

  const txBuckets = useTxBuckets(filteredTransactions);

  if (!isConnected) {
    return (
      <div className={embedded ? "" : "px-3 sm:px-4 py-4 sm:py-6"} data-testid="page-wallet">
        <MissionBriefing pageId="wallet" steps={WALLET_BRIEFING} />
        <div className={embedded ? "space-y-6" : "max-w-lg mx-auto space-y-6"}>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground flex items-center gap-2" data-testid="text-wallet-title">
              <BtcZapIcon className="w-5 h-5 text-amber-500/80" />
              Lightning Wallet
            </h1>
            <p className="text-xs text-muted-foreground">
              Connect your Lightning wallet to send and receive sats
            </p>
          </div>

          {/* Above the connect form on purpose: "where are my zaps?" is the
              question that brings a wallet-less user to this page, and the
              answer is not the NWC paste box. */}
          <NpubCashClaimCard myPubkey={myPubkey} lud16={myLightningAddress} signer={signer ?? null} />
          <MakeZappableCard myPubkey={myPubkey} signer={signer ?? null} profileEvent={myProfile} profileLoaded={myProfile !== undefined} />

          <Card className="glass-card" data-testid="card-wallet-connect">
            <CardContent className="p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <BtcZapIcon className="w-4 h-4 text-amber-800/80 dark:text-amber-400/80" />
                <span className="text-sm font-brand tracking-wider uppercase">Connect via NWC</span>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                Paste your NWC connection string from your Lightning wallet provider.
                Works with Alby, Coinos, Zeus, LNbits, and other NWC-compatible wallets.
              </p>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70">Setup Steps</div>
                  <div className="space-y-1">
                    {[
                      "Open your Lightning wallet app or website",
                      "Find \"Nostr Wallet Connect\" or \"NWC\" in settings",
                      "Create a new connection and copy the URI",
                      "Paste it below to link your wallet",
                    ].map((step, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Badge variant="outline" className="shrink-0 text-[11px] mt-0.5">{i + 1}</Badge>
                        <span className="text-xs text-muted-foreground">{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Input
                  placeholder="nostr+walletconnect://..."
                  value={nwcUri}
                  onChange={(e) => { setNwcUri(e.target.value); setNwcError(""); }}
                  className="font-mono text-xs"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  enterKeyHint="done"
                  data-testid="input-nwc-uri"
                />
                {nwcError && (
                  <p className="text-xs text-destructive flex items-center gap-1" data-testid="text-nwc-error">
                    <AlertCircle className="w-3 h-3" />
                    {nwcError}
                  </p>
                )}
                <Button onClick={handleConnect} className="w-full" data-testid="button-connect-wallet">
                  <BtcZapIcon className="w-4 h-4 mr-2" />
                  Connect Wallet
                </Button>
              </div>

              <div className="pt-3 border-t border-border/20">
                <div className="flex items-center gap-1.5">
                  <Unplug className="w-3 h-3 text-brand/40" />
                  <span className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/60">
                    NIP-47 Nostr Wallet Connect
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-brand/40 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    Your wallet keys never leave your wallet provider.
                    This app communicates with your wallet through encrypted Nostr relay messages.
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Compatible: Alby, Coinos, Zeus, LNbits, and others supporting NWC.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "" : "px-3 sm:px-4 py-4 sm:py-6"} data-testid="page-wallet">
      {!embedded && <MissionBriefing pageId="wallet" steps={WALLET_BRIEFING} />}
      <div className={embedded ? "space-y-4 sm:space-y-5" : "max-w-2xl mx-auto space-y-4 sm:space-y-5"}>
        {/* Rendered even with NWC connected: zaps follow the PROFILE's
            lightning address, not the connected wallet — an npub.cash lud16
            quietly diverts them to a mint the NWC balance will never show. */}
        <NpubCashClaimCard myPubkey={myPubkey} lud16={myLightningAddress} signer={signer ?? null} />
        <MakeZappableCard myPubkey={myPubkey} signer={signer ?? null} profileEvent={myProfile} profileLoaded={myProfile !== undefined} />
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="space-y-0.5">
              <h1 className="text-lg font-semibold text-foreground flex items-center gap-2" data-testid="text-wallet-title">
                <BtcZapIcon className="w-5 h-5 text-amber-500/80" />
                Lightning Wallet
              </h1>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/80 animate-pulse" />
                <span className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70">NWC Connected</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isMobile && (
              <Button variant="outline" size="sm" onClick={() => setShowScanner(true)} data-testid="button-scan-qr">
                <ScanLine className="w-3.5 h-3.5 mr-1.5" />
                Scan
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => { setDisconnectStep(1); setShowDisconnectConfirm(true); }} data-testid="button-disconnect-wallet">
              <Unplug className="w-3.5 h-3.5 mr-1.5" />
              Disconnect
            </Button>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl" data-testid="card-wallet-balance">
          <div className="absolute inset-0 bg-gradient-to-br from-[#0d0a1a] via-[#110e24] to-[#0a0816]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(139,92,246,0.12)_0%,_transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_rgba(99,102,241,0.08)_0%,_transparent_50%)]" />
          <div className="absolute inset-0 bg-gradient-to-t from-amber-500/[0.03] via-transparent to-brand/[0.04]" />
          <GalaxyStars />
          <div className="absolute inset-0 border border-white/[0.08] rounded-xl" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-[1px] bg-gradient-to-r from-transparent via-brand/30 to-transparent" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-[1px] bg-gradient-to-r from-transparent via-brand/15 to-transparent" />

          <div className="relative z-10 p-5 sm:p-7">
            {myLightningAddress && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowLightningQR(true)}
                className="absolute top-3 right-3 z-20 h-8 w-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] hover:border-white/[0.15] text-white/50 hover:text-white/80 backdrop-blur-sm"
                aria-label="Show Lightning address QR code"
                data-testid="button-wallet-qr-quick"
              >
                <QrCode className="w-4 h-4" />
              </Button>
            )}
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <BtcZapIcon className="w-5 h-5 text-amber-800/80 dark:text-amber-400/80" />
                  <div className="absolute inset-0 blur-sm bg-amber-400/20 rounded-full" />
                </div>
                <span className="text-[11px] font-brand uppercase tracking-[0.2em] text-white/50">Balance</span>
                <button
                  onClick={toggleBalanceVisibility}
                  className="text-white/30 hover:text-white/60 transition-colors cursor-pointer"
                  data-testid="button-toggle-balance-wallet"
                  title={balanceHidden ? "Show balance" : "Hide balance"}
                >
                  {balanceHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="flex items-baseline gap-2">
                {balanceLoading ? (
                  <RelayOutpostInlineLoader className="w-6 h-6" />
                ) : balance !== null ? (
                  <>
                    <span className={`text-4xl sm:text-5xl font-bold tabular-nums text-white transition-all duration-200 ${balanceHidden ? "blur-md select-none" : ""}`} data-testid="text-wallet-balance">
                      {balance.toLocaleString()}
                    </span>
                    <span className={`text-lg text-white/40 font-brand tracking-wider transition-all duration-200 ${balanceHidden ? "blur-sm select-none" : ""}`}>sats</span>
                  </>
                ) : (
                  <span className="text-lg text-white/40" data-testid="text-wallet-balance">--</span>
                )}
              </div>
              {isMobile ? (
                <div className="flex items-center justify-center gap-5 mt-2" data-testid="container-mobile-actions">
                  {[
                    { icon: ArrowUpRight, label: "SEND", tab: "send" as const, testId: "button-mobile-send" },
                    { icon: ScanLine, label: "SCAN", tab: "scan" as const, testId: "button-mobile-scan" },
                    { icon: ArrowDownLeft, label: "RECEIVE", tab: "receive" as const, testId: "button-mobile-receive" },
                    { icon: Settings2, label: "SETTINGS", tab: "settings" as const, testId: "button-mobile-settings" },
                  ].map(({ icon: Icon, label, tab, testId }) => (
                    <button
                      key={tab}
                      onClick={() => {
                        if (tab === "scan") {
                          setShowScanner(true);
                        } else {
                          setActiveTab(tab);
                        }
                      }}
                      className="flex flex-col items-center gap-1.5 group"
                      data-testid={testId}
                    >
                      <div className="w-14 h-14 rounded-full bg-white/[0.08] border border-white/[0.12] flex items-center justify-center transition-all group-active:scale-95 group-active:bg-white/[0.15]">
                        <Icon className="w-6 h-6 text-white/80" />
                      </div>
                      <span className="text-[10px] font-brand uppercase tracking-[0.15em] text-white/50">{label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refreshBalance}
                  disabled={balanceLoading}
                  className="text-white/40 hover:text-white/60 hover:bg-white/[0.06]"
                  data-testid="button-refresh-balance"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${balanceLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              )}
            </div>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-wallet-actions">
          <TabsList className={`w-full ${isMobile ? "hidden" : ""}`}>
            <TabsTrigger value="history" className="flex-1" data-testid="tab-wallet-history">
              <Clock className="w-4 h-4 mr-1.5" />
              History
            </TabsTrigger>
            <TabsTrigger value="send" className="flex-1" data-testid="tab-wallet-send">
              <ArrowUpRight className="w-4 h-4 mr-1.5" />
              Send
            </TabsTrigger>
            <TabsTrigger value="receive" className="flex-1" data-testid="tab-wallet-receive">
              <ArrowDownLeft className="w-4 h-4 mr-1.5" />
              Receive
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex-1" data-testid="tab-wallet-settings">
              <Settings2 className="w-4 h-4 mr-1.5" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="send">
            {isMobile && (
              <button
                onClick={() => { setActiveTab("history"); resetSendForm(); }}
                className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors"
                data-testid="button-mobile-back-send"
              >
                <ArrowDownLeft className="w-3.5 h-3.5 rotate-45" />
                Back to transactions
              </button>
            )}
            <Card className="glass-card">
              <CardContent className="p-4 space-y-4">
                {sendSuccessAmount !== null ? (
                  <div className="flex flex-col items-center gap-3 py-6" data-testid="container-send-success">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <Check className="w-6 h-6 text-emerald-500" />
                    </div>
                    <p className="text-sm font-medium text-emerald-500">Payment Sent</p>
                    <p className="text-xs text-muted-foreground/60">
                      {sendSuccessAmount > 0 ? `${sendSuccessAmount.toLocaleString()} sats` : "Invoice"} paid successfully
                    </p>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Recipient</label>
                      <ProfileSearchInput
                        selected={sendRecipient}
                        onSelect={handleRecipientChange}
                        placeholder="Search by name or handle, or paste an invoice…"
                      />
                    </div>

                    {sendRecipient && sendRecipient.type !== "invoice" && (
                      <>
                        <AmountSelector
                          value={sendAmount}
                          customValue={sendCustomAmount}
                          onSelect={setSendAmount}
                          onCustomChange={setSendCustomAmount}
                          label="Amount"
                        />

                        <div>
                          <label className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">
                            <MessageCircle className="w-3 h-3 inline-block mr-1 -mt-0.5" />
                            Message (optional)
                          </label>
                          <textarea
                            value={sendMessage}
                            onChange={(e) => setSendMessage(e.target.value)}
                            placeholder="Add a note to your payment..."
                            maxLength={280}
                            rows={2}
                            className="w-full rounded-lg border border-border/30 bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring focus:border-primary resize-none transition-all"
                            data-testid="input-send-message"
                          />
                          {sendMessage.length > 0 && (
                            <p className="text-[10px] text-muted-foreground/40 mt-0.5 text-right">{sendMessage.length}/280</p>
                          )}
                        </div>

                        <div>
                          <label className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Zap Visibility</label>
                          <div className="flex rounded-lg border border-border/30 overflow-hidden" data-testid="toggle-zap-privacy">
                            <button
                              onClick={() => handleZapPrivacyChange("public")}
                              disabled={!signer || !sendRecipient?.pubkey}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${ zapPrivacy === "public" && signer && sendRecipient?.pubkey ? "bg-brand/10 text-brand border-r border-border/30" : "text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-foreground/[0.03] border-r border-border/30" }`}
                              data-testid="button-zap-public"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Public
                            </button>
                            <button
                              onClick={() => handleZapPrivacyChange("anonymous")}
                              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-all cursor-pointer ${ zapPrivacy === "anonymous" || !signer || !sendRecipient?.pubkey ? "bg-brand/10 text-brand" : "text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-foreground/[0.03]" }`}
                              data-testid="button-zap-anonymous"
                            >
                              <Orbit className="w-3.5 h-3.5" />
                              Anonymous
                            </button>
                          </div>
                          <p className="text-[10px] text-muted-foreground/40 mt-1">
                            {!signer ? "Sign in to send public zaps" :
                             !sendRecipient?.pubkey ? "Public zaps require a Nostr profile recipient" :
                             zapPrivacy === "public" ? "Recipient will see your Nostr identity" : "Recipient will not see who sent the payment"}
                          </p>
                        </div>
                      </>
                    )}

                    {sendRecipient?.type === "invoice" && (
                      !invoiceDetails ? (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-3 flex items-start gap-2" data-testid="invoice-invalid">
                          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-red-500">Couldn't read this invoice</p>
                            <p className="text-[11px] text-muted-foreground/60 mt-0.5">This doesn't look like a valid Lightning invoice. Don't pay it unless you're sure where it came from.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-border/30 bg-background/40 divide-y divide-border/20" data-testid="invoice-review">
                          <div className="px-3 py-2.5">
                            <label className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Amount</label>
                            {invoiceAmountless ? (
                              <>
                                <AmountSelector
                                  value={sendAmount}
                                  customValue={sendCustomAmount}
                                  onSelect={setSendAmount}
                                  onCustomChange={setSendCustomAmount}
                                />
                                <p className="text-[10px] text-amber-500 mt-1.5">This invoice has no fixed amount — choose how much to send.</p>
                              </>
                            ) : (
                              <p className="text-lg font-semibold tabular-nums" data-testid="invoice-amount">
                                <BtcZapIcon className="w-4 h-4 inline-block mr-1 -mt-0.5" />
                                {invoiceDetails.amountSats!.toLocaleString()} sats
                              </p>
                            )}
                          </div>
                          {invoiceDetails.description && (
                            <div className="px-3 py-2.5">
                              <label className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70 mb-0.5 block">Description</label>
                              <p className="text-xs text-foreground/80 break-words" data-testid="invoice-description">{invoiceDetails.description}</p>
                            </div>
                          )}
                          {invoiceExpired && (
                            <div className="px-3 py-2.5 flex items-center gap-2" data-testid="invoice-expired">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                              <p className="text-[11px] text-red-500">This invoice has expired and will likely be rejected.</p>
                            </div>
                          )}
                        </div>
                      )
                    )}

                    {sendRecipient && (
                      <Button
                        onClick={handleSendPayment}
                        disabled={
                          isProcessing ||
                          (sendRecipient.type === "invoice"
                            ? (!invoiceDetails || invoiceExpired || (invoiceAmountless && effectiveSendAmount < 1))
                            : effectiveSendAmount < 1)
                        }
                        className="w-full"
                        data-testid="button-send-payment"
                      >
                        {isProcessing ? (
                          <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
                        ) : (
                          <Send className="w-4 h-4 mr-2" />
                        )}
                        {isProcessing ? "Sending..." : (
                          sendRecipient.type === "invoice"
                            ? (invoiceAmountless
                                ? (effectiveSendAmount > 0 ? `Confirm & Pay ${effectiveSendAmount.toLocaleString()} sats` : "Confirm & Pay")
                                : invoiceDetails?.amountSats
                                  ? `Confirm & Pay ${invoiceDetails.amountSats.toLocaleString()} sats`
                                  : "Confirm & Pay") :
                          effectiveSendAmount > 0 ? `Send ${effectiveSendAmount.toLocaleString()} sats` :
                          "Send Payment"
                        )}
                      </Button>
                    )}

                    {!sendRecipient && (
                      <div className="text-center py-4">
                        <p className="text-xs text-muted-foreground/50">
                          Search for a Nostr user, paste a lightning address, or paste an invoice
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="receive">
            {isMobile && (
              <button
                onClick={() => setActiveTab("history")}
                className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors"
                data-testid="button-mobile-back-receive"
              >
                <ArrowDownLeft className="w-3.5 h-3.5 rotate-45" />
                Back to transactions
              </button>
            )}
            <div className="space-y-4">
              {myLightningAddress && (
                <Card className="glass-card" data-testid="card-your-lightning-address">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                          <BtcZapIcon className="w-4 h-4 text-amber-500" />
                        </div>
                        <div className="min-w-0">
                          <label className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/50 block">Your Lightning Address</label>
                          <span className="text-sm font-mono text-foreground/80 dark:text-white/75 truncate block" data-testid="text-my-lightning-address">
                            {myLightningAddress}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyAddress}
                        className="shrink-0"
                        data-testid="button-copy-lightning-address"
                      >
                        {addressCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="glass-card" data-testid="card-request-payment">
                <CardContent className="p-4 space-y-4">
                  {generatedInvoice ? (
                    <div className="flex flex-col items-center gap-4" data-testid="container-generated-invoice">
                      <div className="text-center space-y-1">
                        <p className="text-sm font-medium text-foreground/80 dark:text-white/80">Invoice Created</p>
                        <p className="text-xs text-muted-foreground/60">
                          Share this to receive {effectiveReceiveAmount.toLocaleString()} sats
                        </p>
                      </div>

                      <div className="bg-white p-4 rounded-xl shadow-sm">
                        <QRCodeSVG value={generatedInvoice.toUpperCase()} size={220} data-testid="qr-receive-invoice" />
                      </div>

                      <div className="w-full space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={generatedInvoice.slice(0, 36) + "..."}
                            readOnly
                            className="text-[11px] font-mono flex-1"
                            data-testid="input-receive-invoice"
                          />
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={handleCopyInvoice}
                            data-testid="button-copy-receive-invoice"
                          >
                            {invoiceCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={handleShareInvoice}
                            data-testid="button-share-invoice"
                          >
                            <Share2 className="w-4 h-4" />
                          </Button>
                        </div>

                        {myPubkey && signer && (
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => setShowDMSend(true)}
                            data-testid="button-send-invoice-dm"
                          >
                            <MessageCircle className="w-4 h-4 mr-2" />
                            Send via DM
                          </Button>
                        )}

                        {showDMSend && (
                          <div className="space-y-3 p-3 rounded-lg bg-foreground/[0.02] dark:bg-white/[0.02] border border-border/20">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70">Send invoice to contact</span>
                              <button
                                onClick={() => { setShowDMSend(false); setDMRecipient(null); }}
                                className="p-1 rounded-md hover:bg-foreground/[0.06] transition-colors"
                                data-testid="button-close-dm-send"
                              >
                                <X className="w-3.5 h-3.5 text-muted-foreground/50" />
                              </button>
                            </div>
                            <ProfileSearchInput
                              selected={dmRecipient}
                              onSelect={setDMRecipient}
                              placeholder="Search for a contact to send invoice..."
                            />
                            {dmRecipient?.pubkey && (
                              <Button
                                onClick={handleSendInvoiceDM}
                                disabled={dmSending}
                                className="w-full"
                                data-testid="button-confirm-send-dm"
                              >
                                {dmSending ? (
                                  <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
                                ) : (
                                  <Send className="w-4 h-4 mr-2" />
                                )}
                                {dmSending ? "Sending..." : "Send Invoice via DM"}
                              </Button>
                            )}
                          </div>
                        )}

                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setGeneratedInvoice("");
                            setReceiveAmount(null);
                            setReceiveCustomAmount("");
                            setReceiveDescription("");
                            setShowDMSend(false);
                            setDMRecipient(null);
                          }}
                          data-testid="button-new-invoice"
                        >
                          Create New Invoice
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        <QrCode className="w-4 h-4 text-brand/60" />
                        <span className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70">Request Payment</span>
                      </div>

                      <AmountSelector
                        value={receiveAmount}
                        customValue={receiveCustomAmount}
                        onSelect={setReceiveAmount}
                        onCustomChange={setReceiveCustomAmount}
                        label="Amount"
                      />

                      <div>
                        <label className="text-[11px] font-brand uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Description (optional)</label>
                        <Input
                          placeholder="What's this payment for?"
                          value={receiveDescription}
                          onChange={(e) => setReceiveDescription(e.target.value)}
                          enterKeyHint="done"
                          data-testid="input-receive-description"
                        />
                      </div>

                      <Button
                        onClick={handleGenerateInvoice}
                        disabled={invoiceLoading || effectiveReceiveAmount < 1}
                        className="w-full"
                        data-testid="button-generate-invoice"
                      >
                        {invoiceLoading ? (
                          <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
                        ) : (
                          <QrCode className="w-4 h-4 mr-2" />
                        )}
                        {invoiceLoading ? "Creating Invoice..." :
                          effectiveReceiveAmount > 0 ? `Generate Invoice for ${effectiveReceiveAmount.toLocaleString()} sats` :
                          "Generate Invoice"
                        }
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <TransactionMetricsDashboard transactions={transactions} balanceHidden={balanceHidden} />
            <Card className="glass-card">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-brand uppercase tracking-[0.2em] text-muted-foreground/70">Transaction Log</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadTransactions}
                    disabled={txLoading}
                    data-testid="button-refresh-transactions"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${txLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>

                {transactions.length > 0 && (
                  <div className="space-y-2 mb-3 pb-3 border-b border-border/10" data-testid="container-tx-filters">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Filter className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                      {(["all", "incoming", "outgoing"] as const).map(dir => (
                        <button
                          key={dir}
                          onClick={() => setTxFilterDirection(dir)}
                          className={`px-2 py-1 rounded text-[10px] font-brand uppercase tracking-wider transition-all ${
                            txFilterDirection === dir
                              ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                              : "bg-foreground/[0.04] dark:bg-white/[0.04] text-muted-foreground/60 hover:bg-foreground/[0.08] dark:hover:bg-white/[0.08]"
                          }`}
                          data-testid={`button-filter-${dir}`}
                        >
                          {dir === "all" ? "All" : dir === "incoming" ? "Received" : "Sent"}
                        </button>
                      ))}
                      <span className="w-px h-4 bg-border/20 mx-0.5" />
                      <button
                        onClick={() => setTxFilterCategory("all")}
                        className={`px-2 py-1 rounded text-[10px] font-brand uppercase tracking-wider transition-all ${
                          txFilterCategory === "all"
                            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                            : "bg-foreground/[0.04] dark:bg-white/[0.04] text-muted-foreground/60 hover:bg-foreground/[0.08] dark:hover:bg-white/[0.08]"
                        }`}
                        data-testid="button-filter-cat-all"
                      >
                        All Types
                      </button>
                      {(["zap", "direct", "self", "lightning"] as TransactionCategory[]).filter(c => availableCategories.has(c)).map(cat => (
                        <button
                          key={cat}
                          onClick={() => setTxFilterCategory(cat)}
                          className={`px-2 py-1 rounded text-[10px] font-brand uppercase tracking-wider transition-all ${
                            txFilterCategory === cat
                              ? "bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                              : "bg-foreground/[0.04] dark:bg-white/[0.04] text-muted-foreground/60 hover:bg-foreground/[0.08] dark:hover:bg-white/[0.08]"
                          }`}
                          data-testid={`button-filter-cat-${cat}`}
                        >
                          {CATEGORY_CONFIG[cat].label}
                        </button>
                      ))}
                    </div>
                    {hasActiveFilter && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground/50">
                          {filteredTransactions.length} of {transactions.length} transactions · <span className={`transition-all duration-200 ${balanceHidden ? "blur-[6px] select-none" : ""}`}>{filteredTotal.toLocaleString()} sats</span>
                        </span>
                        <button
                          onClick={() => { setTxFilterDirection("all"); setTxFilterCategory("all"); }}
                          className="text-[10px] text-brand/60 hover:text-brand/80 transition-colors"
                          data-testid="button-clear-filters"
                        >
                          Clear filters
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {txLoading && transactions.length === 0 ? (
                  <div className="flex justify-center py-8">
                    <RelayOutpostInlineLoader className="w-6 h-6" />
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="text-center py-8">
                    <BtcZapIcon className="w-8 h-8 mx-auto text-amber-800/15 dark:text-amber-400/15 mb-2" />
                    <p className="text-sm text-muted-foreground/80">No transactions yet</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Transactions will appear here once you send or receive sats
                    </p>
                  </div>
                ) : filteredTransactions.length === 0 ? (
                  <div className="text-center py-6">
                    <Filter className="w-6 h-6 mx-auto text-muted-foreground/20 mb-2" />
                    <p className="text-sm text-muted-foreground/60">No matching transactions</p>
                    <button
                      onClick={() => { setTxFilterDirection("all"); setTxFilterCategory("all"); }}
                      className="text-xs text-brand/60 hover:text-brand/80 mt-1 transition-colors"
                      data-testid="button-clear-filters-empty"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1" data-testid="container-transaction-list">
                    {txBuckets.map(bucket => (
                      <TransactionDateGroup
                        key={bucket.key}
                        bucket={bucket}
                        enrichments={zapEnrichments}
                        myPubkey={myPubkey}
                        balanceHidden={balanceHidden}
                        filteredTotal={filteredTransactions.length}
                        onSelectTx={setSelectedTxKey}
                      />
                    ))}
                    {selectedTxKey !== null && (() => {
                      const stx = transactions.find(t => (t.payment_hash || `${t.amount}-${t.settled_at || t.created_at}`) === selectedTxKey);
                      if (!stx) return null;
                      return (
                        <TransactionDetailModal
                          tx={stx}
                          enrichment={zapEnrichments.get(selectedTxKey)}
                          myPubkey={myPubkey}
                          balanceHidden={balanceHidden}
                          onClose={() => setSelectedTxKey(null)}
                        />
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            {isMobile && (
              <button
                onClick={() => setActiveTab("history")}
                className="flex items-center gap-1.5 mb-3 text-xs text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors"
                data-testid="button-mobile-back-settings"
              >
                <ArrowDownLeft className="w-3.5 h-3.5 rotate-45" />
                Back to transactions
              </button>
            )}
            <div className="space-y-4">
              <Card className="glass-card">
                <CardContent className="p-4">
                  <BtcTrackerToggle />
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardContent className="p-4">
                  <ZapPresetsEditor />
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-500/70" />
                    <span className="text-sm font-brand tracking-wider uppercase">Lightning Uplink</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-9 h-9 rounded-md shrink-0"
                      style={{ background: "rgba(250, 200, 50, 0.08)", border: "1px solid rgba(250, 200, 50, 0.18)" }}
                    >
                      <Zap className="w-4 h-4 text-amber-600 dark:text-yellow-400/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground" data-testid="text-settings-nwc-status">Wallet Linked</p>
                      <p className="text-[11px] text-foreground/45 dark:text-muted-foreground/60 font-mono truncate mt-0.5" data-testid="text-settings-nwc-pubkey">
                        {walletPubkey ? `${walletPubkey.slice(0, 12)}...${walletPubkey.slice(-8)}` : ""}
                      </p>
                      {relay && (
                        <p className="text-[11px] text-foreground/45 dark:text-muted-foreground/50 font-mono truncate" data-testid="text-settings-nwc-relay">
                          {relay}
                        </p>
                      )}
                    </div>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500/80 shrink-0" />
                  </div>
                  <p className="text-xs text-foreground/50 dark:text-muted-foreground/60">
                    Zap invoices are paid automatically through your connected wallet.
                  </p>
                  <Button
                    onClick={() => setShowDisconnectConfirm(true)}
                    variant="outline"
                    className="w-full text-xs font-brand uppercase tracking-widest border-border dark:border-brand/15 bg-white/[0.02]"
                    data-testid="button-settings-disconnect-wallet"
                  >
                    <XCircle className="w-3.5 h-3.5 mr-2" />
                    Disconnect Uplink
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-center gap-2 py-1">
          <Radio className="w-3 h-3 text-brand/30" />
          <span className="text-[11px] font-brand uppercase tracking-[0.2em] text-muted-foreground/50">
            NIP-47 Encrypted Connection
          </span>
          {relay && (
            <span className="text-[11px] text-muted-foreground/40 truncate max-w-[200px] font-mono">
              {relay}
            </span>
          )}
        </div>
      </div>

      {activeTab !== "settings" && (
        <button
          onClick={() => setActiveTab("settings")}
          className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-primary hover:bg-primary/90 dark:bg-brand/80 dark:hover:bg-brand/80 text-primary-foreground shadow-lg shadow-primary/25 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 backdrop-blur-sm border border-primary/30"
          aria-label="Wallet settings"
          data-testid="button-floating-wallet-settings"
        >
          <Settings2 className="w-5 h-5" />
        </button>
      )}

      <Dialog open={showLightningQR} onOpenChange={setShowLightningQR}>
        <DialogContent className="sm:max-w-sm p-0 overflow-hidden border-border dark:border-brand/30" data-testid="dialog-wallet-lightning-qr">
          <VisuallyHidden><DialogTitle>Lightning Address QR Code</DialogTitle></VisuallyHidden>
          <div className="relative flex flex-col items-center px-6 pt-8 pb-6 glass-settings-section">
            <div className="absolute inset-0 pointer-events-none glass-settings-glow opacity-40" />
            <div className="relative flex flex-col items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                <BtcZapIcon className="w-6 h-6 text-amber-500" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Your Lightning Address</p>
                <p className="text-[11px] text-brand/50 dark:text-brand/60 mt-0.5">Scan to send sats</p>
              </div>
              {myLightningAddress && (
                <>
                  <div className="bg-white p-3 rounded-lg shadow-md">
                    <QRCodeSVG
                      value={`lightning:${myLightningAddress}`}
                      size={200}
                      data-testid="qr-wallet-lightning-address"
                    />
                  </div>
                  <div className="flex items-center gap-2 w-full max-w-[240px]">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0 rounded-md bg-accent dark:bg-white/5 border border-border dark:border-brand/20 px-2.5 py-1.5">
                      <BtcZapIcon className="w-3 h-3 text-amber-500/70 shrink-0" />
                      <span className="text-xs font-mono text-brand/70 dark:text-brand/80 truncate">
                        {myLightningAddress}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0 border-border hover:border-brand dark:border-brand/20 dark:hover:border-brand/40"
                      aria-label="Copy Lightning address"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(myLightningAddress);
                          setLnQRCopied(true);
                          setTimeout(() => setLnQRCopied(false), 2000);
                        } catch {}
                      }}
                      data-testid="button-copy-wallet-lightning-qr"
                    >
                      {lnQRCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                  {navigator.share && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border hover:border-brand dark:border-brand/20 dark:hover:border-brand/40"
                      onClick={async () => {
                        try {
                          await navigator.share({
                            title: "Lightning Address",
                            text: myLightningAddress });
                        } catch {}
                      }}
                      data-testid="button-share-wallet-lightning"
                    >
                      <Share2 className="w-3.5 h-3.5 mr-1.5" />
                      Share
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <QRScannerDialog
        open={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleQRScan}
      />

      <Dialog open={showDisconnectConfirm} onOpenChange={(open) => { setShowDisconnectConfirm(open); if (!open) { setDisconnectStep(1); setNwcStringRevealed(false); setNwcCopied(false); } }}>
        <DialogContent className="sm:max-w-sm p-0 overflow-hidden border-red-500/30 dark:border-red-500/20" data-testid="dialog-disconnect-confirm">
          <VisuallyHidden><DialogTitle>Disconnect Wallet</DialogTitle></VisuallyHidden>
          <div className="relative flex flex-col items-center px-6 pt-8 pb-6">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
            {disconnectStep === 1 ? (
              <>
                <h3 className="text-base font-semibold text-foreground mb-2" data-testid="text-disconnect-title">Disconnect Wallet?</h3>
                <p className="text-sm text-muted-foreground text-center mb-4">
                  This will remove your Nostr Wallet Connect (NWC) connection. You won't be able to send or receive sats until you reconnect.
                </p>
                <div className="w-full rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-300/80 leading-relaxed">
                      <span className="font-semibold">Tip:</span> Save your connection string before disconnecting so you can reconnect later.
                    </p>
                  </div>
                </div>
                {(() => {
                  const nwcUri = localStorage.getItem("relay-outpost-nwc-uri") || "";
                  if (!nwcUri) return null;
                  return (
                    <div className="w-full rounded-lg bg-foreground/[0.03] border border-border/20 p-3 mb-5" data-testid="container-nwc-string">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] text-muted-foreground/60 font-brand uppercase tracking-wider">Connection String</p>
                        <div className="flex items-center gap-1">
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-foreground/5 transition-colors cursor-pointer"
                            onClick={() => setNwcStringRevealed(r => !r)}
                            title={nwcStringRevealed ? "Hide" : "Reveal"}
                            data-testid="button-nwc-string-reveal"
                          >
                            {nwcStringRevealed ? <EyeOff className="w-3 h-3 text-muted-foreground/60" /> : <Eye className="w-3 h-3 text-muted-foreground/60" />}
                          </button>
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded hover:bg-foreground/5 transition-colors cursor-pointer"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(nwcUri);
                                setNwcCopied(true);
                                setTimeout(() => setNwcCopied(false), 2000);
                              } catch {
                                toast({ title: "Could not copy", description: "Try selecting and copying manually.", variant: "destructive" });
                              }
                            }}
                            title="Copy to clipboard"
                            data-testid="button-nwc-string-copy"
                          >
                            {nwcCopied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-muted-foreground/60" />}
                          </button>
                        </div>
                      </div>
                      <div className="relative rounded bg-black/20 dark:bg-black/40 p-2 overflow-hidden">
                        <p className={`text-[10px] font-mono leading-relaxed break-all transition-all duration-200 ${nwcStringRevealed ? "text-foreground/70" : "blur-[5px] select-none text-foreground/50"}`} data-testid="text-nwc-string">
                          {nwcUri}
                        </p>
                      </div>
                      {nwcCopied && (
                        <p className="text-[10px] text-emerald-500 mt-1.5 text-center">Copied to clipboard</p>
                      )}
                    </div>
                  );
                })()}
                <div className="flex items-center gap-3 w-full">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowDisconnectConfirm(false)}
                    data-testid="button-disconnect-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => setDisconnectStep(2)}
                    data-testid="button-disconnect-continue"
                  >
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-red-600 dark:text-red-400 mb-2" data-testid="text-disconnect-confirm-title">Are you sure?</h3>
                <p className="text-sm text-muted-foreground text-center mb-5">
                  This action cannot be undone. You'll need your NWC connection string to reconnect your wallet.
                </p>
                <div className="flex items-center gap-3 w-full">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setDisconnectStep(1)}
                    data-testid="button-disconnect-go-back"
                  >
                    Go Back
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => { disconnectWallet(); setShowDisconnectConfirm(false); setDisconnectStep(1); }}
                    data-testid="button-disconnect-confirm"
                  >
                    <Unplug className="w-3.5 h-3.5 mr-1.5" />
                    Disconnect
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
