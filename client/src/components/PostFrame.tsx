import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

/**
 * The shell every post in a feed sits in.
 *
 * There was no such thing before this. NostrPost rolled its own outer wrapper,
 * ArticleFeedCard rolled another, MediaInteractionBar was a third — which is
 * the actual reason a mixed feed reads as "varying quality". Not that a poll
 * looks different from a photo (it should), but that the FRAME around them
 * differs for no reason anyone chose.
 *
 * So the contract is: the chrome is identical, only the middle varies. A poll
 * still looks like a poll and an article still looks like an article; they just
 * stop each inventing their own edges, their own repost line, their own
 * sensitive-content gate.
 *
 * This PR changes nothing visually — it renders the exact tree NostrPost
 * already produced. That is the point. A refactor that looks like wasted motion
 * is what lets full-bleed media, the immersive pager and the other kinds land
 * as small diffs instead of each rewriting the wrapper again.
 *
 * See MEDIA_FEED_PLAN.md, decisions 7 and 11.
 */
export interface PostFrameProps {
  /** Drives `data-event-id`, which scroll restoration and tests both key on. */
  eventId: string;
  /* No `frame` prop yet, on purpose. Full-bleed arrives in PR 4 with the
     behaviour behind it; adding the prop now would ship a value nothing reads,
     which is how dead options accumulate. */
  /** "X reposted" attribution, above the card. */
  repostSlot?: ReactNode;
  /** Left accent marking a reply. */
  isReply?: boolean;
  /**
   * A content warning to gate behind. When present the body is blurred and
   * made inert, with a reveal button over it — never merely dimmed, because a
   * blur you can still read is not a warning.
   */
  sensitive?: { reason?: string; onReveal: () => void } | null;
  /** Below the card: inline reply composer, expanded thread. */
  footerSlot?: ReactNode;
  children: ReactNode;
}

export function PostFrame({
  eventId,
  repostSlot,
  isReply = false,
  sensitive = null,
  footerSlot,
  children,
}: PostFrameProps) {
  const blurred = !!sensitive;
  return (
    <div className="overflow-visible feed-post-item" data-event-id={eventId}>
      {repostSlot}
      <div className="relative">
        {sensitive && (
          <button
            type="button"
            onClick={sensitive.onReveal}
            aria-label={`Reveal sensitive content: ${sensitive.reason ?? "Sensitive content"}`}
            data-testid={`button-reveal-sensitive-${eventId}`}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl px-6 text-center min-h-[44px] cursor-pointer"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-brand/30 bg-brand/10 backdrop-blur-sm">
              <ShieldAlert className="h-5 w-5 text-brand" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Sensitive content</p>
              <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
                {sensitive.reason && sensitive.reason !== "Sensitive Content" ? sensitive.reason : "Tap to view"}
              </p>
            </div>
            <span className="mt-0.5 rounded-full border border-brand/25 bg-brand/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-brand">
              Tap to view
            </span>
          </button>
        )}
        <Card
          className={`overflow-visible glass-card ${isReply ? "border-l-2 border-l-primary/30 dark:border-l-violet-500/40" : ""} ${blurred ? "blur-xl pointer-events-none select-none" : ""}`}
          aria-hidden={blurred}
        >
          {children}
        </Card>
      </div>
      {footerSlot}
    </div>
  );
}
