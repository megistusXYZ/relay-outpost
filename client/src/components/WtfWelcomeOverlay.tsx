import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { X, KeyRound, Radio, ArrowRight } from "lucide-react";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";

const STORAGE_KEY = "relay-outpost-wtf-welcomed";

interface Props {
  open: boolean;
  onDismiss: () => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function WtfWelcomeOverlay({ open, onDismiss }: Props) {
  const [, navigate] = useLocation();
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const reducedMotion = useRef(prefersReducedMotion());

  // Mount / animate in
  useEffect(() => {
    if (open) {
      setMounted(true);
      previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    setEntered(false);
    const t = window.setTimeout(() => {
      setMounted(false);
    }, reducedMotion.current ? 0 : 180);
    return () => window.clearTimeout(t);
  }, [open]);

  // Restore focus AFTER unmount + inert teardown finishes.
  useEffect(() => {
    if (mounted) return;
    const prev = previouslyFocusedRef.current;
    if (!prev || typeof prev.focus !== "function") return;
    const id = window.setTimeout(() => {
      try { prev.focus({ preventScroll: true }); } catch { prev.focus(); }
    }, 0);
    return () => window.clearTimeout(id);
  }, [mounted]);

  // Body scroll lock + scrollbar compensation + inert on the app root
  useEffect(() => {
    if (!mounted) return;
    type InertElement = HTMLElement & { inert: boolean };
    const body = document.body;
    const html = document.documentElement;
    const scrollbarWidth = window.innerWidth - html.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    const root = document.getElementById("root") as InertElement | null;
    const wasInert = root ? root.inert === true : false;
    if (root) root.inert = true;

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
      if (root) root.inert = wasInert;
    };
  }, [mounted]);

  // Focus the primary CTA on open
  useEffect(() => {
    if (!entered) return;
    const id = window.setTimeout(() => primaryBtnRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, [entered]);

  // ESC + focus trap
  useEffect(() => {
    if (!mounted) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [mounted, onDismiss]);

  const handleBackToSignIn = useCallback(() => {
    onDismiss();
    navigate("/");
  }, [onDismiss, navigate]);

  if (!mounted) return null;

  const reduced = reducedMotion.current;
  const enterCls = entered
    ? "opacity-100 scale-100"
    : reduced
      ? "opacity-0"
      : "opacity-0 scale-95";

  const backdropCls = entered ? "opacity-100" : "opacity-0";

  const node = (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 min-[480px]:p-6"
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Dismiss welcome"
        tabIndex={-1}
        onClick={onDismiss}
        className={`absolute inset-0 bg-black/70 dark:bg-black/70 ${reduced ? "" : "transition-opacity duration-200 ease-out"} ${backdropCls}`}
        style={{ backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wtf-welcome-headline"
        className={`relative w-full max-w-[520px] max-h-[calc(100vh-1.5rem)] supports-[height:100dvh]:max-h-[calc(100dvh-1.5rem)] min-[480px]:max-h-[88vh] min-[480px]:supports-[height:100dvh]:max-h-[88vh] flex flex-col
          rounded-2xl
          border border-white/10 dark:border-white/10
          bg-white/95 dark:bg-black/70
          shadow-2xl shadow-black/40
          ${reduced ? "" : "transition-all duration-200 ease-out"}
          ${enterCls}`}
        style={{
          backdropFilter: "blur(24px) saturate(140%)",
          WebkitBackdropFilter: "blur(24px) saturate(140%)",
        }}
      >
        {/* Subtle starfield accents */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full opacity-40 dark:opacity-60"
            style={{ background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)" }} />
          <div className="absolute -bottom-16 -left-10 w-56 h-56 rounded-full opacity-30 dark:opacity-50"
            style={{ background: "radial-gradient(circle, rgba(99,102,241,0.14) 0%, transparent 70%)" }} />
          <span className="absolute top-[18%] left-[12%] w-[2px] h-[2px] rounded-full bg-brand/60 dark:bg-brand/70" />
          <span className="absolute top-[34%] right-[18%] w-[2px] h-[2px] rounded-full bg-brand/40 dark:bg-brand/50" />
          <span className="absolute bottom-[24%] left-[28%] w-[1.5px] h-[1.5px] rounded-full bg-brand/40" />
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close welcome"
          data-testid="button-wtf-welcome-close"
          className="absolute top-2 right-2 min-[480px]:top-3 min-[480px]:right-3 z-10 inline-flex items-center justify-center w-11 h-11 rounded-full text-foreground/60 hover:text-foreground dark:text-white/60 dark:hover:text-white hover:bg-foreground/5 dark:hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Scrollable content */}
        <div className="relative flex-1 overflow-y-auto px-5 min-[480px]:px-7 pt-7 pb-2">
          {/* Identity row */}
          <div className="flex items-center justify-center gap-2 mb-5">
            <span
              className="font-brand uppercase tracking-[0.18em] text-[13px] min-[480px]:text-sm font-bold text-foreground dark:text-white"
            >
              Relay
            </span>
            <RelayOutpostIcon className="w-3.5 h-3.5 text-brand" />
            <span
              className="font-brand uppercase tracking-[0.18em] text-[13px] min-[480px]:text-sm font-bold text-foreground dark:text-white"
            >
              Outpost
            </span>
          </div>

          {/* WTF glyph + headline */}
          <div className="flex flex-col items-center text-center mb-4">
            <div className="relative -rotate-[8deg] mb-3">
              <WtfAlienIcon className="w-10 h-10 text-brand drop-shadow-[0_0_12px_rgba(139,92,246,0.45)]" />
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-brand shadow-[0_0_6px_rgba(139,92,246,0.6)]" />
            </div>
            <h2
              id="wtf-welcome-headline"
              className="font-display font-semibold text-[22px] min-[480px]:text-[26px] leading-tight tracking-tight text-foreground dark:text-white"
              data-testid="text-wtf-welcome-headline"
            >
              Welcome, traveler<span className="text-brand drop-shadow-[0_0_8px_rgba(139,92,246,0.6)]">.</span>
            </h2>
            <p className="mt-1.5 text-[14px] leading-snug text-muted-foreground dark:text-white/60 max-w-[40ch]">
              You've found the field manual. Learn more about the next phase of the internet.
            </p>
          </div>

          {/* Reassurance rows */}
          <ul className="space-y-2.5 mb-5">
            <li className="flex items-start gap-3 rounded-xl border border-border/50 dark:border-white/10 bg-foreground/[0.02] dark:bg-white/[0.03] px-3 py-2.5">
              <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border/60 dark:border-white/10 bg-background/60 dark:bg-white/[0.04] text-brand">
                <RelayOutpostIcon className="w-4 h-4" />
              </span>
              <p className="text-[13.5px] leading-snug text-foreground/80 dark:text-white/80 pt-1">
                One account, every app. Your identity is yours and works everywhere — like email, but for everything you say.
              </p>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-border/50 dark:border-white/10 bg-foreground/[0.02] dark:bg-white/[0.03] px-3 py-2.5">
              <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border/60 dark:border-white/10 bg-background/60 dark:bg-white/[0.04] text-brand">
                <KeyRound className="w-4 h-4" />
              </span>
              <p className="text-[13.5px] leading-snug text-foreground/80 dark:text-white/80 pt-1">
                No password, no email. Your account lives on your device — only yours.
              </p>
            </li>
            <li className="flex items-start gap-3 rounded-xl border border-border/50 dark:border-white/10 bg-foreground/[0.02] dark:bg-white/[0.03] px-3 py-2.5">
              <span className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border/60 dark:border-white/10 bg-background/60 dark:bg-white/[0.04] text-brand">
                <Radio className="w-4 h-4" />
              </span>
              <p className="text-[13.5px] leading-snug text-foreground/80 dark:text-white/80 pt-1">
                An Outpost is your home base for everything you say — public feeds and private rooms in one place. Join one or launch your own, run on your terms — your identity moves with you.
              </p>
            </li>
          </ul>
        </div>

        {/* Sticky CTA region. shrink-0: the modal is a height-capped flex
            column, and without it a short viewport squeezes THIS row —
            h-11 buttons rendered as thin compressed strips (owner
            screenshot). The scrollable list above absorbs all the squeeze. */}
        <div className="relative shrink-0 px-5 min-[480px]:px-7 pb-5 min-[480px]:pb-6 pt-3">
          {/* Gradient fade above CTAs (mobile sheet feel) */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-6 left-0 right-0 h-6 bg-gradient-to-t from-white/95 dark:from-black/70 to-transparent"
          />
          <div className="flex flex-col-reverse min-[480px]:flex-row gap-2 min-[480px]:gap-3">
            <button
              type="button"
              onClick={handleBackToSignIn}
              data-testid="button-wtf-welcome-back-to-signin"
              className="flex-1 inline-flex items-center justify-center gap-2 min-h-11 shrink-0 rounded-full border border-border/60 dark:border-white/15 bg-transparent text-foreground/80 dark:text-white/80 hover:bg-foreground/5 dark:hover:bg-white/10 font-brand uppercase tracking-[0.12em] text-[11px] font-bold transition-colors"
            >
              Take me back to sign in
            </button>
            <button
              ref={primaryBtnRef}
              type="button"
              onClick={onDismiss}
              data-testid="button-wtf-welcome-explore"
              className="flex-1 inline-flex items-center justify-center gap-2 min-h-11 shrink-0 rounded-full bg-brand hover:bg-brand text-white font-brand uppercase tracking-[0.12em] text-[11px] font-bold shadow-[0_8px_24px_-8px_rgba(139,92,246,0.6)] transition-colors"
            >
              Explore the FAQ <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

export function shouldShowWtfWelcome(pubkey: string | null): boolean {
  if (pubkey) return false;
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export function markWtfWelcomeSeen() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {}
}
