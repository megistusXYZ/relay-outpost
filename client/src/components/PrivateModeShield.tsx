/**
 * What the chat list shows in private mode: one branded panel and nothing of
 * the list itself. The list isn't drawn at all (no names, avatars, previews,
 * invites or counts), so nothing can be read through it, guessed from its
 * shape, or pulled from the page by a screen reader on a shared machine.
 *
 * It replaced a 6px blur over the rows. The owner's report (2026-09-12): you
 * could still make out avatars, colours, verified dots and who was who.
 */
import { Eye, ShieldCheck } from "lucide-react";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";

export function PrivateModeShield({ onShow, rearms }: {
  onShow: () => void;
  /** The standing setting is on: the chats hide again when the app goes to the background. */
  rearms: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center" data-testid="private-mode-shield">
      <div className="relative mb-6">
        {/* Decoration only: a soft brand glow behind the mark. Nothing sits behind it to show through. */}
        <div aria-hidden="true" className="absolute -inset-6 rounded-full bg-brand/15 blur-2xl" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-brand/25 bg-card shadow-[0_10px_28px_-14px_hsl(var(--brand)/0.55)] dark:bg-white/[0.03]">
          <RelayOutpostIcon className="h-8 w-8 text-brand" />
          <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-brand text-primary-foreground" aria-hidden="true">
            <ShieldCheck className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
      <h2 className="text-base font-semibold tracking-tight">Private mode is on</h2>
      <p className="mt-1.5 max-w-[17rem] text-sm leading-relaxed text-muted-foreground">
        Your chats are hidden: no names, no messages, no counts.
      </p>
      <button
        type="button"
        onClick={onShow}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        data-testid="private-mode-show"
      >
        <Eye className="h-4 w-4" /> Show chats
      </button>
      <p className="mt-3 text-[11px] text-muted-foreground/70">
        {rearms ? "They hide again when you leave the app." : "Tap the eye above to hide them again."}
      </p>
    </div>
  );
}
