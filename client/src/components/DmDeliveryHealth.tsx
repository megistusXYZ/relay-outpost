import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MailWarning, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  computeDeliveryHealth,
  isDeliveryWarningDismissed,
  dismissDeliveryWarning,
  clearDeliveryDismissalOnHealthy,
  formatRelayHost,
} from "@/lib/dm-delivery-health";
import {
  hasDMRelayList,
  fetchDMRelayList,
  getDMRelayListCached,
  getDMRelaysForContact,
  getMyDMReceiveRelays,
  wasDMRelayListConfirmedEmpty,
} from "@/lib/outbox";

/**
 * DM delivery health — problem-only banner + detail sheet for the thread view.
 *
 * READ-ONLY by design: this component never touches the gift-wrap/publish
 * mechanics. It reads the kind-10050 caches in @/lib/outbox and warns in
 * exactly two cases:
 *  - the CONTACT has no published DM inbox (the silent-delivery-failure case);
 *  - OUR own auto-publish of kind-10050 conclusively failed (rare) — with a
 *    "Publish inbox" button that re-runs the EXISTING ensure-own-10050 routine
 *    via the onPublishInbox callback (owned by Messages.tsx).
 * Healthy threads render nothing. No verdict is shown while the contact's
 * answer is still loading (no flicker). Dismissal is per contact and episode-
 * scoped (see lib/dm-delivery-health.ts); after dismissal a tiny "Delivery
 * info" hint keeps the detail sheet reachable.
 */

interface DmDeliveryHealthProps {
  myPubkey: string;
  contactPubkey: string;
  /** Display name for plain-language sheet copy (falls back to "them"). */
  contactName?: string;
  /** From Messages.tsx: the existing own-10050 auto-publish ran and failed. */
  selfAutopubFailed: boolean;
  /** Re-runs the existing ensure-own-10050 routine; resolves true on success. */
  onPublishInbox?: () => Promise<boolean>;
}

function RelayHostList({ urls, testId }: { urls: string[]; testId: string }) {
  return (
    <ul className="space-y-1" data-testid={testId}>
      {urls.map((u) => (
        <li
          key={u}
          className="text-xs text-foreground/85 font-mono truncate leading-relaxed"
        >
          {formatRelayHost(u)}
        </li>
      ))}
    </ul>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5">
      {children}
    </p>
  );
}

export function DmDeliveryHealth({
  myPubkey,
  contactPubkey,
  contactName,
  selfAutopubFailed,
  onPublishInbox,
}: DmDeliveryHealthProps) {
  const { toast } = useToast();
  const [tick, setTick] = useState(0);
  const [dismissTick, setDismissTick] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const recheck = useCallback(() => setTick((t) => t + 1), []);

  // Check on thread open: cached-first, then ONE background (non-force)
  // refresh — the force fetch already happens on send, so this adds no relay
  // load when an answer is fresh. Afterwards, calm cache-only re-reads pick up
  // changes made elsewhere (send-path force fetch, own auto-publish) without
  // any network traffic.
  useEffect(() => {
    let alive = true;
    fetchDMRelayList(contactPubkey)
      .catch(() => {})
      .finally(() => {
        if (alive) recheck();
      });
    const iv = setInterval(recheck, 15000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [contactPubkey, recheck]);

  const health = useMemo(() => {
    void tick; // cache re-read trigger
    const contactHas = hasDMRelayList(contactPubkey);
    return computeDeliveryHealth({
      contactHas10050: contactHas,
      // Definitive only: a cached list, or a query that succeeded and confirmed
      // "nothing published". A transient fetch error keeps this false → no warn.
      contactListLoaded: contactHas || wasDMRelayListConfirmedEmpty(contactPubkey),
      selfHas10050: hasDMRelayList(myPubkey),
      selfAutopubFailed,
    });
  }, [tick, contactPubkey, myPubkey, selfAutopubFailed]);

  // Episode bookkeeping: observing a healthy thread ends the episode, so a
  // stored dismissal never silences a FUTURE regression.
  useEffect(() => {
    if (health.level === "ok") clearDeliveryDismissalOnHealthy(myPubkey, contactPubkey);
  }, [health.level, myPubkey, contactPubkey]);

  const dismissed = useMemo(() => {
    void dismissTick;
    return (
      health.level !== "ok" &&
      isDeliveryWarningDismissed(myPubkey, contactPubkey, health.level)
    );
  }, [health.level, myPubkey, contactPubkey, dismissTick]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      dismissDeliveryWarning(myPubkey, contactPubkey, health.level);
      setDismissTick((t) => t + 1);
    },
    [myPubkey, contactPubkey, health.level],
  );

  const handlePublish = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onPublishInbox || publishing) return;
      setPublishing(true);
      try {
        const ok = await onPublishInbox();
        if (ok) {
          toast({
            title: "Private inbox published",
            description: "Other apps now know where to deliver your messages.",
          });
        } else {
          toast({
            title: "Couldn't publish your inbox",
            description: "Your signer may have declined the request. You can try again.",
            variant: "destructive",
          });
        }
      } finally {
        setPublishing(false);
        recheck();
      }
    },
    [onPublishInbox, publishing, toast, recheck],
  );

  // Problem-only: healthy threads render nothing at all.
  if (health.level === "ok") return null;

  const who = contactName || "them";
  const theirInbox = getDMRelayListCached(contactPubkey);
  const myInbox = getDMRelayListCached(myPubkey);
  const outgoing = getDMRelaysForContact(contactPubkey, myPubkey);
  const myWatch = getMyDMReceiveRelays(myPubkey).slice(0, 3);

  const detailSheet = (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      {/* z-[60]: the mobile thread is a fixed z-[55] overlay; the sheet must sit above it. */}
      <SheetContent
        side="bottom"
        className="z-[60] rounded-t-2xl max-h-[85vh] overflow-y-auto pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]"
        data-testid="sheet-dm-delivery-health"
      >
        <div className="w-full md:max-w-[46rem] md:mx-auto">
          <SheetHeader className="text-left">
            <SheetTitle>Message delivery</SheetTitle>
            <SheetDescription>
              Private messages are delivered to relays — small servers each app
              chooses. Apps publish a "private inbox" list so other apps know
              where to deliver.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            <div>
              <SectionLabel>Their private inbox</SectionLabel>
              {theirInbox.length > 0 ? (
                <RelayHostList urls={theirInbox} testId="list-their-inbox" />
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="text-their-inbox-none">
                  None published — {who === "them" ? "their" : `${who}'s`} app
                  hasn't said where private messages should be delivered.
                </p>
              )}
            </div>

            <div>
              <SectionLabel>Your private inbox</SectionLabel>
              {myInbox.length > 0 ? (
                <RelayHostList urls={myInbox} testId="list-my-inbox" />
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground" data-testid="text-my-inbox-none">
                    Not published yet — others may not know where to reach you.
                  </p>
                  {myWatch.length > 0 && (
                    <p className="text-[11px] text-muted-foreground/70">
                      This app still checks{" "}
                      {myWatch.map(formatRelayHost).join(", ")} for incoming
                      messages in the meantime.
                    </p>
                  )}
                  {selfAutopubFailed && onPublishInbox && (
                    <button
                      type="button"
                      onClick={handlePublish}
                      disabled={publishing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-60"
                      data-testid="button-publish-inbox-sheet"
                    >
                      {publishing ? "Publishing…" : "Publish inbox"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <SectionLabel>Where your messages go</SectionLabel>
              {outgoing.length > 0 ? (
                <>
                  <RelayHostList urls={outgoing} testId="list-outgoing" />
                  <p className="text-[11px] text-muted-foreground/70 mt-1.5">
                    {theirInbox.length > 0
                      ? "Delivered to their inbox relays first."
                      : "Best guess — without a published inbox, messages go to relays they're known to use, plus a few common ones. They may not check any of them."}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No relays known yet for this contact.
                </p>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );

  // Dismissed: a tiny muted hint keeps the sheet reachable without nagging.
  if (dismissed) {
    return (
      <div className="px-3 pt-1.5 shrink-0">
        <div className="w-full md:max-w-[46rem] md:mx-auto">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
            data-testid="button-dm-delivery-info"
          >
            Delivery info
          </button>
        </div>
        {detailSheet}
      </div>
    );
  }

  const isSelf = health.level === "self-no-inbox";

  return (
    <div className="px-3 pt-2 shrink-0">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setSheetOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setSheetOpen(true);
          }
        }}
        className="w-full md:max-w-[46rem] md:mx-auto flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5 text-left cursor-pointer hover:bg-amber-500/15 transition-colors"
        data-testid="banner-dm-delivery-health"
      >
        <MailWarning className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-amber-800 dark:text-amber-200 leading-snug">
            {isSelf
              ? "Your private inbox isn't published — others may not be able to reach you."
              : "Their app hasn't said where to deliver private messages — this chat may not reach them until they use a messenger that supports private inboxes."}
          </p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] text-amber-700/70 dark:text-amber-300/60">
              Tap for details
            </span>
            {isSelf && onPublishInbox && (
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="text-[10px] font-medium px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-60"
                data-testid="button-publish-inbox"
              >
                {publishing ? "Publishing…" : "Publish inbox"}
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss delivery warning"
          className="shrink-0 p-1 -m-1 text-amber-700/60 dark:text-amber-300/50 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          data-testid="button-dismiss-delivery-warning"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {detailSheet}
    </div>
  );
}
