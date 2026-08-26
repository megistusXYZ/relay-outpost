// Private reply composer. Replies privately to a PUBLIC post by sending a NIP-17
// gift-wrapped DM (kind-14 rumor) that QUOTES the post — it lands in the author's
// Chats and in the sender's own Chats thread with that person, and interoperates
// with other NIP-17 clients (Nostur/Wisp) that read the `q` quote tag.
//
// Delivery reuses the exact DM path (sendDM → createGiftWrap + createGiftWrapForSelf
// → auth-aware publishWithFallback to the author's DM relays + the sender's inbox).
// It NEVER auto-sends — delivery only happens on the explicit Send button.
import { useState, useMemo } from "react";
import type { Event } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { use$ } from "applesauce-react/hooks";
import { Lock, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { eventStore, getEventRelays } from "@/lib/nostr";
import { getDisplayName, KIND_METADATA, getRelayHintForEvent, getAvatarUrl } from "@/lib/nostr-helpers";
import { sendDM } from "@/lib/dm";
import { buildPrivateReplyExtraTags } from "@/lib/private-reply";
import * as dmCache from "@/lib/dm-cache";

interface PrivateReplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event;
}

export function PrivateReplyDialog({ open, onOpenChange, event }: PrivateReplyDialogProps) {
  const { signer, pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  const authorProfile = use$(() => eventStore.replaceable(KIND_METADATA, event.pubkey), [event.pubkey]);
  const authorName = useMemo(() => {
    const name = authorProfile ? getDisplayName(authorProfile, "") : "";
    if (name) return name;
    try {
      const npub = nip19.npubEncode(event.pubkey);
      return `${npub.slice(0, 9)}…${npub.slice(-4)}`;
    } catch {
      return event.pubkey.slice(0, 8) + "…";
    }
  }, [authorProfile, event.pubkey]);

  const snippet = useMemo(() => {
    const t = event.content.trim().replace(/\s+/g, " ");
    return t.length > 220 ? t.slice(0, 220) + "…" : t;
  }, [event.content]);

  const handleSend = async () => {
    const text = content.trim();
    if (!text || sending) return;
    if (!signer || !pubkey) {
      toast({ title: "Sign in required", description: "Sign in to reply privately.", variant: "destructive" });
      return;
    }
    if (!signer.nip44) {
      toast({
        title: "Encryption unavailable",
        description: "Your signer doesn't support NIP-44 encryption, required for private replies.",
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    try {
      const relayHint = getRelayHintForEvent(event.id, getEventRelays);
      const extraTags = buildPrivateReplyExtraTags(event.id, event.pubkey, relayHint || undefined);
      const res = await sendDM({
        signer,
        senderPubkey: pubkey,
        recipientPubkey: event.pubkey,
        content: text,
        extraTags,
      });
      if (!res.success) {
        toast({ title: "Couldn't send", description: res.error || "Please try again.", variant: "destructive" });
        setSending(false);
        return;
      }
      // The Messages page does this pair itself on a normal send, but it isn't
      // mounted here — without these writes the conversation list keeps its
      // old preview/order and the private reply never surfaces in Chats until
      // the self-copy wrap happens to re-decrypt. Same rumor id as the wraps,
      // so the later self-copy decrypt dedups instead of duplicating.
      const now = Math.floor(Date.now() / 1000);
      const msgId = res.rumorId || `private-reply-${event.id}-${now}`;
      dmCache.putMessage(pubkey, event.pubkey, {
        id: msgId, ownerPubkey: pubkey, peerPubkey: event.pubkey,
        content: text, from: pubkey, timestamp: now, encryption: "nip17",
        quotedNoteId: event.id,
      }).catch(() => {});
      dmCache.putConversation(pubkey, {
        ownerPubkey: pubkey, peerPubkey: event.pubkey,
        lastMessage: text, lastTimestamp: now,
      }).catch(() => {});
      try { window.dispatchEvent(new CustomEvent("dm-cache-updated", { detail: { peers: [event.pubkey] } })); } catch {}
      toast({ title: "Private reply sent", description: `It's in your Chats with ${authorName}.` });
      setContent("");
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Couldn't send",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!sending) onOpenChange(o); }}>
      <DialogContent className="glass-dialog max-w-[calc(100vw-1.5rem)] sm:max-w-lg overflow-x-hidden" data-testid="dialog-private-reply">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Lock className="w-4 h-4 text-brand/80" />
            Reply privately
          </DialogTitle>
          <DialogDescription>
            Sent as an encrypted direct message that quotes this post. It appears in your Chats with {authorName}
            {" "}and interoperates with other Nostr messengers.
          </DialogDescription>
        </DialogHeader>

        {/* Quoted post preview */}
        <div className="rounded-lg border border-border/40 bg-background/30 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Avatar className="w-5 h-5">
              <AvatarImage src={getAvatarUrl(authorProfile)} alt={authorName} />
              <AvatarFallback className="text-[8px] bg-muted text-muted-foreground">
                {authorName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium text-foreground/80 truncate">{authorName}</span>
          </div>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap [overflow-wrap:anywhere] line-clamp-4">
            {snippet || "(no text)"}
          </p>
        </div>

        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={`Reply privately to ${authorName}…`}
          className="min-h-[100px] resize-none"
          autoFocus
          data-testid="input-private-reply"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            <Lock className="w-3 h-3" />
            End-to-end encrypted
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={sending}
              data-testid="button-private-reply-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={!content.trim() || sending}
              className="min-w-[84px]"
              data-testid="button-private-reply-send"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
