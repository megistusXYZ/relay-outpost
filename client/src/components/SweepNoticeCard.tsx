/**
 * The Activity page's ONE relay-trouble notice: names the community relays
 * that never answered the queue sweeps and offers the three honest moves —
 * try again, turn the relay off, or remove it. Replaces the stacked
 * per-queue lines that named nothing and offered nothing.
 *
 * Renders ONLY when a relay was asked and did not answer (combinedSweepNotice
 * returns null otherwise) — silence stays accurate.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { combinedSweepNotice, type QueueSweep } from "@/lib/queue-sweep";
import { getOutpostMeta, setRelayDisabled, removeOutpostRelay } from "@/lib/outpost-relays";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { ChevronRight, RefreshCw, PowerOff, Trash2, WifiOff } from "lucide-react";

function relayDisplay(url: string): { name: string; host: string } {
  const host = url.replace(/^wss?:\/\//, "").replace(/\/+$/, "");
  return { name: getOutpostMeta(url)?.name || host, host };
}

export function SweepNoticeCard({
  entries,
  onRetry,
  className = "",
}: {
  entries: { sweep: QueueSweep; subject: string }[];
  /** Re-run the sweeps (NeedsYou refresh). */
  onRetry: () => void;
  className?: string;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [removeUrl, setRemoveUrl] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const combined = combinedSweepNotice(entries);
  if (!combined) return null;

  const retry = () => {
    setRetrying(true);
    onRetry();
    // The sweeps replace these entries when they finish; the flag only
    // debounces double-taps in the meantime.
    setTimeout(() => setRetrying(false), 4000);
  };

  const disable = (url: string) => {
    setRelayDisabled(url, true);
    toast({
      title: "Relay turned off",
      description: "It stays in your list — turn it back on anytime from the Relays page.",
    });
    onRetry();
  };

  const remove = (url: string) => {
    removeOutpostRelay(url);
    setRemoveUrl(null);
    toast({ title: "Relay removed", description: "It's out of your community list." });
    onRetry();
  };

  return (
    <div
      className={`rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2.5 ${className}`}
      data-testid="sweep-notice-card"
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-start gap-2.5 text-left min-h-[44px]"
        aria-expanded={expanded}
        data-testid="sweep-notice-toggle"
      >
        <WifiOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
        <span className="flex-1 text-[11px] leading-relaxed text-muted-foreground">{combined.text}</span>
        {combined.urls.length > 0 && (
          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/50 shrink-0 mt-0.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        )}
      </button>

      {expanded && combined.urls.length > 0 && (
        <div className="mt-2 space-y-1.5" data-testid="sweep-notice-relays">
          {combined.urls.map((url) => {
            const { name, host } = relayDisplay(url);
            return (
              <div
                key={url}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/25 bg-background/40 px-2.5 py-1.5"
                data-testid={`sweep-relay-${host.replace(/\W+/g, "-")}`}
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-xs font-medium truncate">{name}</p>
                  {name !== host && <p className="text-[10px] text-muted-foreground/60 truncate">{host}</p>}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-[36px] px-2 text-[11px] gap-1"
                    onClick={retry}
                    disabled={retrying}
                    data-testid="button-sweep-retry"
                  >
                    <RefreshCw className={`w-3 h-3 ${retrying ? "animate-spin" : ""}`} />
                    Retry
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-[36px] px-2 text-[11px] gap-1 text-muted-foreground"
                    onClick={() => disable(url)}
                    title="Stop using this relay without removing it"
                    data-testid="button-sweep-disable"
                  >
                    <PowerOff className="w-3 h-3" />
                    Turn off
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-[36px] px-2 text-[11px] gap-1 text-muted-foreground hover:text-red-500"
                    onClick={() => setRemoveUrl(url)}
                    data-testid="button-sweep-remove"
                  >
                    <Trash2 className="w-3 h-3" />
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => navigate("/relays")}
            className="text-[10px] text-muted-foreground/60 hover:text-foreground px-1 py-1"
            data-testid="link-sweep-relays-page"
          >
            Manage all relays →
          </button>
        </div>
      )}

      <AlertDialog open={!!removeUrl} onOpenChange={(o) => { if (!o) setRemoveUrl(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeUrl ? relayDisplay(removeUrl).name : "this relay"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This takes the community off your list entirely. If it's just down right now, "Turn off" keeps it around to re-enable later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeUrl && remove(removeUrl)} className="bg-red-600 hover:bg-red-700">
              Remove relay
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
