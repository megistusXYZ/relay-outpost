/**
 * The one place the wider network is explained and switched (owner,
 * 2026-10-10; lib/network-mode.ts). Every door in the app opens this same
 * sheet, so the words are said once and the switch is in one place.
 *
 * Mounted once by the app shell (WiderNetworkSheetHost); opened from
 * anywhere with openWiderNetworkSheet(). Flipping the switch flips the local
 * state first and republishes the account's relay list for the new mode;
 * if the relays can't be reached it flips back and says so
 * (lib/wider-network-switch.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { useWiderNetwork, setWiderNetwork } from "@/lib/network-mode";
import { flipWiderNetwork } from "@/lib/wider-network-switch";
import { publishRelayListForModeLive } from "@/lib/wider-network-relays";
import { FLOOR_RELAYS } from "@/lib/signup-relays";

import { WIDER_NETWORK_OPEN_EVENT as OPEN_EVENT, openWiderNetworkSheet } from "./open-sheet";
export { openWiderNetworkSheet };

const floorHosts = FLOOR_RELAYS.map((u) => u.replace(/^wss:\/\//, "")).join(" and ");

export function WiderNetworkSheetHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[88dvh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]" data-testid="wider-network-sheet">
        <WiderNetworkSheetBody />
      </SheetContent>
    </Sheet>
  );
}

function WiderNetworkSheetBody() {
  const { pubkey, signer } = useNostrAuth();
  const on = useWiderNetwork(pubkey);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const flip = useCallback(async (next: boolean) => {
    if (!pubkey || busy) return;
    setBusy(true);
    try {
      const outcome = await flipWiderNetwork(next, {
        set: (v) => setWiderNetwork(pubkey, v),
        publish: (v) => (signer ? publishRelayListForModeLive(v, pubkey, signer as never) : Promise.resolve("failed" as const)),
      });
      if (!outcome.ok) {
        toast({ title: "Couldn't reach your relays", description: "Nothing changed. Check your connection and try again." });
      }
    } finally {
      setBusy(false);
    }
  }, [pubkey, signer, busy, toast]);

  return (
    <div className="space-y-5">
      <SheetHeader className="text-left space-y-2">
        <div className="flex items-center gap-2.5">
          <Globe className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          <SheetTitle className="text-base">The wider network</SheetTitle>
        </div>
        <SheetDescription className="text-sm leading-relaxed text-muted-foreground">
          Your space is your communities and the people you follow. The wider network is everyone on Nostr: people and posts from everywhere, on relays nobody here controls.
        </SheetDescription>
      </SheetHeader>

      <ul className="space-y-2.5 text-sm leading-relaxed text-foreground/85" data-testid="wider-network-lines">
        <li className="flex gap-2.5"><span className="text-muted-foreground/60 select-none">—</span><span>What opens up: people and posts from everywhere, trending, places to explore.</span></li>
        <li className="flex gap-2.5"><span className="text-muted-foreground/60 select-none">—</span><span>What you should know: anyone can post anything there. We filter for you, but nobody moderates all of it.</span></li>
        <li className="flex gap-2.5"><span className="text-muted-foreground/60 select-none">—</span><span>You can turn it off again any time. Your people and your communities stay as they are.</span></li>
      </ul>

      <label className="flex items-center justify-between gap-4 rounded-xl border border-border/40 px-4 min-h-[56px] py-3 cursor-pointer" data-testid="wider-network-switch-row">
        <span className="text-[15px] font-medium">Connect to the wider network</span>
        <Switch checked={on} disabled={busy || !pubkey} onCheckedChange={(v) => void flip(v)} data-testid="switch-wider-network" aria-label="Connect to the wider network" />
      </label>

      <p className="text-xs leading-relaxed text-muted-foreground/80" data-testid="wider-network-floor-note">
        Either way, your profile and messages are reachable through two relays ({floorHosts}) so friends on other apps can find you.
      </p>
    </div>
  );
}
