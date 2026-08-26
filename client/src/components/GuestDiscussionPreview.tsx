// Read-only preview of a shared external-discussion link (the "💬 Discuss on
// Relay Outpost: /news?discuss=<anchor>" funnel) for a LOGGED-OUT visitor.
//
// Without this, a public discuss link dead-ended: `/news?discuss=` redirects to
// `/search?tab=media&type=news&discuss=`, which is not a guest-preview route, so
// the logged-out bounce sent the visitor to the marketing page — a broken
// promise for a link meant to be opened by anyone, anywhere (the whole point of
// the NIP-73 bridge is interoperable, shareable links). This mirrors the other
// guest previews (note/article/profile/channel): a slim standalone overlay that
// bypasses the pubkey-dependent app shell.
//
// A guest gets: the link/episode card (Open original, and — for a shared podcast
// — an inline native <audio> so they can actually listen), plus the PUBLIC
// kind-1111 discussion, read-only. Posting a reply stays gated behind sign-in
// (the footer CTA), exactly like the logged-in reader's public thread.

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Event } from "nostr-tools";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, MessageSquare, ShieldCheck } from "lucide-react";
import { guestSignIn, GuestAuthorRow } from "@/components/GuestNotePreview";
import { subscribeDiscussion, resolveSharedPodcast } from "@/lib/external-comments";
import type { SharedPodcast } from "@/lib/podcast-share";

/** Host label for the link card ("chrisroseigliveshow.libsyn.com"), or the raw
 *  string when it isn't a parseable URL. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Short relative age ("3h", "2d", "just now") for a comment timestamp. */
function relAge(createdAt: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - createdAt);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

export function GuestDiscussionPreview({ anchor }: { anchor: string }) {
  const [, navigate] = useLocation();
  const [comments, setComments] = useState<Event[]>([]);
  const [podcast, setPodcast] = useState<SharedPodcast | null>(null);
  const host = useMemo(() => hostLabel(anchor), [anchor]);

  // Public discussion (read-only): stream the kind-1111 thread for this anchor.
  // pubkey:null → the guest read union (DEFAULT_RELAYS + discover pool).
  useEffect(() => {
    if (!anchor) return;
    const unsub = subscribeDiscussion(anchor, { pubkey: null }, (events) => {
      setComments([...events].sort((a, b) => b.created_at - a.created_at));
    });
    return () => { try { unsub(); } catch { /* already closed */ } };
  }, [anchor]);

  // Recover the playable episode behind the link, if it's a shared podcast.
  useEffect(() => {
    if (!anchor) return;
    let cancelled = false;
    resolveSharedPodcast(anchor, { pubkey: null }).then((p) => {
      if (!cancelled) setPodcast(p);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [anchor]);

  const title = podcast?.title || host;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background" data-testid="guest-discussion-preview">
      <div className="flex items-center gap-3 px-3 border-b border-border/40 shrink-0 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2">
        <button onClick={() => navigate("/")} className="p-1.5 -ml-1 text-muted-foreground hover:text-foreground" aria-label="Back" data-testid="guest-discussion-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <p className="text-sm font-semibold flex-1 truncate">Discussion</p>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/[0.06] border-b border-border/30 shrink-0">
        <ShieldCheck className="w-3.5 h-3.5 text-brand/70 shrink-0" />
        <p className="text-[11px] text-muted-foreground">Guest view · sign in to comment &amp; follow</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-5">
          {/* Link / episode card */}
          <div className="flex gap-3 rounded-xl border border-border/50 p-3 mb-5">
            {podcast?.image && (
              <img src={podcast.image} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug line-clamp-2">{title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{host}</p>
              <div className="flex items-center gap-2 mt-2">
                <a
                  href={anchor}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                  data-testid="guest-discussion-open-original"
                >
                  <ExternalLink className="w-3 h-3" /> Open original
                </a>
              </div>
            </div>
          </div>

          {/* Inline player when the shared link is a podcast episode */}
          {podcast?.audioUrl && (
            <audio
              controls
              preload="none"
              src={podcast.audioUrl}
              className="w-full mb-5"
              data-testid="guest-discussion-audio"
            />
          )}

          {/* Public discussion, read-only */}
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Discussion</p>
            <span className="text-xs text-muted-foreground">
              {comments.length} {comments.length === 1 ? "comment" : "comments"} · public
            </span>
          </div>

          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No comments yet — sign in to be the first to discuss this link.
            </p>
          ) : (
            <ul className="space-y-4">
              {comments.map((c) => (
                <li key={c.id} className="flex flex-col gap-1.5" data-testid="guest-discussion-comment">
                  <div className="flex items-center gap-2">
                    <GuestAuthorRow pubkey={c.pubkey} />
                    <span className="text-[11px] text-muted-foreground">· {relAge(c.created_at)}</span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words pl-0.5">{c.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border/40 px-3 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <Button onClick={() => guestSignIn(navigate)} className="w-full min-h-[44px]" data-testid="guest-discussion-signin">
          Sign in to join the discussion
        </Button>
      </div>
    </div>
  );
}
