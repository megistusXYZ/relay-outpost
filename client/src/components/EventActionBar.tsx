import { useMemo, useState } from "react";
import { CalendarPlus, Check, HelpCircle, Users, Share2 } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { OutpostIcon } from "@/components/icons/OutpostIcon";
import { publishEvent, getEventRelays } from "@/lib/nostr";
import { getPublishTarget } from "@/lib/outpost-relays";
import { clientTags, getRelayHintForEvent } from "@/lib/nostr-helpers";
import { signWithTimeout, handleSignerError, isSignerError } from "@/lib/signer-timeout";
import {
  buildRsvp,
  pinEvent,
  isEventPinned,
  pinEventExplicit,
  unpinEventExplicit,
  unpinEventFromRsvpClear,
  type CalendarEventData,
  type RsvpStatus,
} from "@/lib/calendar-events";
import { downloadIcs, buildGoogleCalendarUrl } from "@/lib/calendar-export";
import { buildEventNaddr } from "@/components/ShareEventDialog";
import { useEventRsvps } from "@/hooks/use-event-rsvps";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// The ONE action row for an event card (both "list" and "embed" variants). It
// consolidates every per-event action so the card needs no top-right cluster:
//   [ ✓ Going ] [ Maybe ]   · N going        📅 Add    ⤴ Share
//   • RSVP (Going / Maybe) — Nostr kind-31925, with a live "N going" count.
//     Going also PINS the event into the in-app calendar (replacing the old
//     top-right pin); clearing Going unpins. Maybe never touches pin state.
//   • Add to calendar — device calendar (.ics or Google) PLUS a quiet
//     "Relay Outpost calendar" entry that pins into the in-app calendar with
//     no RSVP and no publish (localStorage only). An explicit quiet pin
//     survives RSVP churn — see unpinEventFromRsvpClear in calendar-events.
//   • Share — optional; only shown when the surface supplies onShare.
// Device-calendar export works logged-out; RSVP and quiet pin prompt sign-in
// (the pin store is keyed by pubkey).
type PinAction = "pin" | "unpin" | "none";

export function EventActionBar({
  ce,
  variant = "list",
  onShare,
}: {
  ce: CalendarEventData;
  variant?: "list" | "embed";
  onShare?: () => void;
}) {
  const { pubkey, signer, attemptReconnect } = useNostrAuth();
  const { toast } = useToast();
  const { goingCount, myStatus, applyLocal } = useEventRsvps(ce, pubkey);
  const [busy, setBusy] = useState(false);

  // handleSignerError wants a plain (opts) => void; useToast's toast returns a
  // handle and narrows `variant`. Adapt it so the types line up.
  const toastFn = (opts: { title: string; description?: string; variant?: string; action?: unknown }) => {
    toast({ title: opts.title, description: opts.description, variant: opts.variant as "default" | "destructive" | undefined });
  };

  const naddr = buildEventNaddr(ce);

  // Pinned-into-the-in-app-calendar state (localStorage). pinTick bumps after
  // every pin/unpin so the memo re-reads the store.
  const [pinTick, setPinTick] = useState(0);
  const pinned = useMemo(() => !!pubkey && isEventPinned(pubkey, ce.id, ce), [pubkey, ce, pinTick]);

  // Going doubles as a "save to my calendar" gesture: it pins into the in-app
  // calendar (idempotent — pinEvent no-ops if already pinned) and unpins when
  // cleared. Kept local + synchronous so the calendar reflects the tap at once.
  // RSVP-driven unpins go through unpinEventFromRsvpClear so an explicit quiet
  // pin (made via the Add popover) is never removed by RSVP churn.
  const applyPin = (action: PinAction) => {
    if (!pubkey || action === "none") return;
    if (action === "pin") pinEvent(pubkey, ce.id, ce);
    else unpinEventFromRsvpClear(pubkey, ce.id, ce);
    setPinTick((t) => t + 1);
  };

  // Quiet save: pin/unpin the in-app calendar with EXPLICIT provenance. No
  // RSVP, no publish — pure localStorage, invisible to everyone else.
  const onQuietPinToggle = () => {
    if (!pubkey) {
      toast({ title: "Sign in required", description: "Sign in to save events to your calendar.", variant: "destructive" });
      return;
    }
    if (pinned) {
      unpinEventExplicit(pubkey, ce.id, ce);
      toast({ title: "Removed from your calendar" });
    } else {
      pinEventExplicit(pubkey, ce.id, ce);
      toast({ title: "Pinned to your calendar", description: "Saved privately — no RSVP." });
    }
    setPinTick((t) => t + 1);
  };

  const publishRsvp = async (status: RsvpStatus, optimistic: RsvpStatus | null, pin: PinAction) => {
    if (!signer || !pubkey) {
      toast({ title: "Sign in required", description: "Sign in to RSVP.", variant: "destructive" });
      return;
    }
    if (busy) return;
    setBusy(true);
    applyLocal(optimistic); // reflect the RSVP immediately
    applyPin(pin);          // …and the in-app calendar
    try {
      const hint = getRelayHintForEvent(ce.id, getEventRelays) || undefined;
      const template = buildRsvp(ce, status, pubkey, Math.floor(Date.now() / 1000), hint);
      template.tags.push(...clientTags());
      const signed = await signWithTimeout(signer, template);
      const { relays, userSelected } = getPublishTarget();
      publishEvent(signed, relays, ce.pubkey, userSelected).catch((err) => {
        console.error("RSVP publish failed:", err);
      });
    } catch (err) {
      applyLocal(myStatus);                                    // roll back the RSVP
      applyPin(pin === "pin" ? "unpin" : pin === "unpin" ? "pin" : "none"); // …and the pin
      if (isSignerError(err)) { await handleSignerError(err, toastFn, attemptReconnect); }
      else {
        console.error("Failed to RSVP:", err);
        toast({ title: "Couldn't RSVP", description: "Something went wrong.", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  const going = myStatus === "accepted";
  const maybe = myStatus === "tentative";

  // Tapping the active choice again clears the RSVP (publishes `declined`).
  const onGoing = () => publishRsvp(going ? "declined" : "accepted", going ? null : "accepted", going ? "unpin" : "pin");
  const onMaybe = () => publishRsvp(maybe ? "declined" : "tentative", maybe ? null : "tentative", "none");

  const pill = "inline-flex items-center justify-center gap-1.5 h-9 min-h-[36px] px-3 rounded-full text-xs font-medium transition-colors disabled:opacity-60";
  const iconBtn = "inline-flex items-center justify-center h-9 w-9 min-h-[36px] rounded-full transition-colors";

  return (
    <div className="mt-2.5 pt-2.5 border-t border-border/30 flex items-center gap-2 flex-wrap" data-testid={`event-action-bar-${ce.id.slice(0, 8)}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onGoing(); }}
        disabled={busy}
        aria-pressed={going}
        className={`${pill} ${going
          ? "bg-primary text-primary-foreground dark:bg-brand dark:text-white"
          : "bg-primary/10 text-primary dark:text-brand hover:bg-primary/20"}`}
        data-testid="button-rsvp-going"
      >
        <Check className="w-3.5 h-3.5" />
        Going
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMaybe(); }}
        disabled={busy}
        aria-pressed={maybe}
        className={`${pill} ${maybe
          ? "bg-amber-500 text-white"
          : "bg-muted/60 text-muted-foreground hover:bg-muted"}`}
        data-testid="button-rsvp-maybe"
      >
        <HelpCircle className="w-3.5 h-3.5" />
        Maybe
      </button>

      {goingCount > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70" data-testid="rsvp-going-count">
          <Users className="w-3 h-3" />
          {goingCount} going
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={`${pill} bg-transparent border border-border/50 text-foreground/70 hover:bg-muted/60 hover:text-foreground`}
              data-testid="button-add-to-calendar"
              aria-label={pinned ? "Add to calendar (pinned to your Relay Outpost calendar)" : "Add to calendar"}
            >
              <CalendarPlus className="w-3.5 h-3.5" />
              <span>Add</span>
              {/* Quiet-pin indication: the event stuck in the in-app calendar
                  without a Going RSVP announcing it (Going's filled pill
                  already signals the pinned state). */}
              {pinned && !going && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary" aria-hidden="true" data-testid="add-pinned-dot" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()} className="w-52">
            <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
              Add to calendar
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onQuietPinToggle(); }}
              data-testid="menu-pin-outpost-calendar"
              className="cursor-pointer"
            >
              {pinned
                ? <Check className="w-4 h-4 mr-2 text-brand" />
                : <OutpostIcon className="w-4 h-4 mr-2" />}
              <span className="flex flex-col items-start">
                <span>{pinned ? "Pinned · Remove" : "Relay Outpost calendar"}</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {pinned ? "In your in-app calendar" : "Save privately — no RSVP"}
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); downloadIcs(ce, { naddr }); }}
              data-testid="menu-add-ics"
              className="cursor-pointer"
            >
              <CalendarPlus className="w-4 h-4 mr-2" />
              Apple / Outlook (.ics)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                window.open(buildGoogleCalendarUrl(ce, { naddr }), "_blank", "noopener,noreferrer");
              }}
              data-testid="menu-add-google"
              className="cursor-pointer"
            >
              <CalendarPlus className="w-4 h-4 mr-2" />
              Google Calendar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {onShare && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onShare(); }}
            className={`${iconBtn} text-muted-foreground/60 hover:bg-muted/60 hover:text-brand`}
            data-testid="button-share-event"
            aria-label="Share to feed"
            title="Share to feed"
          >
            <Share2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
