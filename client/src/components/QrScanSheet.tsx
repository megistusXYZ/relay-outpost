/**
 * In-app QR scanner sheet (Chats "+" menu → Scan QR code). Camera preview via
 * html5-qrcode (dynamic import — it uses the native BarcodeDetector where the
 * browser has one, e.g. Android Chrome, and falls back to its bundled JS
 * decoder on iOS Safari/PWA). Decoded values are classified by the pure
 * classifyScannedValue: invite links / npubs navigate in-app; anything else is
 * shown behind an explicit Open/Copy confirm — scanned content is untrusted.
 *
 * Lazy-loaded (React.lazy in ChatList) so neither this component nor the
 * decoder ships in the main bundle. Camera tracks are stopped on close AND on
 * unmount so the camera light never stays on.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { Html5Qrcode } from "html5-qrcode";
import { AlertCircle, Camera, Check, Copy, ExternalLink, ScanLine } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { classifyScannedValue, type ScanTarget } from "@/lib/qr-scan";

const REGION_ID = "chat-qr-scan-region";

/**
 * Stop + clear, tolerating every scanner state. html5-qrcode's stop() THROWS
 * SYNCHRONOUSLY (not a rejected promise) when start() never succeeded — e.g.
 * camera permission denied — so a bare `s.stop().catch()` in an effect
 * teardown crashes the tree into the ErrorBoundary.
 */
function safeStop(s: Html5Qrcode) {
  try {
    s.stop().then(() => s.clear()).catch(() => {});
  } catch {
    try { s.clear(); } catch { /* nothing was running */ }
  }
}

export default function QrScanSheet({ onClose }: { onClose: () => void }) {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [unknown, setUnknown] = useState<Extract<ScanTarget, { kind: "other" }> | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const handlingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!mounted || !containerRef.current) return;

        let el = document.getElementById(REGION_ID);
        if (!el) {
          el = document.createElement("div");
          el.id = REGION_ID;
          containerRef.current.appendChild(el);
        }

        // Native BarcodeDetector where available; bundled JS decoder otherwise.
        const scanner = new Html5Qrcode(REGION_ID, { useBarCodeDetectorIfSupported: true, verbose: false });
        scannerRef.current = scanner;
        setScanning(true);

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (decodedText: string) => {
            if (handlingRef.current) return;
            handlingRef.current = true;
            const target = classifyScannedValue(decodedText, window.location.origin);
            if (target.kind === "other") {
              // Pause (keep the camera frame frozen behind the confirm).
              try { scanner.pause(true); } catch { /* already stopped */ }
              setUnknown(target);
              return;
            }
            safeStop(scanner);
            scannerRef.current = null;
            onCloseRef.current();
            setLocation(target.path);
          },
          () => {},
        );
      } catch (err: unknown) {
        if (!mounted) return;
        const e = err as { name?: string; message?: string };
        if (e?.name === "NotAllowedError") {
          setError("Camera permission was denied. Allow camera access for this site in your browser settings, then try again.");
        } else if (e?.name === "NotFoundError") {
          setError("No camera found on this device. You can paste an invite link into the chat search instead.");
        } else {
          setError(e?.message || "Couldn't start the camera.");
        }
        setScanning(false);
      }
    };

    // Let the dialog mount/animate before grabbing the camera.
    const timer = setTimeout(start, 250);

    return () => {
      mounted = false;
      clearTimeout(timer);
      // Stop ALL media tracks on unmount — the camera light must go off.
      const s = scannerRef.current;
      if (s) {
        safeStop(s);
        scannerRef.current = null;
      }
    };
  }, [setLocation]);

  const resumeScan = () => {
    setUnknown(null);
    setCopied(false);
    handlingRef.current = false;
    try { scannerRef.current?.resume(); } catch { /* not paused */ }
  };

  const openUnknown = () => {
    if (unknown?.url) window.open(unknown.url, "_blank", "noopener,noreferrer");
    onCloseRef.current();
  };

  const copyUnknown = async () => {
    if (!unknown) return;
    await navigator.clipboard?.writeText(unknown.value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-sm p-0 overflow-hidden border-border pb-[env(safe-area-inset-bottom,0px)]"
        data-testid="sheet-qr-scan"
      >
        <VisuallyHidden><DialogTitle>Scan QR code</DialogTitle></VisuallyHidden>
        <div className="p-4 space-y-3" aria-describedby="chat-qr-scan-desc">
          <VisuallyHidden><p id="chat-qr-scan-desc">Scan a group invite, profile, or link QR code</p></VisuallyHidden>
          <div className="flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-brand" />
            <span className="text-sm font-semibold">Scan QR code</span>
          </div>

          <div
            ref={containerRef}
            className="relative w-full aspect-square rounded-lg overflow-hidden bg-black/90"
            data-testid="container-chat-qr-scan"
          >
            {!scanning && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <Camera className="w-8 h-8 text-white/30 animate-pulse" />
                <span className="text-xs text-white/40">Starting camera…</span>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20" data-testid="text-qr-scan-error">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {!error && !unknown && (
            <p className="text-xs text-muted-foreground/70 text-center">
              Point at a group invite, a profile QR, or any code someone shared.
            </p>
          )}

          {unknown && (
            <div className="space-y-2" data-testid="container-qr-scan-confirm">
              <p className="text-xs font-medium text-muted-foreground">This code isn't an invite or a profile:</p>
              <p className="text-[11px] font-mono break-all max-h-24 overflow-y-auto rounded-md bg-muted/30 border border-border/30 p-2">
                {unknown.value}
              </p>
              <div className="flex gap-2">
                {unknown.url ? (
                  <Button className="flex-1 min-h-11 gap-1.5" onClick={openUnknown} data-testid="button-qr-open">
                    <ExternalLink className="w-3.5 h-3.5" /> Open link
                  </Button>
                ) : (
                  <Button className="flex-1 min-h-11 gap-1.5" onClick={copyUnknown} data-testid="button-qr-copy">
                    {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy text</>}
                  </Button>
                )}
                <Button variant="outline" className="flex-1 min-h-11" onClick={resumeScan} data-testid="button-qr-rescan">
                  Scan again
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
