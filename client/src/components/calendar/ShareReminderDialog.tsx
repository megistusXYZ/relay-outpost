import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Send, Loader2 } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { sendDM } from "@/lib/dm";
import type { Holiday } from "@/lib/calendar-holidays";
import { MONTH_NAMES } from "@/lib/calendar-utils";

interface ShareReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holiday: Holiday;
  selectedDay: Date;
}

export function ShareReminderDialog({ open, onOpenChange, holiday, selectedDay }: ShareReminderDialogProps) {
  const { pubkey, signer } = useNostrAuth();
  const { toast } = useToast();
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);

  const resolveRecipient = async (input: string): Promise<string | null> => {
    const trimmed = input.trim();

    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;

    if (trimmed.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(trimmed);
        if (decoded.type === "npub") return decoded.data;
      } catch {}
      return null;
    }

    if (trimmed.includes("@") || trimmed.includes(".")) {
      try {
        const res = await fetch(`/api/nip05/resolve?identifier=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.pubkey) return data.pubkey;
        }
      } catch {}
      return null;
    }

    return null;
  };

  const buildMessage = (): string => {
    const emoji = holiday.emoji ? `${holiday.emoji} ` : "";
    const dateStr = `${MONTH_NAMES[selectedDay.getMonth()]} ${selectedDay.getDate()}, ${selectedDay.getFullYear()}`;
    let msg = `${emoji}${holiday.name}\n📅 ${dateStr}`;

    if (holiday.recurrence && holiday.recurrence !== "once") {
      const labels: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
      msg += `\n🔄 Repeats: ${labels[holiday.recurrence] || holiday.recurrence}`;
    }

    if (holiday.note) {
      msg += `\n📝 ${holiday.note}`;
    }

    if (holiday.url) {
      msg += `\n🔗 ${holiday.url}`;
    }

    return msg;
  };

  const handleSend = async () => {
    if (!pubkey || !signer || !recipient.trim()) return;

    setSending(true);
    try {
      const recipientPubkey = await resolveRecipient(recipient);
      if (!recipientPubkey) {
        toast({ title: "Invalid recipient", description: "Could not resolve the recipient. Use an npub, hex pubkey, or NIP-05 identifier.", variant: "destructive" });
        setSending(false);
        return;
      }

      if (recipientPubkey.toLowerCase() === pubkey.toLowerCase()) {
        toast({ title: "Cannot send to yourself", description: "Enter a different recipient.", variant: "destructive" });
        setSending(false);
        return;
      }

      const content = buildMessage();
      const result = await sendDM({ signer, senderPubkey: pubkey, recipientPubkey, content });

      if (result.success) {
        toast({ title: "Shared", description: `Reminder sent via DM.` });
        setRecipient("");
        onOpenChange(false);
      } else {
        toast({ title: "Failed to send", description: result.error || "Could not send the message.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-brand uppercase tracking-wider">
            <Send className="w-4 h-4 text-amber-800 dark:text-amber-400" />
            Share Reminder
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {holiday.emoji && <span className="mr-1.5">{holiday.emoji}</span>}
              {holiday.name}
            </p>
            <p className="text-[10px] text-amber-600/70 dark:text-amber-400/60 mt-0.5">
              {MONTH_NAMES[selectedDay.getMonth()]} {selectedDay.getDate()}, {selectedDay.getFullYear()}
              {holiday.recurrence && holiday.recurrence !== "once" && ` · ${holiday.recurrence}`}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground/60">Recipient</label>
            <Input
              placeholder="npub1... or user@domain.com"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="h-8 text-sm"
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground/40">
              Enter an npub, hex pubkey, or NIP-05 identifier
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onOpenChange(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
              onClick={handleSend}
              disabled={!recipient.trim() || sending || !pubkey || !signer}
            >
              {sending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Send className="w-3 h-3 mr-1" />
              )}
              Send DM
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
