import { useState } from "react";
import type { Event } from "nostr-tools";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { publishEvent, DEFAULT_RELAYS } from "@/lib/nostr";
import { getOutpostRelays } from "@/lib/outpost-relays";
import { clientTags, KIND_METADATA } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { addReportedItem } from "@/lib/spam-filter";
import { Flag, AlertTriangle, ShieldAlert, Ban, Skull, HelpCircle } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const REPORT_REASONS = [
  { value: "spam", label: "Spam", icon: Ban, description: "Unsolicited or repeated content" },
  { value: "impersonation", label: "Impersonation", icon: ShieldAlert, description: "Pretending to be someone else" },
  { value: "nudity", label: "Inappropriate Content", icon: AlertTriangle, description: "Adult or explicit material" },
  { value: "illegal", label: "Illegal Activity", icon: Skull, description: "Content that may violate laws" },
  { value: "other", label: "Other", icon: HelpCircle, description: "Doesn't fit other categories" },
] as const;

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event;
}

export function ReportDialog({ open, onOpenChange, event }: ReportDialogProps) {
  const { signer, pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [selectedReason, setSelectedReason] = useState<string>("");
  const [additionalNote, setAdditionalNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) {
      toast({ title: "Select a reason", description: "Choose why you're reporting this content.", variant: "destructive" });
      return;
    }

    if (!signer || !pubkey) {
      toast({ title: "Sign in required", description: "You need to be signed in to report content.", variant: "destructive" });
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      // NIP-56 shape: the report type is the THIRD element — ["e", id, type],
      // ["p", pubkey, type]. This used to emit ["e", id, "", type], borrowing
      // the kind-1 reply layout where index 2 is a relay hint. That put the type
      // in a slot no NIP-56 reader looks at, so every report we wrote read as
      // typeless — to other clients, and to our own severity logic, which is why
      // a `nudity` report showed no "serious" marker in the moderation queue.
      // NIP-56 shape depends on WHAT is being reported. A report about a NOTE
      // carries `e` + `p`; a report about a PERSON carries `p` alone.
      //
      // This emitted `e` unconditionally, and Profile.tsx passes the subject's
      // kind-0 (or a synthetic one with an empty id) — so reporting a person
      // produced an `e` tag pointing at a profile event. The moderation queue
      // then took it for a message report, tried to resolve it, failed, and
      // rendered "Message could not be loaded from this relay" about something
      // that was never a message. Dismiss there is state-only, so it came back
      // on the next sweep and kept inflating the badge.
      //
      // Omitting `e` routes these down the about-person path instead — the one
      // verified live in #597.
      const isPersonReport = !event.id || event.kind === KIND_METADATA;
      const tags: string[][] = [
        ...(isPersonReport ? [] : [["e", event.id, selectedReason]]),
        ["p", event.pubkey, selectedReason],
        ["L", "MOD"],
        ["l", selectedReason, "MOD"],
        ...clientTags(),
      ];

      const content = additionalNote.trim() || `Report: ${selectedReason}`;

      const eventTemplate = {
        kind: 1984,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content,
      };

      const signedEvent = await signWithTimeout(signer, eventTemplate);
      // DEFAULT_RELAYS **and** the relays this person is actually a member of.
      //
      // Publishing to the public defaults alone made this writer and its own
      // reader structurally unable to meet: `use-reports-queue.ts` walks
      // `getOutpostRelays()` and asks each one for kind-1984 over that group's
      // roster. Those two relay sets have no necessary overlap, so a report
      // filed here could essentially never appear in the moderation queue this
      // app ships — both halves built, tested, and blind to each other.
      //
      // The moderator who can act on a report is the one running the room the
      // reported person is in, and this is the only set of such relays the
      // dialog can know without a lookup. It is also, exactly, the set the
      // queue reads.
      //
      // Worth being clear-eyed: a NIP-56 report is a public accusation either
      // way, and this widens who sees it. That is the point — a report nobody
      // with authority can see is not privacy, it is a dead letter.
      const outposts = getOutpostRelays().map((r) => r.url);
      const targets = Array.from(new Set([...DEFAULT_RELAYS, ...outposts]));
      // KEEP THE VERDICT. `publishEvent` resolves `false` when no relay accepted
      // — it does not throw — so awaiting it bare made the success toast below
      // unconditional. Filing a report is the one action in this app where
      // being wrongly told it worked has a cost: the reporter stops looking,
      // and nobody is coming.
      //
      // This line was rewritten in the same PR whose message read "A FAILED
      // SEND SAYS SO" about the identical bug in ConcordChat. Fixing a class of
      // defect in one file is not the same as fixing the class.
      const landed = await publishEvent(signedEvent, targets);
      if (!landed) {
        toast({
          title: "Report not sent",
          description: "No relay accepted it. Nothing was filed — please try again.",
          variant: "destructive",
        });
        return;
      }

      // AFTER the guard, not before. addReportedItem hides the content locally
      // (lib/spam-filter), so running it first made the UI corroborate the
      // false success: the post vanished, which reads as proof the report
      // worked, for a report that never left the device.
      addReportedItem({
        eventId: event.id,
        pubkey: event.pubkey,
        reason: selectedReason,
        reportedAt: Math.floor(Date.now() / 1000),
      });

      toast({ title: "Report submitted", description: "Your report has been published to the network." });
      setSelectedReason("");
      setAdditionalNote("");
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Report failed", description: "Could not publish report. Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = (val: boolean) => {
    if (!isSubmitting) {
      setSelectedReason("");
      setAdditionalNote("");
      onOpenChange(val);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="glass-dialog-card border-brand/15 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-brand">
            <Flag className="w-4 h-4 text-destructive" />
            Report Content
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground/70">
            This publishes a NIP-56 report event to the network. Other clients and relay operators may use it to moderate content. Reports are also reviewed by the Relay Outpost team.
          </p>

          <div className="space-y-1.5">
            {REPORT_REASONS.map(({ value, label, icon: Icon, description }) => (
              <button
                key={value}
                onClick={() => setSelectedReason(value)}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selectedReason === value
                    ? "bg-brand/15 border border-brand/30"
                    : "bg-white/[0.02] border border-transparent hover:bg-white/[0.04]"
                }`}
                data-testid={`report-reason-${value}`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${selectedReason === value ? "text-brand" : "text-muted-foreground/60"}`} />
                <div className="min-w-0">
                  <span className={`text-sm font-medium block ${selectedReason === value ? "text-foreground" : "text-foreground/80"}`}>
                    {label}
                  </span>
                  <span className="text-[11px] text-muted-foreground/50">{description}</span>
                </div>
              </button>
            ))}
          </div>

          <div>
            <Textarea
              value={additionalNote}
              onChange={(e) => setAdditionalNote(e.target.value)}
              placeholder="Additional details (optional)..."
              className="text-xs bg-white/[0.03] border-brand/15 focus-visible:border-brand/30 min-h-[60px] resize-none"
              style={{ fontSize: 16 }}
              data-testid="input-report-note"
              maxLength={500}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isSubmitting}
              className="flex-1 text-xs font-brand uppercase tracking-widest border-brand/15"
              data-testid="button-report-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedReason || isSubmitting}
              className="flex-1 text-xs font-brand uppercase tracking-widest bg-destructive/80 hover:bg-destructive"
              data-testid="button-report-submit"
            >
              {isSubmitting ? (
                <RelayOutpostInlineLoader className="w-4 h-4" />
              ) : (
                <>
                  <Flag className="w-3.5 h-3.5 mr-1.5" />
                  Submit Report
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
