import { useState } from "react";
import { Link } from "wouter";
import { MessageSquarePlus, BookOpen, FileText, ShieldCheck } from "lucide-react";
import { WhatsNewIcon } from "@/components/icons/WhatsNewIcon";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import { useNostrAuth } from "@/contexts/NostrAuthContext";

/**
 * A small, on-brand "Public Beta" stamp that lives on the landing hero and in
 * the app sidebar. Purely informational (never a gate) — clicking it opens a
 * friendly brief that sets expectations, links to the FAQ / Terms / Privacy,
 * and offers a feedback path. Distinct from the closed-beta code gate in
 * GalaxyWarpOverlay (BETA_GATE_ENABLED).
 */
export function PublicBetaBadge({
  variant = "landing",
  className = "",
  onNavigate,
}: {
  variant?: "landing" | "sidebar" | "landing-stamp";
  className?: string;
  /** Called when a dialog link navigates — lets the host (e.g. sidebar) close itself too. */
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Landing: the stamp art itself as a small, clickable corner badge.
  if (variant === "landing-stamp") {
    return (
      <>
        <button
          type="button"
          data-no-navigate
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
          className={`group/beta block cursor-pointer transition-transform duration-300 hover:scale-[1.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${className}`}
          aria-label="Public beta — what this means"
          data-testid="badge-public-beta-stamp"
        >
          <img
            src="/images/landing/public-beta-stamp.webp"
            srcSet="/images/landing/public-beta-stamp-sm.webp 220w, /images/landing/public-beta-stamp.webp 360w"
            sizes="110px"
            alt="Public Beta"
            draggable={false}
            className="w-full select-none opacity-[0.6] drop-shadow-[0_2px_12px_rgba(167,139,250,0.22)] transition-opacity duration-300 group-hover/beta:opacity-90"
          />
        </button>
        <PublicBetaDialog open={open} onOpenChange={setOpen} onNavigate={onNavigate} />
      </>
    );
  }

  const base =
    "inline-flex items-center gap-1.5 rounded-full border font-brand uppercase leading-none transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const tone =
    variant === "landing"
      ? "border-brand/30 bg-brand/[0.1] px-3 py-1.5 text-[10px] tracking-[0.22em] text-brand backdrop-blur-sm hover:border-brand/50 hover:bg-brand/[0.16] -rotate-[1.5deg]"
      : "border-primary/30 bg-primary/10 px-2 py-0.5 text-[9px] tracking-[0.18em] text-primary dark:text-brand hover:bg-primary/20";

  return (
    <>
      <button
        type="button"
        data-no-navigate
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className={`${base} ${tone} ${className}`}
        aria-label="Public beta — what this means"
        data-testid="badge-public-beta"
      >
        <span className={`rounded-full bg-brand/90 ${variant === "landing" ? "h-1.5 w-1.5" : "h-1 w-1"} animate-pulse`} aria-hidden />
        Public Beta
      </button>
      <PublicBetaDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function PublicBetaDialog({ open, onOpenChange, onNavigate }: { open: boolean; onOpenChange: (v: boolean) => void; onNavigate?: () => void }) {
  const { pubkey } = useNostrAuth();

  // Close the dialog AND let the host (sidebar) close itself, so a navigation link
  // doesn't leave the side menu covering the page the user just opened.
  const close = () => { onOpenChange(false); onNavigate?.(); };

  const openFeedback = () => {
    close();
    // Opens the existing FeedbackDrawer (mounted in App.tsx).
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("relay-outpost:open-feedback", { detail: { initialType: "idea" } }));
    }, 80);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] gap-5 overflow-hidden border-brand/25 dark:border-brand/30 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 font-brand">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <RelayOutpostIcon className="h-4 w-4" />
            </span>
            Welcome to the public beta
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            Relay Outpost is live and open to everyone — and we're actively building and
            shipping updates. You're early, so you might hit a rough edge or something that
            changes week to week. That's the fun part.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm leading-relaxed text-muted-foreground">
          It's a beta, so use it at your own pace — and back up your keys, because they're
          yours and we can't recover them. Your account lives on the open network, not our
          servers. By using Relay Outpost you agree to our{" "}
          <Link href="/terms" className="text-brand hover:underline" onClick={close}>Terms</Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-brand hover:underline" onClick={close}>Privacy Policy</Link>.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Link href="/help" onClick={close} className="flex items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/[0.12]" data-testid="link-beta-help">
            <BookOpen className="h-3.5 w-3.5 text-brand" /> FAQ &amp; guides
          </Link>
          <Link href="/terms" onClick={close} className="flex items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/[0.12]" data-testid="link-beta-terms">
            <FileText className="h-3.5 w-3.5 text-brand" /> Terms
          </Link>
          <Link href="/privacy" onClick={close} className="flex items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/[0.12]" data-testid="link-beta-privacy">
            <ShieldCheck className="h-3.5 w-3.5 text-brand" /> Privacy
          </Link>
        </div>

        {pubkey && (
          <Link href="/whats-new" onClick={close} className="flex items-center justify-center gap-1.5 rounded-lg border border-brand/25 bg-brand/[0.08] px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/[0.16]" data-testid="link-beta-whats-new">
            <WhatsNewIcon className="h-3.5 w-3.5" /> Recent updates
          </Link>
        )}

        {pubkey ? (
          <Button onClick={openFeedback} className="min-h-11 w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90" data-testid="button-beta-feedback">
            <MessageSquarePlus className="h-4 w-4" /> Found a bug or have an idea? Tell us
          </Button>
        ) : (
          <p className="text-center text-xs text-muted-foreground/70">
            Found a bug or have an idea? Sign in and use <span className="text-foreground/80">Send feedback</span> anytime.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
