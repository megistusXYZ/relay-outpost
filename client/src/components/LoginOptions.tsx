import { isMobileDevice, isAndroidDevice } from "@/lib/platform";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNostrAuth, type QRLoginState, isIOSHomeScreenApp, isIOSDevice } from "@/contexts/NostrAuthContext";
import { ErrorBoundary, OnboardingErrorFallback } from "@/components/ErrorBoundary";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { Unplug, ArrowLeft, Lock, Fingerprint, QrCode, Copy, Check, RefreshCw, Smartphone, ExternalLink, UserPlus, KeyRound, Radio, Plug, ChevronRight } from "lucide-react";
import { CreateAccountFlow } from "@/components/CreateAccountFlow";
import { ImportKeyFlow } from "@/components/ImportKeyFlow";
import { UnlockScreen } from "@/components/UnlockScreen";
import { loadLocalAccount, type StoredLocalAccount } from "@/lib/local-account";
import { isAddAccountPending } from "@/lib/account-registry";
import { loadImportDraft } from "@/lib/import-draft";
import { loadSignupDraft, draftHasResumableContent } from "@/lib/account-draft";
import { initialLoginMode } from "@/lib/login-mode";
import { isFirstAppLaunch } from "@/lib/app-launch";
import { QRCodeSVG } from "qrcode.react";
import { useToast } from "@/hooks/use-toast";


interface LoginOptionsProps {
  onBack?: () => void;
}

function QRLoginFlow({ onBack }: { onBack: () => void; }) {
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
  const cardCls = "border-border/60 bg-card/50";

  return (
    <div className="space-y-4" data-testid="container-qr-login">
      <Card className={cardCls}>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-md shrink-0 bg-foreground/5 border border-border/40">
              <QrCode className="w-5 h-5 text-foreground/70" />
            </div>
            <div>
              <h3 className="text-sm font-semibold" data-testid="text-qr-title">
                {isMobile ? "Sign In with Signer App" : "Scan to Sign In"}
              </h3>
              <p className="text-xs mt-0.5 text-muted-foreground">
                {isMobile ? "Connect with your signer app" : "Use your signer app to scan"}
              </p>
            </div>
          </div>

          {isMobile ? (
            <div className="rounded-md p-4 space-y-3 bg-foreground/[0.03] border border-border/30">
              <div className="flex items-start gap-3">
                <Smartphone className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Tap the button below to open your signer app.
                  {isAndroid
                    ? <> Works with <a href="https://github.com/greenart7c3/Amber/releases" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-foreground" data-testid="link-amber-mobile">Amber</a> and other signer apps.</>
                    : " Your signer app will handle the connection."}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-md p-4 space-y-3 bg-foreground/[0.03] border border-border/30">
              <div className="flex items-start gap-3">
                <Smartphone className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <ol className="text-xs space-y-1.5 list-decimal list-inside text-muted-foreground">
                  <li>Open your signer app (<a href="https://github.com/greenart7c3/Amber" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-foreground" data-testid="link-amber-qr-instructions">Amber</a> on Android, Keystache, etc.)</li>
                  <li>Select <span className="font-medium text-foreground">Remote Login</span> or <span className="font-medium text-foreground">Scan Code</span></li>
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
                    className="w-full text-xs font-medium bg-foreground text-background"
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
                  <p className="text-xs text-center text-muted-foreground">
                    If nothing happens, copy the connection string and paste it in your signer app
                  </p>
                  {timedOut && (
                    <div className="rounded-md p-3 space-y-2 bg-destructive/10 border border-destructive/20">
                      <p className="text-xs text-center font-medium text-destructive">
                        Connection timed out
                      </p>
                      <p className="text-xs text-center text-muted-foreground">
                        The signer did not respond. Try starting over.
                      </p>
                      <Button
                        size="sm"
                        className="w-full text-xs font-medium bg-foreground text-background"
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
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-amber-500/70" />
                      <span className="text-xs font-mono text-warning">
                        Reconnecting to relays...
                      </span>
                    </div>
                  )}
                  {waiting && !recovering && (
                    <div className="flex items-center justify-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-foreground/50" />
                      <span className="text-xs font-mono text-muted-foreground">
                        Waiting for approval {formatTime(elapsed)}
                      </span>
                    </div>
                  )}
                  {waiting && elapsed >= 30 && !recovering && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-[13px] font-medium border-border/50 text-muted-foreground"
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
                      className="flex-1 text-xs font-medium border-border/60"
                      onClick={handleCopyUri}
                      data-testid="button-copy-qr-uri-mobile"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                      {copied ? "Copied" : "Copy Connection String"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-medium border-border/60"
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
                        <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1 shadow-sm bg-card border border-border/50">
                          <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-foreground/50" />
                          <span className="text-xs font-mono whitespace-nowrap text-muted-foreground">
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
                      className="flex-1 text-xs font-medium border-border/60"
                      onClick={handleCopyUri}
                      data-testid="button-copy-qr-uri"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                      {copied ? "Copied" : "Copy Connection String"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-medium border-border/60"
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
              <span className="text-xs text-muted-foreground">Generating connection code...</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 pt-2 border-t border-border/30">
            <Lock className="w-3 h-3 text-muted-foreground/80" />
            <span className="text-[12px] font-medium text-muted-foreground">
              Your account never leaves your signer app
            </span>
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={handleCancel}
        variant="ghost"
        className="w-full text-xs font-medium text-muted-foreground"
        data-testid="button-back-from-qr"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to login options
      </Button>
    </div>
  );
}

type LoginMode = "select" | "bunker" | "qr" | "create" | "import" | "unlock" | "reconnect";

export function LoginOptions({ onBack }: LoginOptionsProps) {
  // The three other sign-in methods stay folded until asked for.
  const [moreOpen, setMoreOpen] = useState(false);
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
    // Stated once in lib/login-mode.ts: a sign-up in flight resumes the
    // sign-up (not the fork, not the unlock screen for an unfinished account).
    const draft = loadSignupDraft();
    return initialLoginMode({
      addAccountPending: isAddAccountPending(),
      localAccountPubkey: loadLocalAccount()?.pubkey ?? null,
      signupDraft: draft ? { resumable: draftHasResumableContent(draft), pubkey: draft.account?.pubkey ?? null } : null,
      importDraft: !!loadImportDraft(),
      firstAppLaunch: isFirstAppLaunch(),
    });
  });
  // Started at the app's reconnect screen: every sub-flow's Back returns there.
  const [home] = useState<LoginMode>(() => (mode === "reconnect" ? "reconnect" : "select"));
  const [bunkerUri, setBunkerUri] = useState("");

  // Scroll to top whenever the user enters a sub-flow so they always land
  // at the top of the new screen (especially important on mobile).
  useEffect(() => {
    if (mode === "select" || mode === "unlock" || mode === "reconnect") return;
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
  // The iPhone home-screen app: the one place a browser extension cannot run.
  const noExtensionsHere = useMemo(() => isIOSHomeScreenApp(), []);
  const isIOS = useMemo(() => isIOSDevice(), []);
  const isAndroid = useMemo(() => isAndroidDevice(), []);
  const isMobile = useMemo(() => isMobileDevice(), []);
  // Mobile devices (the iPhone home-screen app included) lead with
  // the Remote Signer card. Desktop browsers lead with Browser Extension.
  // The recommendation only changes the order and adds a small badge — every
  // option remains visible and accessible below.
  const recommended: "extension" | "qr" = noExtensionsHere || isMobile ? "qr" : "extension";
  const recommendedLabel = isIOS
    ? "Recommended for iPhone"
    : isAndroid
      ? "Recommended for Android"
      : "Recommended for desktop";

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

  const cardCls = "border-border/60 bg-card/50 transition-[transform,box-shadow,border-color] duration-500 ease-out will-change-transform hover:-translate-y-1 hover:border-foreground/25 hover:shadow-[0_24px_60px_-26px_rgba(0,0,0,0.25)] motion-reduce:transition-none motion-reduce:hover:translate-y-0";
  const iconBoxCls = "dark:bg-foreground/[0.05] dark:border dark:border-border/40"; // no icon tiles in light (Outpost look)
  const iconCls = "text-foreground";
  const descCls = "text-muted-foreground";
  const linkCls = "text-foreground underline underline-offset-2";

  return (
    <div className="w-full">
      {mode === "select" && onBack && (
        // In the content's own column, so it lines up with the heading and buttons.
        <div className="mx-auto w-full max-w-sm">
          <Button
            variant="ghost"
            onClick={onBack}
            className="-ml-3 min-h-[44px] text-sm mb-2 font-medium text-muted-foreground hover:text-foreground"
            data-testid="button-back-from-login"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </div>
      )}
      {mode === "unlock" && storedLocal && (
        <UnlockScreen
          account={storedLocal}
          onUseDifferentAccount={() => setMode("select")}
          onForget={() => { setStoredLocal(null); setMode("select"); }}
        />
      )}
      {mode === "create" && (
        <ErrorBoundary fallbackRender={(error) => <OnboardingErrorFallback error={error} />}>
          <CreateAccountFlow
            onBack={() => setMode(home)}
            onComplete={() => { /* auth state will rerender */ }}
          />
        </ErrorBoundary>
      )}
      {mode === "import" && (
        <ErrorBoundary fallbackRender={(error) => <OnboardingErrorFallback error={error} />}>
          <ImportKeyFlow
            onBack={() => setMode(home)}
            onComplete={() => { /* auth state will rerender */ }}
          />
        </ErrorBoundary>
      )}
      {mode === "reconnect" && (
        <div className="space-y-4" data-testid="container-app-reconnect">
          <div className="text-center space-y-2 px-2">
            <h2 className="text-xl font-semibold tracking-tight text-balance text-foreground">
              Welcome to the app
            </h2>
            <p className={`text-sm leading-relaxed max-w-sm mx-auto ${descCls}`}>
              Reconnect your account once and pick up where you left off.
            </p>
            {isIOS && (
              <p className={`text-xs leading-relaxed max-w-sm mx-auto ${descCls}`} data-testid="text-app-separate-storage">
                The app keeps its own storage, apart from Safari, so it doesn't know you yet. Nothing is lost: your posts and follows are still yours.
              </p>
            )}
          </div>
          <div
            className="rounded-lg border overflow-hidden border-border/50 bg-card/40"
          >
            {[
              { key: "qr", icon: QrCode, title: "Reconnect with your signer", caption: "Open your signer app, or scan its code", mode: "qr" as const, testId: "button-reconnect-signer" },
              { key: "bunker", icon: Unplug, title: "Paste a connection link", caption: "A link from your signer app", mode: "bunker" as const, testId: "button-reconnect-link" },
              {
                key: "import", icon: KeyRound, title: "Import your key again",
                caption: `Signed in with your key ${isIOS ? "in Safari" : "in the browser"}? Paste it from your password manager or open your key file.`,
                mode: "import" as const, testId: "button-reconnect-key",
              },
            ].map((opt, i, arr) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setMode(opt.mode)}
                disabled={isLoggingIn}
                className={`w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] text-left transition-colors disabled:opacity-45 hover:bg-foreground/[0.04] ${i < arr.length - 1 ? "border-b border-border/40" : ""}`}
                data-testid={opt.testId}
              >
                <opt.icon className={`w-5 h-5 shrink-0 ${iconCls}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold">{opt.title}</span>
                  <span className={`block text-xs leading-snug ${descCls}`}>{opt.caption}</span>
                </span>
                <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
          <div className="flex flex-col items-center gap-1 pt-1">
            <p className={`text-xs ${descCls}`}>New here?</p>
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              onClick={() => setMode("create")}
              data-testid="button-reconnect-create"
            >
              <UserPlus className="w-4 h-4 mr-2" />
              Create an account
            </Button>
            <button
              type="button"
              onClick={() => setMode("select")}
              className={`mt-1 min-h-[44px] text-xs ${linkCls}`}
              data-testid="button-reconnect-other"
            >
              Other ways to sign in
            </button>
          </div>
        </div>
      )}
      {mode === "select" && (
        <div className="mx-auto w-full max-w-sm flex flex-col items-stretch gap-5 text-center" data-testid="container-login-options">
          {/* Less is more (owner, 2026-11-18): the heading, two buttons, one link
              that unfolds the other ways in, and the legal line. No eyebrow, no
              pitch, no reassurance row; the container above draws the mark. The
              headline is a solid colour (never a clipped gradient: that vanished
              in forced-colours mode). */}
          <div className="flex flex-col gap-6" data-testid="banner-create-account">
            <h3 className="text-[28px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-[1.1] text-balance text-foreground">
              Create your account.
            </h3>
            <div className="flex flex-col gap-2.5">
              <Button
                onClick={() => setMode("create")}
                size="lg"
                className="w-full h-12 rounded-full justify-center text-[15px] font-medium bg-foreground text-background hover:bg-foreground/90"
                data-testid="button-create-account"
              >
                Create account
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => setMode("import")}
                className="w-full h-12 rounded-full justify-center text-[15px] font-medium"
                data-testid="button-import-key"
              >
                Use existing account
              </Button>
            </div>
          </div>

          {/* Every other sign-in option, one tap away. Which app or extension to
              use is explained inside each flow's own screen and in Help & guides. */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-controls="signin-more"
            className={`mx-auto min-h-[44px] px-3 text-sm ${linkCls}`}
            data-testid="button-other-signin"
          >
            Other ways to sign in
          </button>
          {moreOpen && (
          <div
            id="signin-more"
            className="rounded-2xl border overflow-hidden text-left border-border bg-card"
            data-testid="container-signin-options"
          >
            {[
              {
                key: "qr",
                icon: QrCode,
                title: "Signer app",
                caption: "Scan a QR code with a signer app",
                onClick: () => setMode("qr"),
                disabled: isLoggingIn,
                order: recommended === "qr" ? 1 : 2,
                testId: "button-login-qr-select",
              },
              {
                key: "extension",
                icon: Fingerprint,
                title: "Browser extension",
                caption: noExtensionsHere ? "Not available in the home-screen app" : "Alby, nos2x, or Nostash",
                onClick: handleExtensionLogin,
                disabled: isLoggingIn || noExtensionsHere,
                order: recommended === "extension" ? 1 : 2,
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
                  className={`w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed hover:bg-foreground/[0.04] ${i < arr.length - 1 ? "border-b border-border/40" : ""}`}
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
                      <span className="text-sm font-semibold">{opt.title}</span>
                      {recommended === opt.key && !opt.disabled && (
                        <span
                          className="text-xs whitespace-nowrap font-medium text-brand"
                          data-testid={`badge-${opt.key}-recommended`}
                        >
                          {recommendedLabel}
                        </span>
                      )}
                    </span>
                    <span className={`block text-xs ${descCls}`}>{opt.caption}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
          </div>
          )}

          {/* Store QA 2.2: signup surfaces its own terms line inside
              CreateAccountFlow, but every SIGN-IN path (extension, QR,
              bunker, import) previously reached the app with no terms
              acceptance anywhere. One line here covers all of them —
              this chooser is the choke point both /login and the landing
              cockpit render. */}
          <p
            className="text-center text-xs leading-relaxed text-muted-foreground"
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
        <QRLoginFlow onBack={() => setMode(home)} />
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
                  <h3 className="text-sm font-semibold" data-testid="text-bunker-form-title">Connection link</h3>
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
                  className="font-mono text-xs bg-background/50"
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
                className="w-full text-xs font-medium bg-foreground text-background"
                data-testid="button-bunker-connect"
              >
                {isLoggingIn ? (
                  <RelayOutpostInlineLoader className="w-4 h-4 mr-2" />
                ) : (
                  <Unplug className="w-4 h-4 mr-2" />
                )}
                {isLoggingIn ? "Connecting..." : "Connect to Signer"}
              </Button>

              <div className="rounded-md p-3 space-y-2 bg-foreground/[0.03] border border-border/30">
                <p className={`text-[12px] font-semibold ${descCls}`}>
                  How to get a bunker:// URI
                </p>
                <ul className={`text-xs space-y-1 list-disc list-inside ${descCls}`}>
                  <li><a href="https://github.com/greenart7c3/Amber" target="_blank" rel="noopener noreferrer" className={linkCls} data-testid="link-amber-bunker-instructions">Amber</a> (Android): Settings &rarr; Share bunker connection</li>
                  <li>nsecBunker: Create a connection and copy the URI</li>
                  <li>Any compatible signer app</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={() => {
              setMode(home);
              setBunkerError("");
            }}
            variant="ghost"
            className="w-full text-xs font-medium text-muted-foreground"
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
            <div className="h-px w-6 sm:w-10 bg-border" />
            <Icon className="w-3 h-3 shrink-0 text-brand" />
            <span className="text-[12px] sm:text-xs sm:tracking-[0.3em] text-center font-medium text-muted-foreground">
              {text}
            </span>
            <div className="h-px w-6 sm:w-10 bg-border" />
          </div>
        );
      })()}
    </div>
  );
}
