import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrAuth, type QRLoginState, isPWAStandalone, isIOSDevice } from "@/contexts/NostrAuthContext";
import { ErrorBoundary, OnboardingErrorFallback } from "@/components/ErrorBoundary";
import { RelayOutpostIcon, RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Shield, Unplug, ArrowLeft, Lock, Fingerprint, QrCode, Copy, Check, RefreshCw, Smartphone, Info, ExternalLink, UserPlus, KeyRound, Sparkles, Compass, Radio, Plug, Rocket, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";
import { KeysInHandIcon } from "@/components/icons/KeysInHandIcon";
import { CreateAccountFlow } from "@/components/CreateAccountFlow";
import { ImportKeyFlow } from "@/components/ImportKeyFlow";
import { UnlockScreen } from "@/components/UnlockScreen";
import { loadLocalAccount, type StoredLocalAccount } from "@/lib/local-account";
import { isAddAccountPending } from "@/lib/account-registry";
import { loadImportDraft } from "@/lib/import-draft";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

interface LoginOptionsProps {
  variant?: "page" | "overlay";
  onBack?: () => void;
}

function QRLoginFlow({ onBack, variant }: { onBack: () => void; variant: "page" | "overlay" }) {
  const { initQRLogin, waitForQRLogin, cancelQRLogin, isLoggingIn } = useNostrAuth();
  const { toast } = useToast();
  const [qrState, setQRState] = useState<QRLoginState | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const qrStateRef = useRef<QRLoginState | null>(null);
  const isMobile = useMemo(() => isMobileDevice(), []);
  const isAndroid = useMemo(() => isAndroidDevice(), []);

  const startQRFlow = useCallback(() => {
    const state = initQRLogin();
    if (!state) return;
    setQRState(state);
    qrStateRef.current = state;
    setWaiting(true);
    setElapsed(0);
    setTimedOut(false);
    setRecovering(false);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsed((prev) => {
        if (prev + 1 >= 120) {
          setTimedOut(true);
          setWaiting(false);
          cancelQRLogin(state);
          if (timerRef.current) clearInterval(timerRef.current);
        }
        return prev + 1;
      });
    }, 1000);

    waitForQRLogin(state).then(() => {
      if (mountedRef.current) {
        setWaiting(false);
        setTimedOut(false);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    });
  }, [initQRLogin, waitForQRLogin]);

  useEffect(() => {
    startQRFlow();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const currentState = qrStateRef.current;
      if (!currentState || !waiting) return;

      console.log("[NIP-46] Tab regained focus, re-opening signer relay connections...");
      setRecovering(true);
      try {
        currentState.signer.open();
      } catch (err) {
        console.warn("[NIP-46] Failed to re-open signer connection:", err);
      }
      setTimeout(() => {
        if (mountedRef.current) setRecovering(false);
      }, 3000);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [waiting]);

  const handleRetryConnection = useCallback(() => {
    const currentState = qrStateRef.current;
    if (!currentState) return;
    console.log("[NIP-46] Manual retry — re-opening signer relay connections...");
    setRecovering(true);
    try {
      currentState.signer.open();
    } catch (err) {
      console.warn("[NIP-46] Retry failed:", err);
    }
    setTimeout(() => {
      if (mountedRef.current) setRecovering(false);
    }, 3000);
  }, []);

  const handleCancel = () => {
    if (qrState) cancelQRLogin(qrState);
    if (timerRef.current) clearInterval(timerRef.current);
    qrStateRef.current = null;
    onBack();
  };

  const handleRefresh = () => {
    if (qrState) cancelQRLogin(qrState);
    if (timerRef.current) clearInterval(timerRef.current);
    qrStateRef.current = null;
    startQRFlow();
  };

  const handleCopyUri = async () => {
    if (!qrState?.uri) return;
    try {
      await navigator.clipboard.writeText(qrState.uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const isOverlay = variant === "overlay";
  const cardCls = isOverlay
    ? "border-white/10 bg-black/40 backdrop-blur-lg"
    : "border-border/60 bg-card/50";

  return (
    <div className="space-y-4" data-testid="container-qr-login">
      <Card className={cardCls}>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-3">
            <div className={`flex items-center justify-center w-10 h-10 rounded-md shrink-0 ${isOverlay ? "bg-white/5 border border-white/10" : "bg-foreground/5 border border-border/40"}`}>
              <QrCode className={`w-5 h-5 ${isOverlay ? "text-white/70" : "text-foreground/70"}`} />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${isOverlay ? "text-white" : ""}`} data-testid="text-qr-title">
                {isMobile ? "Sign In with Signer App" : "Scan to Sign In"}
              </h3>
              <p className={`text-xs mt-0.5 ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}>
                {isMobile ? "Connect with your signer app" : "Use your signer app to scan"}
              </p>
            </div>
          </div>

          {isMobile ? (
            <div className={`rounded-md p-4 space-y-3 ${isOverlay ? "bg-white/[0.03] border border-white/10" : "bg-foreground/[0.03] border border-border/30"}`}>
              <div className="flex items-start gap-3">
                <Smartphone className={`w-4 h-4 mt-0.5 shrink-0 ${isOverlay ? "text-white/70" : "text-muted-foreground"}`} />
                <p className={`text-[11px] leading-relaxed ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}>
                  Tap the button below to open your signer app.
                  {isAndroid
                    ? <> Works with <a href="https://github.com/greenart7c3/Amber/releases" target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${isOverlay ? "text-white/85" : "text-foreground/80"}`} data-testid="link-amber-mobile">Amber</a> and other signer apps.</>
                    : " Your signer app will handle the connection."}
                </p>
              </div>
            </div>
          ) : (
            <div className={`rounded-md p-4 space-y-3 ${isOverlay ? "bg-white/[0.03] border border-white/10" : "bg-foreground/[0.03] border border-border/30"}`}>
              <div className="flex items-start gap-3">
                <Smartphone className={`w-4 h-4 mt-0.5 shrink-0 ${isOverlay ? "text-white/70" : "text-muted-foreground"}`} />
                <ol className={`text-[11px] space-y-1.5 list-decimal list-inside ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}>
                  <li>Open your signer app (<a href="https://github.com/greenart7c3/Amber" target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 ${isOverlay ? "text-white/85" : "text-foreground/80"}`} data-testid="link-amber-qr-instructions">Amber</a> on Android, Keystache, etc.)</li>
                  <li>Select <span className={`font-medium ${isOverlay ? "text-white/70" : "text-foreground/80"}`}>Remote Login</span> or <span className={`font-medium ${isOverlay ? "text-white/70" : "text-foreground/80"}`}>Scan Code</span></li>
                  <li>Scan the QR code below</li>
                </ol>
              </div>
            </div>
          )}

          {qrState?.uri ? (
            <div className="flex flex-col items-center space-y-4">
              {isMobile ? (
                <div className="w-full space-y-3">
                  <Button
                    className={`w-full font-brand uppercase tracking-widest text-xs ${isOverlay ? "bg-white text-black" : "bg-foreground text-background"}`}
                    onClick={() => {
                      try {
                        const w = window.open(qrState.uri, "_blank");
                        if (!w) {
                          const a = document.createElement("a");
                          a.href = qrState.uri;
                          a.target = "_blank";
                          a.rel = "noopener noreferrer";
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }
                      } catch {
                        window.location.href = qrState.uri;
                      }
                    }}
                    data-testid="button-open-signer-app"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open in Signer App
                  </Button>
                  <p className={`text-[11px] text-center ${isOverlay ? "text-white/65" : "text-muted-foreground/80"}`}>
                    If nothing happens, copy the connection string and paste it in your signer app
                  </p>
                  {timedOut && (
                    <div className={`rounded-md p-3 space-y-2 ${isOverlay ? "bg-red-500/10 border border-red-500/20" : "bg-destructive/10 border border-destructive/20"}`}>
                      <p className={`text-[11px] text-center font-medium ${isOverlay ? "text-red-300" : "text-destructive"}`}>
                        Connection timed out
                      </p>
                      <p className={`text-[10px] text-center ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}>
                        The signer did not respond. Try starting over.
                      </p>
                      <Button
                        size="sm"
                        className={`w-full text-xs font-brand uppercase tracking-widest ${isOverlay ? "bg-white text-black" : "bg-foreground text-background"}`}
                        onClick={handleRefresh}
                        data-testid="button-start-over"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        Start Over
                      </Button>
                    </div>
                  )}
                  {recovering && (
                    <div className="flex items-center justify-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isOverlay ? "bg-amber-400/70" : "bg-amber-500/70"}`} />
                      <span className={`text-[11px] font-mono ${isOverlay ? "text-amber-300/70" : "text-amber-600"}`}>
                        Reconnecting to relays...
                      </span>
                    </div>
                  )}
                  {waiting && !recovering && (
                    <div className="flex items-center justify-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isOverlay ? "bg-white/50" : "bg-foreground/50"}`} />
                      <span className={`text-[11px] font-mono ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}>
                        Waiting for approval {formatTime(elapsed)}
                      </span>
                    </div>
                  )}
                  {waiting && elapsed >= 30 && !recovering && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={`w-full text-[10px] font-brand uppercase tracking-widest ${isOverlay ? "border-white/15 text-white/60" : "border-border/50 text-muted-foreground"}`}
                      onClick={handleRetryConnection}
                      data-testid="button-retry-connection"
                    >
                      <RefreshCw className="w-3 h-3 mr-1.5" />
                      Retry Connection
                    </Button>
                  )}
                  <div className="flex items-center gap-2 w-full">
                    <Button
                      variant="outline"
                      size="sm"
                      className={`flex-1 text-xs font-brand uppercase tracking-widest ${isOverlay ? "border-white/20 text-white/70" : "border-border/60"}`}
                      onClick={handleCopyUri}
                      data-testid="button-copy-qr-uri-mobile"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                      {copied ? "Copied" : "Copy Connection String"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`text-xs font-brand uppercase tracking-widest ${isOverlay ? "border-white/20 text-white/70" : "border-border/60"}`}
                      onClick={handleRefresh}
                      disabled={isLoggingIn && elapsed < 3}
                      data-testid="button-refresh-mobile"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <div className="bg-white p-4 rounded-lg">
                      <QRCodeSVG
                        value={qrState.uri}
                        size={220}
                        level="M"
                        includeMargin={false}
                        data-testid="qr-code-image"
                      />
                    </div>
                    {waiting && (
                      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                        <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 shadow-sm ${isOverlay ? "bg-black/60 border border-white/10" : "bg-card border border-border/50"}`}>
                          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isOverlay ? "bg-white/50" : "bg-foreground/50"}`} />
                          <span className={`text-[11px] font-mono whitespace-nowrap ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}>
                            Waiting {formatTime(elapsed)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 w-full">
                    <Button
                      variant="outline"
                      size="sm"
                      className={`flex-1 text-xs font-brand uppercase tracking-widest ${isOverlay ? "border-white/20 text-white/70" : "border-border/60"}`}
                      onClick={handleCopyUri}
                      data-testid="button-copy-qr-uri"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                      {copied ? "Copied" : "Copy Connection String"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`text-xs font-brand uppercase tracking-widest ${isOverlay ? "border-white/20 text-white/70" : "border-border/60"}`}
                      onClick={handleRefresh}
                      disabled={isLoggingIn && elapsed < 3}
                      data-testid="button-refresh-qr"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center py-8 gap-3">
              <RelayOutpostInlineLoader className="w-6 h-6" />
              <span className={`text-xs ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}>Generating connection code...</span>
            </div>
          )}

          <div className={`flex items-center gap-1.5 pt-2 border-t ${isOverlay ? "border-white/10" : "border-border/30"}`}>
            <Lock className={`w-3 h-3 ${isOverlay ? "text-white/65" : "text-muted-foreground/80"}`} />
            <span className={`text-[11px] font-mono uppercase tracking-wider ${isOverlay ? "text-white/65" : "text-muted-foreground/80"}`}>
              Your account never leaves your signer app
            </span>
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={handleCancel}
        variant="ghost"
        className={`w-full font-brand uppercase tracking-widest text-xs ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}
        data-testid="button-back-from-qr"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to login options
      </Button>
    </div>
  );
}

type LoginMode = "select" | "bunker" | "qr" | "create" | "import" | "unlock";

export function LoginOptions({ variant = "page", onBack }: LoginOptionsProps) {
  const { isLoggingIn, loginWithExtension, loginWithBunker } = useNostrAuth();
  const [storedLocal, setStoredLocal] = useState<StoredLocalAccount | null>(() => loadLocalAccount());
  // Initial mode resolution priority:
  //   1. unlock     — there's an encrypted local account on disk; user has
  //                   an existing session to resume.
  //   2. import     — no saved account, but a resumable import draft is
  //                   in sessionStorage (mid-flow reload, mobile WebView
  //                   eviction). Auto-restore the user into the import
  //                   flow so they don't lose their work.
  //   3. select     — fresh visit, show the launch station.
  const [mode, setMode] = useState<LoginMode>(() => {
    // Add-account mode: the stored local account belongs to the CURRENT
    // (still signed-in) identity — showing its unlock screen here would
    // invite the user to "add" the account they already have. Start at the
    // method picker instead.
    if (isAddAccountPending()) return "select";
    if (loadLocalAccount()) return "unlock";
    if (loadImportDraft()) return "import";
    return "select";
  });
  const [bunkerUri, setBunkerUri] = useState("");

  // Scroll to top whenever the user enters a sub-flow so they always land
  // at the top of the new screen (especially important on mobile).
  useEffect(() => {
    if (mode === "select" || mode === "unlock") return;
    if (typeof window === "undefined") return;
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
      document.body?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [mode]);

  const [bunkerError, setBunkerError] = useState("");
  const isPWA = useMemo(() => isPWAStandalone(), []);
  const isIOS = useMemo(() => isIOSDevice(), []);
  const isAndroid = useMemo(() => isAndroidDevice(), []);
  const isMobile = useMemo(() => isMobileDevice(), []);
  // Mobile devices (and any iOS PWA, where extensions don't exist) lead with
  // the Remote Signer card. Desktop browsers lead with Browser Extension.
  // The recommendation only changes the order and adds a small badge — every
  // option remains visible and accessible below.
  const recommended: "extension" | "qr" = (isPWA && isIOS) || isMobile ? "qr" : "extension";
  const recommendedLabel = isIOS
    ? "Recommended for iPhone"
    : isAndroid
      ? "Recommended for Android"
      : "Recommended for desktop";
  const isOverlay = variant === "overlay";

  const handleExtensionLogin = async () => {
    await loginWithExtension();
  };

  const handleBunkerLogin = async () => {
    if (!bunkerUri.trim()) {
      setBunkerError("Enter a connection link");
      return;
    }
    if (!bunkerUri.startsWith("bunker://")) {
      setBunkerError("That doesn't look like a connection link (it should start with bunker://)");
      return;
    }
    setBunkerError("");
    await loginWithBunker(bunkerUri.trim());
  };

  const cardCls = isOverlay
    ? "border-white/10 bg-black/40 backdrop-blur-lg transition-[transform,box-shadow,border-color] duration-500 ease-out will-change-transform hover:-translate-y-1 hover:border-brand/35 hover:shadow-[0_30px_72px_-28px_rgba(91,46,162,0.5)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    : "border-border/60 bg-card/50 transition-[transform,box-shadow,border-color] duration-500 ease-out will-change-transform hover:-translate-y-1 hover:border-brand/35 hover:shadow-[0_24px_60px_-26px_rgba(91,46,162,0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0";
  const iconBoxCls = isOverlay
    ? "bg-white/5 border border-white/10"
    : "bg-foreground/5 border border-border/40";
  const iconCls = isOverlay ? "text-white/75" : "text-foreground/70";
  const titleCls = isOverlay ? "text-white" : "";
  const descCls = isOverlay ? "text-white/65" : "text-muted-foreground";
  const footerBorderCls = isOverlay ? "border-white/10" : "border-border/30";
  const footerTextCls = isOverlay ? "text-white/70" : "text-muted-foreground/80";
  const footerIconCls = isOverlay ? "text-white/70" : "text-muted-foreground/80";
  const linkCls = isOverlay ? "text-white/60 underline underline-offset-2" : "text-foreground/70 underline underline-offset-2";

  return (
    <div className="w-full">
      {mode === "select" && onBack && (
        <Button
          variant="ghost"
          onClick={onBack}
          className={`font-brand uppercase tracking-widest text-xs mb-4 ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}
          data-testid="button-back-from-login"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
      )}
      {mode === "unlock" && storedLocal && (
        <UnlockScreen
          variant={variant}
          account={storedLocal}
          onUseDifferentAccount={() => setMode("select")}
          onForget={() => { setStoredLocal(null); setMode("select"); }}
        />
      )}
      {mode === "create" && (
        <ErrorBoundary fallbackRender={(error) => <OnboardingErrorFallback error={error} />}>
          <CreateAccountFlow
            variant={variant}
            onBack={() => setMode("select")}
            onComplete={() => { /* auth state will rerender */ }}
          />
        </ErrorBoundary>
      )}
      {mode === "import" && (
        <ErrorBoundary fallbackRender={(error) => <OnboardingErrorFallback error={error} />}>
          <ImportKeyFlow
            variant={variant}
            onBack={() => setMode("select")}
            onComplete={() => { /* auth state will rerender */ }}
          />
        </ErrorBoundary>
      )}
      {mode === "select" && (
        <div className="space-y-3 md:space-y-4" data-testid="container-login-options">
          <div
            className={`banner-warp relative rounded-lg p-6 sm:p-8 md:p-10 overflow-hidden transition-[transform,box-shadow,border-color] duration-500 ease-out will-change-transform hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
              isOverlay
                ? "bg-gradient-to-br from-brand/[0.18] via-white/[0.05] to-brand/[0.14] border border-brand/35 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.7)] hover:border-brand/55 hover:shadow-[0_42px_92px_-26px_rgba(91,46,162,0.55)]"
                : "bg-gradient-to-br from-brand/[0.12] via-foreground/[0.03] to-brand/[0.08] border border-brand/35 shadow-[0_14px_40px_-12px_rgba(0,0,0,0.45)] hover:border-brand/55 hover:shadow-[0_36px_84px_-26px_rgba(91,46,162,0.4)]"
            }`}
            data-testid="banner-create-account"
          >
            {/* Soft top-edge highlight — a faint "lit from above" cue that
                lifts this card above the calmer sign-in options below. */}
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-x-0 top-0 h-px ${
                isOverlay ? "bg-gradient-to-r from-transparent via-brand/50 to-transparent" : "bg-gradient-to-r from-transparent via-brand/50 to-transparent"
              }`}
            />
            <div className="relative flex flex-col items-center text-center gap-4 sm:gap-5">
              <div className="w-full space-y-3 sm:space-y-4">
                {/* Eyebrow — small operator-voice kicker that frames the headline.
                    0.2em, not the 0.4em it shipped with. It measured fine
                    (4.61:1 on dark, 5.40:1 on light) and still read washed out,
                    because the problem was never contrast: at 11px, 0.4em puts
                    almost half a character of air between every letter, so the
                    word stops being a word and becomes spaced-out texture.
                    0.2em is also the house value — 43 uses across the app, and
                    the two sibling kickers in this very card sit at 0.25/0.3em.
                    The 0.4em was a one-off, the only one in the codebase.
                    Full-strength brand rather than /75 and /85 for the same
                    reason: a kicker this small has no room to be faint. */}
                <p
                  className="text-[11px] sm:text-xs font-mono uppercase tracking-[0.2em] text-brand"
                  data-testid="text-banner-eyebrow"
                >
                  Welcome
                </p>
                {/* Headline. Solid colour, NOT a bg-clip-text gradient.
                    The gradient was `text-transparent` with the colour supplied
                    entirely by a clipped background — which means anywhere that
                    background does not paint, the headline is not faint, it is
                    INVISIBLE. Forced-colors mode strips it; so do some print
                    paths. The most important line on the sign-in screen should
                    not depend on a decorative fill to exist, and there was no
                    fallback colour behind it.
                    It was also the only bg-clip-text in the app, so nothing else
                    is built on this idiom. Losing the violet fade costs little:
                    the eyebrow above and the CTA's glow still carry the brand,
                    and the headline gets to be the plainly-strongest thing on
                    the card, which is its job. */}
                <h3
                  className={`text-lg sm:text-xl md:text-2xl font-semibold tracking-tight leading-[1.1] text-balance ${
                    isOverlay ? "text-white" : "text-foreground"
                  }`}
                >
                  Create your account.
                </h3>
                {/* Pitch is the speed claim. */}
                <p className={`text-sm sm:text-base leading-relaxed max-w-md mx-auto ${descCls}`}>
                  Takes about 30 seconds — no email or phone number required.
                </p>
              </div>

              {/* CTAs: primary is sized up and gets a violet glow so the
                  primary action reads first. Secondary stays understated. */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 w-full sm:w-auto pt-1">
                <Button
                  onClick={() => setMode("create")}
                  size="lg"
                  className={`w-full sm:w-auto justify-center text-xs sm:text-sm font-brand uppercase tracking-widest px-6 shadow-[0_8px_24px_-8px_rgba(139,92,246,0.55)] ${isOverlay ? "bg-white text-black hover:bg-white/90" : "bg-foreground text-background hover:bg-foreground/90"}`}
                  data-testid="button-create-account"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Create Account
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setMode("import")}
                  className={`w-full sm:w-auto justify-center text-xs sm:text-sm font-brand uppercase tracking-widest px-6 ${isOverlay ? "border-white/20 text-white/80 bg-transparent hover:bg-white/[0.06]" : "border-border/60"}`}
                  data-testid="button-import-key"
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Use existing account
                </Button>
              </div>

              {/* Footer line — merges the non-custodial reassurance and the
                  WTF curiosity link into a single calm row so neither steals
                  attention from the buttons. */}
              <div className={`flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.25em] ${
                isOverlay ? "text-white/70" : "text-muted-foreground/75"
              }`}>
                <KeysInHandIcon className="w-3.5 h-3.5" />
                <span>Yours alone</span>
                <span aria-hidden className={isOverlay ? "text-white/25" : "text-muted-foreground/40"}>·</span>
                <Link
                  href="/help"
                  className={`inline-flex items-center gap-1 transition-colors ${isOverlay ? "text-brand/80 hover:text-brand-strong" : "text-brand hover:text-brand-strong"}`}
                  data-testid="link-wtf"
                >
                  <WtfAlienIcon className="w-3 h-3" />
                  <span>Help &amp; Guides</span>
                </Link>
              </div>
            </div>
          </div>

          <div className={`flex items-center gap-3 ${isOverlay ? "text-white/60" : "text-muted-foreground/60"}`}>
            <div className={`flex-1 h-px ${isOverlay ? "bg-white/10" : "bg-border"}`} />
            <span className="text-[10px] font-mono uppercase tracking-[0.3em]">or sign in with</span>
            <div className={`flex-1 h-px ${isOverlay ? "bg-white/10" : "bg-border"}`} />
          </div>

          {/* Compact chooser: every sign-in option, one tap each. Which app or
              extension to use is explained inside each flow's own screen (and in
              Help & Guides) — not up front. Platform-recommended option leads. */}
          <div
            className={`rounded-lg border overflow-hidden ${isOverlay ? "border-white/10 bg-white/[0.03]" : "border-border/50 bg-card/40"}`}
            data-testid="container-signin-options"
          >
            {[
              {
                key: "qr",
                icon: QrCode,
                title: "Signer app",
                caption: "Scan a QR code — most secure",
                onClick: () => setMode("qr"),
                disabled: isLoggingIn,
                order: recommended === "qr" ? 1 : 2,
                testId: "button-login-qr-select",
              },
              {
                key: "extension",
                icon: Fingerprint,
                title: "Browser extension",
                caption: isPWA ? "Not available in app mode" : "Alby, nos2x, or Nostash",
                onClick: handleExtensionLogin,
                disabled: isLoggingIn || isPWA,
                order: recommended === "extension" && !isPWA ? 1 : 2,
                testId: "button-login-extension",
              },
              {
                key: "bunker",
                icon: Unplug,
                title: "Connection link",
                caption: "Paste a link from your signer",
                onClick: () => setMode("bunker"),
                disabled: isLoggingIn,
                order: 3,
                testId: "button-login-bunker-select",
              },
            ]
              .sort((a, b) => a.order - b.order)
              .map((opt, i, arr) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={opt.onClick}
                  disabled={opt.disabled}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                    isOverlay ? "hover:bg-white/[0.05]" : "hover:bg-foreground/[0.04]"
                  } ${i < arr.length - 1 ? (isOverlay ? "border-b border-white/10" : "border-b border-border/40") : ""}`}
                  data-testid={opt.testId}
                >
                  <span className={`flex items-center justify-center w-9 h-9 rounded-md shrink-0 ${iconBoxCls}`}>
                    {isLoggingIn && opt.key === "extension" ? (
                      <RelayOutpostInlineLoader className="w-4 h-4" />
                    ) : (
                      <opt.icon className={`w-5 h-5 ${iconCls}`} />
                    )}
                  </span>
                  {/* The badge lives INSIDE the text column and wraps under
                      the title on narrow screens. As a shrink-0 sibling it
                      starved the flex-1 title of width and crushed "Signer
                      app / Scan a QR code" into a one-word-per-line column
                      (owner screenshot). */}
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className={`text-sm font-semibold ${titleCls}`}>{opt.title}</span>
                      {recommended === opt.key && !opt.disabled && (
                        <span
                          className={`text-[10px] font-brand uppercase tracking-widest px-1.5 py-0.5 rounded whitespace-nowrap ${isOverlay ? "text-white/80 bg-white/[0.08]" : "text-foreground/80 bg-foreground/[0.08]"}`}
                          data-testid={`badge-${opt.key}-recommended`}
                        >
                          {recommendedLabel}
                        </span>
                      )}
                    </span>
                    <span className={`block text-[11px] ${descCls}`}>{opt.caption}</span>
                  </span>
                  <ChevronRight className={`w-4 h-4 shrink-0 ${isOverlay ? "text-white/30" : "text-muted-foreground/40"}`} />
                </button>
              ))}
          </div>

          {/* Store QA 2.2: signup surfaces its own terms line inside
              CreateAccountFlow, but every SIGN-IN path (extension, QR,
              bunker, import) previously reached the app with no terms
              acceptance anywhere. One line here covers all of them —
              this chooser is the choke point both /login and the landing
              cockpit render. */}
          <p
            className={`text-center text-[10px] leading-relaxed ${isOverlay ? "text-white/45" : "text-muted-foreground/60"}`}
            data-testid="text-signin-legal-links"
          >
            By continuing you accept our{" "}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:opacity-80" data-testid="link-signin-covenant">Terms</a>
            {" "}and{" "}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:opacity-80" data-testid="link-signin-privacy">Privacy</a>.
          </p>

        </div>
      )}
      {mode === "qr" && (
        <QRLoginFlow onBack={() => setMode("select")} variant={variant} />
      )}
      {mode === "bunker" && (
        <div className="space-y-4" data-testid="container-bunker-form">
          <Card className={cardCls}>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className={`flex items-center justify-center w-10 h-10 rounded-md shrink-0 ${iconBoxCls}`}>
                  <Unplug className={`w-5 h-5 ${iconCls}`} />
                </div>
                <div>
                  <h3 className={`text-sm font-semibold ${titleCls}`} data-testid="text-bunker-form-title">Connection link</h3>
                  <p className={`text-xs mt-0.5 ${descCls}`}>
                    Paste the connection link from your signer app below — it signs you in securely.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Input
                  value={bunkerUri}
                  onChange={(e) => {
                    setBunkerUri(e.target.value);
                    setBunkerError("");
                  }}
                  placeholder="bunker://pubkey?relay=wss://..."
                  className={`font-mono text-xs ${isOverlay ? "bg-black/30 border-white/15 text-white placeholder:text-white/25" : "bg-background/50"}`}
                  style={{ fontSize: 16 }}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  enterKeyHint="done"
                  data-testid="input-bunker-uri"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleBunkerLogin();
                  }}
                />
                {bunkerError && (
                  <p className="text-xs text-destructive" data-testid="text-bunker-error">{bunkerError}</p>
                )}
              </div>

              <Button
                onClick={handleBunkerLogin}
                disabled={isLoggingIn || !bunkerUri.trim()}
                className={`w-full font-brand uppercase tracking-widest text-xs ${isOverlay ? "bg-white text-black" : "bg-foreground text-background"}`}
                data-testid="button-bunker-connect"
              >
                {isLoggingIn ? (
                  <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
                ) : (
                  <Unplug className="w-4 h-4 mr-2" />
                )}
                {isLoggingIn ? "Connecting..." : "Connect to Signer"}
              </Button>

              <div className={`rounded-md p-3 space-y-2 ${isOverlay ? "bg-white/[0.03] border border-white/10" : "bg-foreground/[0.03] border border-border/30"}`}>
                <p className={`text-[11px] font-mono uppercase tracking-wider font-semibold ${descCls}`}>
                  How to get a bunker:// URI
                </p>
                <ul className={`text-[11px] space-y-1 list-disc list-inside ${descCls}`}>
                  <li><a href="https://github.com/greenart7c3/Amber" target="_blank" rel="noopener noreferrer" className={linkCls} data-testid="link-amber-bunker-instructions">Amber</a> (Android): Settings &rarr; Share bunker connection</li>
                  <li>nsecBunker: Create a connection and copy the URI</li>
                  <li>Any compatible signer app</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={() => {
              setMode("select");
              setBunkerError("");
            }}
            variant="ghost"
            className={`w-full font-brand uppercase tracking-widest text-xs ${isOverlay ? "text-white/70" : "text-muted-foreground"}`}
            data-testid="button-back-to-options"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to login options
          </Button>
        </div>
      )}

      {(mode === "qr" || mode === "bunker") && (() => {
        const tagline = (() => {
          switch (mode) {
            case "qr":
              return { Icon: Radio, text: "Waiting for your signer app" };
            case "bunker":
              return { Icon: Plug, text: "Connecting to your signer" };
            default:
              return null as never;
          }
        })();
        if (!tagline) return null;
        const { Icon, text } = tagline;
        return (
          <div className="flex items-center justify-center gap-2 pt-2">
            <div className={`h-px w-6 sm:w-10 ${isOverlay ? "bg-white/10" : "bg-border"}`} />
            <Icon className={`w-3 h-3 shrink-0 ${isOverlay ? "text-brand/70" : "text-brand/70"}`} />
            <span className={`text-[11px] sm:text-xs font-mono uppercase tracking-[0.25em] sm:tracking-[0.3em] text-center ${isOverlay ? "text-white/65" : "text-muted-foreground/70"}`}>
              {text}
            </span>
            <div className={`h-px w-6 sm:w-10 ${isOverlay ? "bg-white/10" : "bg-border"}`} />
          </div>
        );
      })()}
    </div>
  );
}
