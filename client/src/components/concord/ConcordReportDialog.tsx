/**
 * Report a message to the group's moderators (concord-reports). Only they see
 * it, never the person reported; they do see who sent it.
 */
import { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { useToast } from "@/hooks/use-toast";
import { reportRecipients, type ReportReason } from "@/lib/concord/concord-reports";
import { sendGroupReport } from "@/lib/concord/concord-report-send";
import type { StoredCommunity } from "@/lib/concord/concord-keys";
import type { Member } from "@/lib/concord/concord-events";
import { REASON_LABEL } from "./ConcordReports";
import { useConcordProfile } from "./ConcordIdentity";

const REASONS: ReportReason[] = ["spam", "profanity", "nudity", "illegal", "impersonation", "other"];

export function ConcordReportDialog({ open, onOpenChange, community, roster, channelId, message }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  community: StoredCommunity;
  roster: Member[];
  channelId: string;
  message: { id: string; pubkey: string; content: string } | null;
}) {
  return (
    <Dialog open={open && !!message} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm max-h-[85dvh] overflow-y-auto" data-testid="concord-report-dialog">
        {message && <ReportForm community={community} roster={roster} channelId={channelId} message={message} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ReportForm({ community, roster, channelId, message, onDone }: {
  community: StoredCommunity;
  roster: Member[];
  channelId: string;
  message: { id: string; pubkey: string; content: string };
  onDone: () => void;
}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const author = useConcordProfile(message.pubkey).name;
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const signer = getGlobalSigner();
    if (!reason || !pubkey || !signer || sending) return;
    const to = reportRecipients(roster, community.owner, pubkey, message.pubkey);
    if (to.length === 0) {
      toast({ title: "No one to send it to", description: "This group has no other moderators to review it.", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const sent = await sendGroupReport(signer, pubkey, community, to,
        { channelId, msgId: message.id, author: message.pubkey, reason, note, snippet: message.content },
        (e, r) => publishEvent(e, r));
      if (sent > 0) {
        toast({ title: "Report sent", description: "The group's moderators will see it." });
        onDone();
      } else {
        toast({ title: "Couldn't send the report", description: "Your sign-in couldn't encrypt it. Try again.", variant: "destructive" });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base"><Flag className="w-4 h-4 text-amber-500" /> Report this message</DialogTitle>
        <DialogDescription className="text-xs">
          Only the group's moderators see reports, not {author}. They'll see that it came from you.
        </DialogDescription>
      </DialogHeader>
      <blockquote className="text-xs text-muted-foreground border-l-2 border-border/50 pl-2 line-clamp-3 break-words [overflow-wrap:anywhere]">{message.content}</blockquote>
      <div className="space-y-1" role="radiogroup" aria-label="What's wrong with it">
        {REASONS.map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={`w-full text-left px-3 min-h-11 md:min-h-9 rounded-lg border text-sm transition-colors ${reason === r ? "border-primary/60 bg-primary/10 text-foreground" : "border-border/30 text-foreground/80 hover:bg-muted/30"}`}
            data-testid={`report-reason-${r}`}
          >
            {REASON_LABEL[r]}
          </button>
        ))}
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Anything the moderators should know (optional)"
        className="resize-none text-sm"
        data-testid="input-report-note"
      />
      <Button onClick={send} disabled={!reason || sending} className="w-full h-11 md:h-9 gap-1.5" data-testid="button-send-report">
        {sending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</> : "Send to moderators"}
      </Button>
    </>
  );
}
