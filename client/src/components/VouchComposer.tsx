import { useEffect, useState } from "react";
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
import { publishVouch, type AttestationType } from "@/hooks/use-attestations";
import { ShieldCheck, BadgeCheck, Heart } from "lucide-react";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";

const MAX_LEN = 500;

interface VouchComposerProps {
  subjectPubkey: string;
  subjectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: () => void;
  // If the viewer already vouched for this subject, pass the existing vouch so we
  // can prefill the text + type and label the action "Update your vouch".
  existingContent?: string;
  existingType?: AttestationType;
  isUpdate?: boolean;
}

export function VouchComposer({
  subjectPubkey,
  subjectName,
  open,
  onOpenChange,
  onPublished,
  existingContent,
  existingType,
  isUpdate = false,
}: VouchComposerProps) {
  const { signer, pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [type, setType] = useState<AttestationType>(existingType || "vouch");
  const [text, setText] = useState(existingContent || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the existing vouch each time the dialog opens.
  useEffect(() => {
    if (open) {
      setType(existingType || "vouch");
      setText(existingContent || "");
      setError(null);
    }
  }, [open, existingContent, existingType]);

  const isSelf = !!pubkey && pubkey === subjectPubkey;

  const handleSubmit = async () => {
    setError(null);
    if (!signer || !pubkey) {
      setError("You need to be signed in to vouch.");
      return;
    }
    if (isSelf) {
      setError("You can't vouch for yourself.");
      return;
    }
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const ok = await publishVouch({
        signer,
        authorPubkey: pubkey,
        subjectPubkey,
        type,
        content: text,
      });
      if (!ok) {
        setError("Could not publish your vouch. Please try again.");
        return;
      }
      toast({
        title: isUpdate ? "Vouch updated" : "Vouch published",
        description: `Your trust review for ${subjectName} is now on the network.`,
      });
      onOpenChange(false);
      onPublished?.();
    } catch {
      setError("Could not publish your vouch. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = (val: boolean) => {
    if (!isSubmitting) onOpenChange(val);
  };

  const typeOptions: {
    value: AttestationType;
    label: string;
    helper: string;
    icon: typeof Heart;
  }[] = [
    {
      value: "vouch",
      label: "Vouch",
      helper: "Vouch — general endorsement of this person",
      icon: Heart,
    },
    {
      value: "identity",
      label: "Identity",
      helper: "Identity — I personally know this is really them",
      icon: BadgeCheck,
    },
  ];

  const activeHelper = typeOptions.find((o) => o.value === type)?.helper || "";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="glass-dialog-card border-emerald-500/15 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-brand">
            <ShieldCheck className="w-4 h-4 text-emerald-500/80" />
            {isUpdate ? "Update your vouch" : `Vouch for ${subjectName}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground/70">
            This publishes a public trust review to the network. Others will see it
            in {subjectName}'s Trust Reviews.
          </p>

          {/* Type toggle */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Review type">
              {typeOptions.map(({ value, label, icon: Icon }) => {
                const selected = type === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setType(value)}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 min-h-[44px] text-sm font-medium transition-colors border ${
                      selected
                        ? "bg-emerald-500/15 border-emerald-500/30 text-foreground"
                        : "bg-white/[0.02] border-transparent text-foreground/70 hover:bg-white/[0.04]"
                    }`}
                    data-testid={`vouch-type-${value}`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${selected ? "text-emerald-800 dark:text-emerald-400" : "text-muted-foreground/60"}`} />
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground/60 leading-snug">{activeHelper}</p>
          </div>

          {/* Review text */}
          <div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
              placeholder={`Share why you vouch for ${subjectName}… (optional)`}
              className="text-sm bg-white/[0.03] border-emerald-500/15 focus-visible:border-emerald-500/30 min-h-[88px] resize-none"
              style={{ fontSize: 16 }}
              maxLength={MAX_LEN}
              data-testid="input-vouch-text"
              aria-label="Vouch review text"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-muted-foreground/50">
                {text.length}/{MAX_LEN}
              </span>
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-700/90 dark:text-red-400/90" role="alert">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isSubmitting}
              className="flex-1 text-xs font-brand uppercase tracking-widest border-emerald-500/15 min-h-[44px]"
              data-testid="button-vouch-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !signer || isSelf}
              className="flex-1 text-xs font-brand uppercase tracking-widest bg-emerald-600/80 hover:bg-emerald-600 min-h-[44px]"
              data-testid="button-vouch-submit"
            >
              {isSubmitting ? (
                <RelayOutpostInlineLoader className="w-4 h-4" />
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                  {isUpdate ? "Update vouch" : "Publish vouch"}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
