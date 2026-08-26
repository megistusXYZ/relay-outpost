// Phase 3 (articles): read-only preview of a shared long-form article
// (/articles/<naddr>, kind 30023) for a logged-out visitor. Unlike short notes,
// an article IS its formatting, so we render through the SHARED ArticleMarkdown
// component — the exact pipeline ArticleDetail uses (remark-gfm + nostr-embed
// plugin, rehype-raw + article sanitize schema + style scrubbing, video/iframe
// overrides). It's fully signer-free (nostr: refs render EmbeddedNote /
// MentionProfileLink, which only read the event + author profile), so guests get
// identical fidelity. Engagement (comments/reactions) stays gated per the guest
// policy — the sign-in bar covers it.

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import type { Event } from "nostr-tools";
import { ArticleMarkdown } from "@/components/ArticleMarkdown";
import { pool } from "@/lib/nostr";
import { decodeNaddr, parseArticle, KIND_LONG_FORM, type ArticleData } from "@/lib/nip23";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { GUEST_READ_RELAYS, guestSignIn, GuestAuthorRow } from "@/components/GuestNotePreview";
import { canReachAny } from "@/lib/relay-reach";
import { guestFetchOutcome, type GuestFetchOutcome } from "@/lib/guest-fetch-outcome";

export function GuestArticlePreview({ naddr }: { naddr: string }) {
  const [, navigate] = useLocation();
  const decoded = useMemo(() => decodeNaddr(naddr), [naddr]);
  const [article, setArticle] = useState<ArticleData | null>(null);
  const [outcome, setOutcome] = useState<GuestFetchOutcome>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setArticle(null);
    setOutcome("loading");
    if (!decoded || decoded.kind !== KIND_LONG_FORM) { setOutcome("not-found"); return; }
    let cancelled = false;
    const relays = [...GUEST_READ_RELAYS, ...(decoded.relays || [])];
    // Same three-outcome endgame as GuestNotePreview (guest-fetch-outcome.ts):
    // EOSE is not an answer; "not found" needs proof somebody was reached.
    const signals = { found: false, eosed: false, reached: null as boolean | null, timedOut: false };
    // Terminal-state ladder, outbox edition: an naddr CARRIES the author, so a
    // miss on the guest relays can follow NIP-65 to where the author actually
    // publishes — their kind-10002 from the guest set (purplepag.es indexes
    // these), then the article from their write relays. Only then is either
    // failure state claimed.
    let outboxTried = false;
    const adopt = (e: Event) => {
      signals.found = true;
      setArticle((prev) => (prev && prev.event.created_at >= e.created_at ? prev : parseArticle(e)));
      setOutcome("found");
    };
    const classify = () => {
      if (cancelled || signals.found) return;
      const o = guestFetchOutcome(signals);
      if (o !== "not-found" && o !== "unreachable") { setOutcome(o); return; }
      if (outboxTried) { setOutcome(o); return; }
      outboxTried = true;
      (async () => {
        const lists = await pool.querySync(GUEST_READ_RELAYS, { kinds: [10002], authors: [decoded.pubkey], limit: 1 });
        const writes = (lists[0]?.tags ?? [])
          .filter((t: string[]) => t[0] === "r" && t[1] && (!t[2] || t[2] === "write"))
          .map((t: string[]) => t[1])
          .slice(0, 6);
        if (writes.length === 0) return null;
        const evs = await pool.querySync(writes, { kinds: [KIND_LONG_FORM], authors: [decoded.pubkey], "#d": [decoded.identifier], limit: 1 });
        return evs.sort((a: Event, b: Event) => b.created_at - a.created_at)[0] ?? null;
      })()
        .then((hit) => {
          if (cancelled || signals.found) return;
          if (hit) adopt(hit);
          else setOutcome(o);
        })
        .catch(() => { if (!cancelled && !signals.found) setOutcome(o); });
    };
    canReachAny(relays).then((r) => { signals.reached = r; classify(); }).catch(() => { signals.reached = false; classify(); });
    const sub = pool.subscribeMany(
      relays,
      { kinds: [KIND_LONG_FORM], authors: [decoded.pubkey], "#d": [decoded.identifier], limit: 1 },
      {
        onevent(e: Event) {
          if (cancelled) return;
          signals.found = true;
          // Parameterized-replaceable: keep the newest revision.
          setArticle((prev) => (prev && prev.event.created_at >= e.created_at ? prev : parseArticle(e)));
          setOutcome("found");
        },
        oneose() { signals.eosed = true; classify(); },
      }
    );
    const t = setTimeout(() => { signals.timedOut = true; classify(); }, 8_000);
    return () => { cancelled = true; clearTimeout(t); try { sub.close(); } catch {} };
  }, [decoded, attempt]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background" data-testid="guest-article-preview">
      <div className="flex items-center gap-3 px-3 border-b border-border/40 shrink-0 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2">
        <button onClick={() => navigate("/")} className="p-1.5 -ml-1 text-muted-foreground hover:text-foreground" aria-label="Back" data-testid="guest-article-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <p className="text-sm font-semibold flex-1 truncate">Article</p>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/[0.06] border-b border-border/30 shrink-0">
        <ShieldCheck className="w-3.5 h-3.5 text-brand/70 shrink-0" />
        <p className="text-[11px] text-muted-foreground">Guest view · sign in to react, comment &amp; follow</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {outcome === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> <span className="text-sm">Loading article…</span>
          </div>
        )}
        {outcome === "not-found" && (
          <div className="text-center py-16 px-6 text-sm text-muted-foreground" data-testid="guest-article-notfound">
            The relays we can reach as a guest don't have this article.
          </div>
        )}
        {outcome === "unreachable" && (
          <div className="text-center py-16 px-6 space-y-3" data-testid="guest-article-unreachable">
            <p className="text-sm text-muted-foreground">Couldn't reach the network to load this article.</p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((a) => a + 1)} data-testid="guest-article-retry">
              Try again
            </Button>
          </div>
        )}
        {article && (
          <div className="max-w-2xl mx-auto px-4 py-6">
            {article.image && <img src={article.image} alt="" className="w-full rounded-xl mb-5 max-h-72 object-cover" />}
            <h1 className="text-2xl font-bold leading-tight mb-3">{article.title || "Untitled"}</h1>
            <div className="mb-5"><GuestAuthorRow pubkey={article.event.pubkey} /></div>
            <article className="article-prose">
              <ArticleMarkdown content={article.event.content} />
            </article>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-border/40 px-3 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <Button onClick={() => guestSignIn(navigate)} className="w-full min-h-[44px]" data-testid="guest-article-signin">
          Sign in to react &amp; comment
        </Button>
      </div>
    </div>
  );
}
