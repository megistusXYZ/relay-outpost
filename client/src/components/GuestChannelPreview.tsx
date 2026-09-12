// Read-only landing card for a LOGGED-OUT visitor who opened a shared channel
// deep link (/outposts/<relay>?channel=<id>). Per the guest-engagement policy, a
// channel's messages ARE a multi-person conversation — so guests do NOT see them.
// We show the channel's PUBLIC metadata (name / avatar / description) and gate the
// chat itself behind sign-in. Signer-less / pubkey-less: it only fetches the group
// metadata (kind 39000) from the relay, never the chat (kind 9).

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { Event } from "nostr-tools";
import { pool } from "@/lib/nostr";
import { KIND_GROUP_METADATA, parseGroupMetadata, type GroupMetadata } from "@/lib/nip29";
import { classifyRoom } from "@/lib/room-content-filter";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Lock, MessagesSquare } from "lucide-react";

const LOAD_TIMEOUT = 6000;

export function GuestChannelPreview({ relayUrl, channelId }: { relayUrl: string; channelId: string }) {
  const [, navigate] = useLocation();
  const [meta, setMeta] = useState<GroupMetadata | null>(null);

  useEffect(() => {
    setMeta(null);
    let cancelled = false;
    // Only the public group metadata — never the chat messages (gated for guests).
    const sub = pool.subscribeMany([relayUrl], { kinds: [KIND_GROUP_METADATA], "#d": [channelId], limit: 1 }, {
      onevent(e: Event) {
        if (cancelled) return;
        const m = parseGroupMetadata(e);
        if (m) setMeta((prev) => (prev && (prev.metaUpdatedAt ?? 0) >= (m.metaUpdatedAt ?? 0) ? prev : m));
      },
      oneose() {},
    });
    const t = setTimeout(() => { try { sub.close(); } catch {} }, LOAD_TIMEOUT);
    return () => { cancelled = true; clearTimeout(t); try { sub.close(); } catch {} };
  }, [relayUrl, channelId]);

  // A guest can't opt in to explicit rooms, so a room flagged either way shows
  // nothing of itself here: no name, picture or description (lib/room-content-filter).
  const blocked = !!meta && classifyRoom(meta) !== "ok";
  const title = blocked ? "Room unavailable" : meta?.name || "Chat channel";
  const isPrivate = !!meta && (meta.isPrivate || meta.isClosed || meta.isRestricted);

  const signIn = () => {
    // Stash the deep link so signing in returns the visitor to this channel.
    try { sessionStorage.setItem("relay-outpost-post-auth-redirect", window.location.pathname + window.location.search); } catch {}
    navigate("/login");
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background" data-testid="guest-channel-preview">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 border-b border-border/40 shrink-0 pt-[calc(0.5rem+env(safe-area-inset-top,0px))] pb-2">
        <button onClick={() => navigate("/")} className="p-1.5 -ml-1 text-muted-foreground hover:text-foreground" aria-label="Back" data-testid="guest-preview-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Avatar className="w-8 h-8 shrink-0">
          {meta?.picture && !blocked && <AvatarImage src={meta.picture} alt={title} />}
          <AvatarFallback className="text-xs bg-brand/10 text-brand">{title.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{title}</p>
          <p className="text-[11px] text-muted-foreground truncate">Chat room</p>
        </div>
      </div>

      {/* Gated body — public channel info, chat behind sign-in */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center text-center px-8 gap-4">
        <Avatar className="w-20 h-20 shrink-0">
          {meta?.picture && !blocked && <AvatarImage src={meta.picture} alt={title} />}
          <AvatarFallback className="text-xl bg-brand/10 text-brand">{title.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="space-y-1.5 max-w-sm">
          <h1 className="text-lg font-bold">{title}</h1>
          {meta?.about && !blocked && <p className="text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap break-words">{meta.about}</p>}
          {blocked && <p className="text-sm text-muted-foreground" data-testid="guest-preview-unavailable">This room isn't shown on Relay Outpost.</p>}
        </div>
        {!blocked && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2">
          {isPrivate ? <Lock className="w-4 h-4 shrink-0" /> : <MessagesSquare className="w-4 h-4 shrink-0" />}
          <span>{isPrivate ? "Private channel — sign in and join to see the chat" : "Sign in to see the conversation and join in"}</span>
        </div>
        )}
      </div>

      {/* Sign-in bar — or, for a room that isn't shown, the way home */}
      <div className="shrink-0 border-t border-border/40 px-3 pt-2.5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        {blocked ? (
          <Button variant="outline" onClick={() => navigate("/")} className="w-full min-h-[44px]" data-testid="guest-preview-home">
            Back to Relay Outpost
          </Button>
        ) : (
        <Button onClick={signIn} className="w-full min-h-[44px]" data-testid="guest-preview-signin">
          Sign in to see &amp; join the chat
        </Button>
        )}
      </div>
    </div>
  );
}
