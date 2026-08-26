import { useState, useCallback, useMemo, useEffect } from "react";
import type { Event } from "nostr-tools";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useNWC } from "@/contexts/NWCContext";
import {
  getLightningAddress,
  resolveLnurl,
  buildZapRequest,
  fetchZapInvoice,
  formatSats,
  payWithWebLN,
} from "@/lib/zap";
import { DEFAULT_RELAYS, eventStore } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName, formatNpub, shortenNpub } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { primalStatsCache } from "@/lib/primal-cache";
import { Copy, Check, ExternalLink, X, Eye, Orbit, MessageCircle, QrCode, ChevronDown, Smartphone, Smile } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { getZapPresets } from "@/lib/zap-presets";

const ZAP_EMOJIS = ["⚡", "🤙", "🔥", "💜", "🫡", "🙏", "❤️", "👏", "💪", "🎵", "🎶", "🚀", "✨", "💫", "🌟", "👑", "💎", "🙌", "😎", "🤝"];

function GalaxyStars() {
  const stars = useMemo(() => {
    const s = [];
    for (let i = 0; i < 40; i++) {
      s.push({
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        size: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.4 + 0.1,
        delay: `${Math.random() * 4}s`,
      });
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
            animationDuration: "3s",
          }}
        />
      ))}
    </div>
  );
}


interface ZapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event?: Event;
  pubkey?: string;
  recipientName?: string;
}

type ZapStep = "amount" | "loading" | "invoice" | "success" | "error";

export function ZapDialog({ open, onOpenChange, event, pubkey: directPubkey, recipientName }: ZapDialogProps) {
  const { signer } = useNostrAuth();
  const { toast } = useToast();
  const { isConnected: nwcConnected, payInvoice: nwcPayInvoice, isProcessing: nwcProcessing, refreshBalance } = useNWC();
  const isMobile = useIsMobile();

  const [zapPresets, setZapPresets] = useState(() => getZapPresets());

  useEffect(() => {
    if (open) {
      setZapPresets(getZapPresets());
    }
  }, [open]);

  const [step, setStep] = useState<ZapStep>("amount");
  const [selectedAmount, setSelectedAmount] = useState(() => {
    try {
      const saved = localStorage.getItem("defaultZapAmount");
      if (saved) {
        const num = parseInt(saved, 10);
        if (num > 0) return num;
      }
    } catch {}
    return 100;
  });
  const [customAmount, setCustomAmount] = useState("");
  const [invoice, setInvoice] = useState("");
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [zapMessage, setZapMessage] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [zapPrivacy, setZapPrivacy] = useState<"public" | "anonymous">(() => {
    return (localStorage.getItem("zapPrivacy") as "public" | "anonymous") || "public";
  });
  const [showLnQR, setShowLnQR] = useState(false);
  const [lnAddrCopied, setLnAddrCopied] = useState(false);

  const amount = customAmount ? parseInt(customAmount, 10) : selectedAmount;

  const targetPubkey = event?.pubkey || directPubkey;
  const lightningAddr = targetPubkey ? getLightningAddress(targetPubkey) : null;

  const resolvedName = useMemo(() => {
    if (recipientName) return recipientName;
    if (!targetPubkey) return "this user";
    const meta = eventStore.getReplaceable(KIND_METADATA, targetPubkey);
    if (meta) {
      const fallback = shortenNpub(formatNpub(targetPubkey));
      return getDisplayName(meta, fallback) ?? fallback;
    }
    return shortenNpub(formatNpub(targetPubkey));
  }, [recipientName, targetPubkey]);

  const handleZapPrivacyChange = useCallback((privacy: "public" | "anonymous") => {
    setZapPrivacy(privacy);
    localStorage.setItem("zapPrivacy", privacy);
  }, []);

  const resetState = useCallback(() => {
    setStep("amount");
    try {
      const saved = localStorage.getItem("defaultZapAmount");
      const num = saved ? parseInt(saved, 10) : 0;
      setSelectedAmount(num > 0 ? num : 100);
    } catch {
      setSelectedAmount(100);
    }
    setCustomAmount("");
    setZapMessage("");
    setInvoice("");
    setCopied(false);
    setErrorMsg("");
    setManualConfirmed(false);
    setShowLnQR(false);
    setLnAddrCopied(false);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  // Defensive: this modal is often nested inside a HoverCard / dropdown menu.
  // Radix sets `body { pointer-events: none }` while a modal is open and clears
  // it on close — but when the dialog closes (or unmounts) while its floating
  // parent is also dismissing, that cleanup can be skipped, leaving the WHOLE
  // page unclickable. Force-restore whenever this dialog is not open.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      if (document.body.style.pointerEvents === "none") document.body.style.pointerEvents = "";
    }, 100);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => () => { if (document.body.style.pointerEvents === "none") document.body.style.pointerEvents = ""; }, []);

  const updateZapStats = useCallback(() => {
    if (event?.id) {
      const existing = primalStatsCache.get(event.id);
      const base = existing ?? { replies: 0, reposts: 0, likes: 0, zaps: 0, zapAmount: 0 };
      primalStatsCache.set(event.id, {
        ...base,
        zaps: base.zaps + 1,
        zapAmount: base.zapAmount + amount,
      });
    }
  }, [event?.id, amount]);

  const handleZap = async () => {
    if (!amount || amount < 1) {
      toast({ title: "Invalid amount", description: "Enter a valid amount of sats.", variant: "destructive" });
      return;
    }

    setStep("loading");

    try {
      if (!targetPubkey) {
        throw new Error("No recipient specified.");
      }

      const freshLightningAddr = getLightningAddress(targetPubkey);
      if (!freshLightningAddr) {
        throw new Error("This user doesn't have a lightning address set up.");
      }

      const lnurlInfo = await resolveLnurl(freshLightningAddr);
      const amountMsat = amount * 1000;

      if (amountMsat < lnurlInfo.minSendable) {
        throw new Error(`Minimum ${Math.ceil(lnurlInfo.minSendable / 1000)} sats required.`);
      }
      if (amountMsat > lnurlInfo.maxSendable) {
        throw new Error(`Maximum ${Math.floor(lnurlInfo.maxSendable / 1000)} sats allowed.`);
      }

      let zapRequestEvent: Event | undefined;
      const comment = zapMessage.trim() || undefined;

      if (zapPrivacy === "public" && lnurlInfo.allowsNostr && signer) {
        const zapTemplate = buildZapRequest(
          targetPubkey,
          event?.id || "",
          amountMsat,
          DEFAULT_RELAYS.slice(0, 4),
          freshLightningAddr || undefined,
          comment,
        );
        zapRequestEvent = await signWithTimeout(signer, zapTemplate) as Event;
      }

      const bolt11 = await fetchZapInvoice(lnurlInfo, amountMsat, zapRequestEvent, comment);

      if (nwcConnected) {
        const paid = await nwcPayInvoice(bolt11);
        if (paid) {
          updateZapStats();
          setStep("success");
          refreshBalance();
          setTimeout(() => handleOpenChange(false), 1500);
          return;
        }
        // NWC is the user's connected wallet, but a `false` here can be a relay
        // response timeout where the payment actually SETTLED. Never auto-retry
        // via WebLN — that would pay the same invoice twice. Show the invoice so
        // the user can verify in their wallet and pay manually only if needed.
        setInvoice(bolt11);
        setStep("invoice");
        return;
      }

      const paidViaWebLN = await payWithWebLN(bolt11);
      if (paidViaWebLN) {
        updateZapStats();
        setStep("success");
        refreshBalance();
        setTimeout(() => handleOpenChange(false), 1500);
        return;
      }

      setInvoice(bolt11);
      setStep("invoice");
    } catch (err: any) {
      console.error("Zap error:", err);
      setErrorMsg(err.message || "Failed to create zap");
      setStep("error");
    }
  };

  const handleIPaid = () => {
    if (manualConfirmed) return;
    setManualConfirmed(true);
    updateZapStats();
    setStep("success");
    setTimeout(() => handleOpenChange(false), 1500);
  };

  const handleCopyInvoice = async () => {
    try {
      await navigator.clipboard.writeText(invoice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
    }
  };

  const handleOpenWallet = () => {
    window.open(`lightning:${invoice}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md !p-0 !border-0 !bg-transparent !gap-0 !shadow-none overflow-hidden [&>button:last-child]:hidden" data-testid="dialog-zap">
        <div className="relative rounded-xl overflow-hidden shadow-[0_0_40px_rgba(245,158,11,0.1),0_0_80px_rgba(245,158,11,0.06),0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_0_40px_rgba(245,158,11,0.08),0_0_80px_rgba(245,158,11,0.04),0_8px_32px_rgba(0,0,0,0.6)]">
          <div className="absolute inset-0 zap-dialog-bg" />
          <div className="absolute inset-0 zap-dialog-glow-top" />
          <div className="absolute inset-0 zap-dialog-glow-corner" />
          <div className="dark:block hidden"><GalaxyStars /></div>
          <div className="absolute inset-0 border border-amber-500/15 dark:border-amber-500/8 rounded-xl" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-[1px] bg-gradient-to-r from-transparent via-amber-400/30 to-transparent" />
          <button
            onClick={() => handleOpenChange(false)}
            className="absolute right-3 top-3 z-20 p-1 rounded-md text-foreground/45 hover:text-foreground/70 hover:bg-foreground/5 transition-all cursor-pointer"
            data-testid="button-zap-close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="relative z-10">
            <DialogHeader className="px-5 pt-5 pb-3">
              <DialogTitle className="flex items-center gap-2.5 text-foreground dark:text-white/90" data-testid="text-zap-title">
                <div className="relative">
                  <BtcZapIcon className="w-5 h-5 text-amber-800 dark:text-amber-400" />
                  <div className="absolute inset-0 blur-sm bg-amber-400/30 rounded-full" />
                </div>
                <span className="font-semibold tracking-tight">Zap {resolvedName}</span>
              </DialogTitle>
            </DialogHeader>

            {step === "amount" && (
              <div className="flex flex-col gap-4 px-5 pb-5" data-testid="container-zap-amount">
                {!showLnQR ? (
                  <>
                    <p className="text-[13px] text-muted-foreground">Choose an amount (sats) to send</p>
                    <div className="grid grid-cols-3 gap-2">
                      {zapPresets.map((preset, idx) => (
                        <button
                          key={idx}
                          className={`relative px-2 py-2 sm:py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                            selectedAmount === preset.amount && !customAmount
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.1)]"
                              : "bg-foreground/[0.03] text-foreground/50 border border-foreground/[0.08] hover:bg-foreground/[0.06] hover:text-foreground/70 hover:border-foreground/[0.12]"
                          }`}
                          onClick={() => { setSelectedAmount(preset.amount); setCustomAmount(""); }}
                          data-testid={`button-zap-preset-${preset.amount}`}
                        >
                          <span className="flex flex-col items-center gap-0.5">
                            <span className="text-base leading-none">{preset.emoji}</span>
                            <span className="flex items-center gap-1 text-[11px] sm:text-xs">
                              <BtcZapIcon className={`w-3 h-3 shrink-0 ${selectedAmount === preset.amount && !customAmount ? "text-amber-600 dark:text-amber-300" : "text-amber-500/50"}`} />
                              {formatSats(preset.amount)}
                            </span>
                            <span className={`text-[9px] sm:text-[10px] leading-tight ${selectedAmount === preset.amount && !customAmount ? "text-amber-600/70 dark:text-amber-300/70" : "text-muted-foreground/40"}`}>{preset.label}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          type="number"
                          placeholder="Custom amount"
                          value={customAmount}
                          onChange={(e) => setCustomAmount(e.target.value)}
                          min={1}
                          inputMode="numeric"
                          enterKeyHint="done"
                          className="bg-foreground/[0.03] border-foreground/[0.08] text-foreground/80 placeholder:text-foreground/25 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/20"
                          style={{ fontSize: 16 }}
                          data-testid="input-zap-custom"
                        />
                      </div>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground/60 font-mono uppercase tracking-wider">
                        <BtcZapIcon className="w-3.5 h-3.5 text-amber-500/40" />
                        sats
                      </span>
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wider text-muted-foreground/50 mb-1.5 flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        Message (optional)
                      </label>
                      <div className="relative">
                        <textarea
                          value={zapMessage}
                          onChange={(e) => setZapMessage(e.target.value)}
                          placeholder="Add a note to your zap..."
                          maxLength={280}
                          rows={2}
                          className="w-full rounded-lg border border-foreground/[0.08] bg-foreground/[0.03] px-3 py-2 pr-9 text-sm placeholder:text-foreground/25 focus:outline-none focus:ring-1 focus:ring-amber-500/30 focus:border-amber-500/20 resize-none transition-all"
                          style={{ fontSize: 16 }}
                          data-testid="input-zap-message"
                        />
                        <button
                          type="button"
                          onClick={() => setShowEmojis((v) => !v)}
                          className="absolute right-2 top-2 p-1 rounded-md text-muted-foreground/40 hover:text-amber-500/70 hover:bg-amber-500/10 transition-colors"
                          title="Add emoji"
                        >
                          <Smile className="w-4 h-4" />
                        </button>
                      </div>
                      {showEmojis && (
                        <div className="flex flex-wrap gap-1 mt-1.5 p-2 rounded-lg bg-foreground/[0.03] border border-foreground/[0.08] animate-in fade-in slide-in-from-top-1 duration-150">
                          {ZAP_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => {
                                if (zapMessage.length < 280) {
                                  setZapMessage((m) => m + emoji);
                                }
                              }}
                              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-amber-500/10 transition-colors text-base"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                      {zapMessage.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/40 mt-0.5 text-right">{zapMessage.length}/280</p>
                      )}
                    </div>
                    <div className="flex rounded-lg border border-foreground/[0.08] overflow-hidden" data-testid="toggle-zap-dialog-privacy">
                      <button
                        onClick={() => handleZapPrivacyChange("public")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                          zapPrivacy === "public"
                            ? "bg-amber-500/12 text-amber-700 dark:text-amber-300 border-r border-foreground/[0.08]"
                            : "text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-foreground/[0.03] border-r border-foreground/[0.08]"
                        }`}
                        data-testid="button-zap-dialog-public"
                      >
                        <Eye className="w-3 h-3" />
                        Public
                      </button>
                      <button
                        onClick={() => handleZapPrivacyChange("anonymous")}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                          zapPrivacy === "anonymous"
                            ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                            : "text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-foreground/[0.03]"
                        }`}
                        data-testid="button-zap-dialog-anonymous"
                      >
                        <Orbit className="w-3 h-3" />
                        Anonymous
                      </button>
                    </div>
                    <button
                      onClick={handleZap}
                      disabled={!amount || amount < 1}
                      className="relative w-full py-3 rounded-lg font-semibold text-sm transition-all duration-200 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-amber-500/90 to-amber-600/90 text-black hover:from-amber-400 hover:to-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.15)] hover:shadow-[0_0_30px_rgba(245,158,11,0.25)]"
                      data-testid="button-zap-send"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <BtcZapIcon className="w-4 h-4" />
                        {zapPrivacy === "anonymous" ? `Send ${formatSats(amount)} sats` : `Zap ${formatSats(amount)} sats`}
                      </span>
                    </button>
                    {nwcConnected && (
                      <div className="flex items-center justify-center gap-1.5 py-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400/80 animate-pulse" />
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/50">
                          NWC auto-pay
                        </span>
                      </div>
                    )}
                    {lightningAddr && (
                      <button
                        onClick={() => setShowLnQR(true)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 border-t border-foreground/[0.06] text-[11px] uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors cursor-pointer"
                        data-testid="button-toggle-ln-qr"
                      >
                        <QrCode className="w-3 h-3" />
                        Pay from external wallet
                      </button>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-4 animate-in fade-in duration-200" data-testid="container-ln-qr-overlay">
                    <button
                      onClick={() => setShowLnQR(false)}
                      className="self-start flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors cursor-pointer"
                      data-testid="button-ln-qr-back"
                    >
                      <ChevronDown className="w-3 h-3 rotate-90" />
                      Back to zap
                    </button>
                    <p className="text-[13px] text-muted-foreground text-center">
                      {isMobile ? "Pay" : "Scan to pay"} <span className="text-amber-600 dark:text-amber-400/80 font-medium">{resolvedName}</span>
                    </p>
                    {isMobile && (
                      <button
                        onClick={() => window.open(`lightning:${lightningAddr}`, "_blank")}
                        className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg text-sm font-medium bg-gradient-to-r from-amber-500/90 to-amber-600/90 text-black hover:from-amber-400 hover:to-amber-500 transition-all cursor-pointer shadow-[0_0_15px_rgba(245,158,11,0.12)]"
                        data-testid="button-open-wallet-ln-addr"
                      >
                        <Smartphone className="w-4 h-4" />
                        Open in Wallet App
                      </button>
                    )}
                    {!isMobile && (
                      <div className="bg-white p-4 rounded-xl shadow-sm">
                        <QRCodeSVG
                          value={`lightning:${lightningAddr}`}
                          size={200}
                          fgColor="#0a0a10"
                          bgColor="#ffffff"
                          data-testid="qr-zap-lightning-address"
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2 w-full max-w-[280px]">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 rounded-lg bg-foreground/[0.03] border border-foreground/[0.06] px-2.5 py-2">
                        <BtcZapIcon className="w-3.5 h-3.5 text-amber-500/60 shrink-0" />
                        <span className="text-[11px] font-mono text-muted-foreground/60 truncate">
                          {lightningAddr}
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(lightningAddr!);
                            setLnAddrCopied(true);
                            setTimeout(() => setLnAddrCopied(false), 2000);
                          } catch {
                            toast({ title: "Error", description: "Failed to copy.", variant: "destructive" });
                          }
                        }}
                        className="p-2 rounded-lg bg-foreground/[0.03] border border-foreground/[0.06] hover:bg-foreground/[0.08] transition-colors cursor-pointer shrink-0"
                        data-testid="button-copy-zap-ln-addr"
                      >
                        {lnAddrCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground/50" />}
                      </button>
                    </div>
                    {isMobile && (
                      <p className="text-[10px] text-muted-foreground/40 text-center leading-relaxed">
                        Opens your Lightning wallet to send sats directly
                      </p>
                    )}
                    {!isMobile && (
                      <p className="text-[10px] text-muted-foreground/40 text-center leading-relaxed">
                        Scan with your wallet app to send sats directly
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {step === "loading" && (
              <div className="flex flex-col items-center justify-center py-12 gap-4 px-5" data-testid="container-zap-loading">
                <div className="relative">
                  <RelayOutpostInlineLoader className="w-8 h-8" />
                  <div className="absolute inset-0 blur-md bg-amber-400/10 rounded-full" />
                </div>
                <p className="text-sm text-muted-foreground font-mono tracking-wide">Creating invoice...</p>
              </div>
            )}

            {step === "invoice" && (
              <div className="flex flex-col items-center gap-4 px-5 pb-5" data-testid="container-zap-invoice">
                <p className="text-[13px] text-muted-foreground text-center">
                  Scan or copy to pay <span className="text-amber-600 dark:text-amber-400/80 font-medium">{formatSats(amount)} sats</span>
                </p>
                <div className="relative p-4 rounded-xl bg-white">
                  <QRCodeSVG
                    value={invoice.toUpperCase()}
                    size={200}
                    fgColor="#0a0a10"
                    bgColor="#ffffff"
                    data-testid="qr-zap-invoice"
                  />
                </div>
                <div className="flex items-center gap-2 w-full">
                  <div className="flex-1 px-3 py-2 rounded-lg bg-foreground/[0.03] border border-foreground/[0.08] overflow-hidden">
                    <span className="text-[11px] font-mono text-muted-foreground/60 truncate block">
                      {invoice.slice(0, 44)}...
                    </span>
                  </div>
                  <button
                    onClick={handleCopyInvoice}
                    className="p-2 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] hover:bg-foreground/[0.08] transition-colors cursor-pointer"
                    data-testid="button-copy-invoice"
                  >
                    {copied ? <Check className="w-4 h-4 text-green-500 dark:text-green-400" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
                  </button>
                </div>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={handleOpenWallet}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-foreground/60 bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] hover:text-foreground/80 transition-all cursor-pointer"
                    data-testid="button-open-wallet"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Wallet
                  </button>
                  <button
                    onClick={handleCopyInvoice}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm text-foreground/60 bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] hover:text-foreground/80 transition-all cursor-pointer"
                    data-testid="button-copy-full-invoice"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copied ? "Copied" : "Copy Invoice"}
                  </button>
                </div>
                <div className="w-full pt-1">
                  <button
                    onClick={handleIPaid}
                    disabled={manualConfirmed}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-amber-500/90 to-amber-600/90 text-black hover:from-amber-400 hover:to-amber-500 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(245,158,11,0.12)]"
                    data-testid="button-zap-i-paid"
                  >
                    <Check className="w-3.5 h-3.5" />
                    I Paid
                  </button>
                </div>
              </div>
            )}

            {step === "success" && (
              <div className="flex flex-col items-center justify-center py-10 gap-3 px-5" data-testid="container-zap-success">
                <div className="relative">
                  <BtcZapIcon className="w-10 h-10 text-amber-800 dark:text-amber-400" />
                  <div className="absolute inset-0 blur-xl bg-amber-400/20 rounded-full scale-150" />
                </div>
                <p className="text-lg font-semibold text-foreground tracking-tight">Zapped!</p>
                <p className="text-sm text-amber-600/70 dark:text-amber-400/60 font-mono">{formatSats(amount)} sats sent</p>
              </div>
            )}

            {step === "error" && (
              <div className="flex flex-col items-center justify-center py-10 gap-4 px-5" data-testid="container-zap-error">
                <p className="text-sm text-red-600 dark:text-red-400/80 text-center leading-relaxed">{errorMsg}</p>
                <button
                  onClick={resetState}
                  className="px-5 py-2 rounded-lg text-sm text-foreground/60 bg-foreground/[0.04] border border-foreground/[0.08] hover:bg-foreground/[0.08] hover:text-foreground/80 transition-all cursor-pointer"
                  data-testid="button-zap-retry"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BtcIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="10.5" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <path d="M13.5 3.5L9 13h4l-1 7.5L17 10h-4.5l1-6.5z" fill="currentColor" />
    </svg>
  );
}
