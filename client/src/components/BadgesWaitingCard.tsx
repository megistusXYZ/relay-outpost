/**
 * "Ana gave you Founding member" — badges waiting for you to decide on, at the
 * top of Activity (owner, 2026-10-06: badges-plan). Nobody was told when they
 * got a badge before; it sat unseen until they opened their own profile.
 *
 * A badge only shows on your profile once you say so. Ones from people you
 * don't follow are folded behind a count (lib/badge-events.ts badgesWaiting):
 * anyone can give anyone a badge, picture included.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { use$ } from "applesauce-react/hooks";
import { Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import { eventStore, fetchProfilesCached } from "@/lib/nostr";
import { KIND_METADATA, getDisplayName } from "@/lib/nostr-helpers";
import {
  fetchBadgeAwardsForUser, fetchProfileBadgesList, fetchBadgeDefinitions, clearBadgeCache,
  showBadgeOnProfile, readBadgesNotNow, addBadgeNotNow,
  type BadgeAward, type BadgeDefinition,
} from "@/lib/nip58-badges";
import { badgesWaiting } from "@/lib/badge-events";
import { FromCommunity } from "@/components/badges/FromCommunity";

function GiverName({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.replaceable(KIND_METADATA, pubkey), [pubkey]);
  return <>{(profile && getDisplayName(profile, "")) || "Someone"}</>;
}

function BadgePicture({ def }: { def?: BadgeDefinition }) {
  const [broken, setBroken] = useState(false);
  const src = def?.thumb || def?.image;
  if (!src || broken) {
    return (
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10">
        <Award className="h-5 w-5 text-brand" aria-hidden />
      </span>
    );
  }
  return <img src={src} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" onError={() => setBroken(true)} />;
}

type Waiting = { award: BadgeAward; def?: BadgeDefinition };

export function BadgesWaitingCard() {
  const { pubkey, signer, follows } = useNostrAuth();
  const { toast } = useToast();
  const [awards, setAwards] = useState<BadgeAward[]>([]);
  const [shown, setShown] = useState<Array<{ badgeRef: string; awardEventId: string }>>([]);
  const [defs, setDefs] = useState<Map<string, BadgeDefinition>>(new Map());
  const [notNow, setNotNow] = useState<Set<string>>(new Set());
  const [showStrangers, setShowStrangers] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!pubkey) return;
    setNotNow(readBadgesNotNow(pubkey));
    const [a, list] = await Promise.all([fetchBadgeAwardsForUser(pubkey), fetchProfileBadgesList(pubkey)]);
    const mine = a.filter((x) => x.awardedTo.includes(pubkey) && x.pubkey !== pubkey);
    setAwards(mine);
    setShown(list?.badges ?? []);
    if (mine.length) setDefs(await fetchBadgeDefinitions([...new Set(mine.map((x) => x.badgeRef))]));
    fetchProfilesCached([...new Set(mine.map((x) => x.pubkey))]);
  }, [pubkey]);

  useEffect(() => { void load(); }, [load]);

  const { waiting, fromStrangers } = useMemo(
    () => badgesWaiting({ awards, shown, notNow, follows: new Set(follows) }),
    [awards, shown, notNow, follows],
  );

  const show = async (award: BadgeAward) => {
    if (!signer || !pubkey) return;
    setBusy(award.id);
    try {
      const r = await showBadgeOnProfile(signer, pubkey, { badgeRef: award.badgeRef, awardEventId: award.id });
      if (r === "shown") {
        toast({ title: "On your profile", description: `${defs.get(award.badgeRef)?.name || "The badge"} now shows on your profile.` });
        clearBadgeCache(pubkey);
        await load();
      } else {
        toast({ title: "Couldn't add the badge", description: r === "unreachable" ? "Your relays didn't answer, so nothing was changed. Try again in a moment." : "Try again in a moment.", variant: "destructive" });
      }
    } finally {
      setBusy(null);
    }
  };

  const later = (award: BadgeAward) => {
    if (!pubkey) return;
    addBadgeNotNow(pubkey, award.id);
    setNotNow(readBadgesNotNow(pubkey));
  };

  const rows: Waiting[] = [...waiting, ...(showStrangers ? fromStrangers : [])].map((award) => ({ award, def: defs.get(award.badgeRef) }));
  if (!pubkey || (rows.length === 0 && fromStrangers.length === 0)) return null;

  return (
    <section className="mx-2 mt-2 space-y-2" data-testid="badges-waiting" aria-label="Badges waiting for you">
      {rows.map(({ award, def }) => (
        <div key={award.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-brand/20 bg-brand/[0.05] p-3" data-testid={`badge-waiting-${award.id}`}>
          <BadgePicture def={def} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">
              <span className="font-medium"><GiverName pubkey={award.pubkey} /></span> gave you{" "}
              <span className="font-semibold">{def?.name || "a badge"}</span>
            </p>
            <FromCommunity url={def?.community} className="block text-xs text-muted-foreground" />
            {def?.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{def.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="min-h-[44px]" disabled={busy === award.id} onClick={() => void show(award)} data-testid={`button-badge-show-${award.id}`}>
              {busy === award.id ? "Adding…" : "Show on my profile"}
            </Button>
            <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => later(award)} data-testid={`button-badge-notnow-${award.id}`}>
              Not now
            </Button>
          </div>
        </div>
      ))}
      {fromStrangers.length > 0 && !showStrangers && (
        <button
          type="button"
          onClick={() => setShowStrangers(true)}
          className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-xs text-muted-foreground hover:bg-muted/40"
          data-testid="badges-from-strangers"
        >
          {fromStrangers.length} {fromStrangers.length === 1 ? "badge" : "badges"} from people you don't follow · Show
        </button>
      )}
    </section>
  );
}
