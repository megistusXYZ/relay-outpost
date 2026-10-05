import { createPortal } from "react-dom";
import { ArrowUp } from "lucide-react";
import { formatNewPostsLabel } from "@/lib/new-posts";
import { useSurfaceActive } from "@/contexts/SurfaceActiveContext";

/**
 * X-style "new posts" affordance. While the reader is scrolled into the feed,
 * newly arrived posts are held in a buffer instead of being inserted above the
 * viewport (which would push the content they're reading). This pill floats
 * top-center under the header; tapping it merges the buffer and returns to top.
 *
 * Rendered through a portal: inside the page tree an ancestor transform
 * (PullToRefresh) would hijack `position: fixed` and scroll the pill away.
 *
 * The portal is also why it checks the surface: a kept-alive feed that isn't
 * showing (Home under a thread you opened from it — HomeKeepAlive) hides its
 * own subtree, but not a portal into <body>. Without this, Home's pill sat
 * over every page you drilled into, counting what arrived meanwhile.
 */
export function NewPostsPill({ count, onClick }: { count: number; onClick: () => void }) {
  const surfaceActive = useSurfaceActive();
  if (count <= 0 || !surfaceActive) return null;
  const label = formatNewPostsLabel(count);
  return createPortal(
    <div className="fixed inset-x-0 z-40 flex justify-center pointer-events-none top-[calc(4.75rem+env(safe-area-inset-top,0px))] md:top-[4.25rem]">
      <button
        onClick={onClick}
        className="new-posts-pill pointer-events-auto glass-feed-tabs flex h-10 items-center gap-1.5 rounded-full px-4 text-xs font-semibold text-brand cursor-pointer hover:brightness-105 active:scale-[0.97] transition-transform"
        aria-label={`${label} — tap to view`}
        data-testid="button-new-posts-pill"
      >
        <ArrowUp className="w-3.5 h-3.5" />
        {label}
      </button>
    </div>,
    document.body
  );
}
