/**
 * Coexistence Chat tab for a relay-backed outpost (Slice 5). When Concord is
 * enabled, this thin wrapper puts a relay outpost's *encrypted* Concord channels
 * first, with its existing NIP-29 rooms tucked into a collapsible "Rooms"
 * section — the legacy surface (CommsTab) is embedded unchanged via a render
 * prop, so nothing about the relay path changes when the flag is off.
 *
 * If no Concord community is linked to this relay yet, the owner sees a one-tap
 * "Add encrypted channels" upsell that mints a community pinned to this relay.
 * The "New channel" button (owned by the outpost page) routes to the Concord
 * create dialog once a community exists, and falls through to the NIP-29 wizard
 * otherwise.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Lock, History, Loader2, Sparkles } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { publishEvent } from "@/lib/nostr";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import { useToast } from "@/hooks/use-toast";
import { getCommunityForRelay, type StoredCommunity } from "@/lib/concord/concord-keys";
import { createCommunity } from "@/lib/concord/concord-community";
import { COMMUNITY_UPDATED_EVENT } from "./useConcordGovernance";
import { ConcordChat } from "./ConcordChat";
import { ConcordDangerDialog, type ConcordDangerMode } from "./ConcordDangerDialog";

export function ChatTab({ relayUrl, outpostName, isOwner, createChannelOpen, onCreateChannelClose, renderLegacy }: {
  relayUrl: string;
  outpostName?: string;
  /** Only the outpost operator sees the "add encrypted channels" upsell. This
   *  is the RELAY operator (NIP-11 / isAdmin), never the Concord community
   *  owner — it must never be routed to a Concord authority decision. */
  isOwner?: boolean;
  createChannelOpen?: boolean;
  onCreateChannelClose?: () => void;
  /** Renders the untouched NIP-29 surface. `createChannelOpen` is forwarded only
   *  when there's no Concord community (so the legacy wizard still works). */
  renderLegacy: (opts: { createChannelOpen?: boolean; onCreateChannelClose?: () => void }) => ReactNode;
}) {
  const { pubkey } = useNostrAuth();
  const { toast } = useToast();
  const [community, setCommunity] = useState<StoredCommunity | null | undefined>(undefined);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [danger, setDanger] = useState<ConcordDangerMode | null>(null);

  const refresh = useCallback(() => {
    if (!pubkey) { setCommunity(null); return; }
    getCommunityForRelay(pubkey, relayUrl).then(setCommunity);
  }, [pubkey, relayUrl]);
  useEffect(() => { refresh(); }, [refresh]);
  // A rekey rewrites the stored record from inside the chat below (epoch hop,
  // channel-key delivery, our own removal). Without this our copy stays a
  // generation behind — and an invite minted from a stale record carries a root
  // the community has already rotated away, which is a link nobody can revoke
  // but the device that made it. Same listener the standalone page keeps.
  useEffect(() => {
    if (!pubkey) return;
    const id = community?.community_id;
    if (!id) return;
    const onUpdated = (e: Event) => { if ((e as CustomEvent).detail === id) refresh(); };
    window.addEventListener(COMMUNITY_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(COMMUNITY_UPDATED_EVENT, onUpdated);
  }, [pubkey, community?.community_id, refresh]);

  // With a linked community, the page's "New channel" button belongs to Concord.
  // It used to be SWALLOWED here — correct in that it must not open the legacy
  // NIP-29 wizard, wrong in that nothing was ever wired to the Concord one, so
  // the button rendered enabled and did nothing. It is forwarded below instead.

  const addEncryptedChannels = async () => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer) { toast({ title: "Sign in first", variant: "destructive" }); return; }
    setAdding(true);
    try {
      // Seed the community's relay set with this community's relay, padded to ≤5.
      const relays = [relayUrl, ...getActiveDefaultRelays()].filter((r, i, a) => a.indexOf(r) === i).slice(0, 5);
      const record = await createCommunity(
        signer, pubkey,
        { name: outpostName || "Encrypted rooms", relays, relayUrl },
        (e, r) => publishEvent(e, r),
        (e) => publishEvent(e, relays),
      );
      setCommunity(record);
      toast({ title: "Encrypted rooms added", description: "Only members with the key can read them." });
    } catch (err) {
      toast({ title: "Couldn't add encrypted rooms", description: String((err as Error)?.message ?? err), variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  // No linked community → legacy rooms are the whole tab (today's behavior),
  // plus a subtle owner upsell.
  if (community === null || community === undefined) {
    return (
      <div className="space-y-3">
        {community === null && pubkey && isOwner && (
          <button
            onClick={addEncryptedChannels}
            disabled={adding}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-primary/25 bg-primary/5 hover:bg-primary/10 transition-colors text-left disabled:opacity-50"
            data-testid="button-add-encrypted-channels"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin text-brand shrink-0" /> : <Sparkles className="w-4 h-4 text-brand shrink-0" />}
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground/90">Add encrypted rooms</span>
              <span className="block text-[11px] text-muted-foreground/60">Only people you invite can read them — not even the server can.</span>
            </span>
          </button>
        )}
        {renderLegacy({ createChannelOpen, onCreateChannelClose })}
      </div>
    );
  }

  // Linked community → Concord channels first, legacy rooms collapsed below.
  //
  // Two SECTIONS, deliberately not one list: encrypted channels and NIP-29 rooms
  // have different trust models, and merging them would put "only members with
  // the key can read this" and "the relay can read this" under one heading. So
  // they read as peers — same header treatment, same panel framing, one rhythm.
  return (
    <div className="space-y-5" data-testid="chat-tab-merged">
      <section className="space-y-2">
        <SectionHeader icon={<Lock className="w-3 h-3" aria-hidden="true" />} label="Encrypted rooms" />
        {/*
          ConcordChat's root is `flex flex-1 min-h-0` — it expects a flex parent
          that HANDS it a height, which is what the standalone community page does.
          Embedded here it had neither, so `flex-1` resolved to nothing and the
          panel collapsed to its content: a half-empty slab with the composer
          floating mid-page and ~200px of dead air above it.
          Giving it a real box is the whole fix. Capped against the viewport so
          it stays a panel on a laptop instead of pushing the rooms below the
          fold, floored so a quiet channel still looks like a chat.

          On a phone the unit is `svh`, not `vh`: iOS Safari resolves `vh`
          against the LARGE viewport (URL bar collapsed), so a height measured
          in vh overflows the screen for as long as the bar is expanded. And the
          floor drops to 240 — a 300px floor beats the percentage on anything
          under a 517px viewport, which is more height than a phone in landscape
          has to give.
          55, not 65: with this page's top bar, tab strip and bottom nav dock,
          65svh put the panel's bottom edge 5px above the dock and left the
          Legacy rooms section entirely off-screen, so on a phone the tab looked
          like it held one thing. 55 leaves the next section's header and its
          Show-rooms button visible — enough to say "there is more below".

          `glass-card` is the surface, not decoration: ConcordChat's own
          `border-border/30` is invisible against the page in dark mode, so a
          quiet channel read as loose furniture floating on the background
          rather than as a panel. It also keeps this surface reactive to the
          Performance Full/Lite switch, like every other page surface.
        */}
        <div className="glass-card flex flex-col h-[55svh] min-h-[240px] md:h-[min(58vh,460px)] md:min-h-[300px] rounded-xl overflow-hidden">
          <ConcordChat
            community={community}
            onCommunityChange={setCommunity}
            createChannelOpen={createChannelOpen}
            onCreateChannelClose={onCreateChannelClose}
            embedded
            // Both acts, because neither was reachable here. The drawer's
            // danger section gates on `!!onDissolve`, and sections are ABSENT
            // rather than disabled — so on the app's landing destination its
            // silence asserted that an owner could not end their own space.
            onLeave={() => setDanger("leave")}
            onDissolve={() => setDanger("dissolve")}
          />
        </div>
      </section>

      <section className="space-y-2">
        <SectionHeader
          icon={<History className="w-3 h-3" aria-hidden="true" />}
          label="Rooms"
        />
        <div className="glass-card rounded-xl border border-border/30 overflow-hidden">
          <button
            onClick={() => setLegacyOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-3.5 py-3 hover:bg-muted/20 transition-colors"
            aria-expanded={legacyOpen}
            data-testid="button-toggle-legacy-rooms"
          >
            <span className="text-xs font-medium text-muted-foreground/70">
              {legacyOpen ? "Hide rooms" : "Show rooms"}
            </span>
            <ChevronDown className={`w-4 h-4 ml-auto text-muted-foreground/40 transition-transform ${legacyOpen ? "rotate-180" : ""}`} />
          </button>
          {legacyOpen && (
            <div className="border-t border-border/20 p-3">
              {renderLegacy({ createChannelOpen: false, onCreateChannelClose })}
            </div>
          )}
        </div>
      </section>

      {/* The SAME confirm the standalone page uses — not a second wording for
          the irreversible thing. After it succeeds this tab stays put and
          re-reads: the community is gone, so `refresh()` lands us back on the
          upsell + legacy rooms, which is the truthful state of this relay. */}
      <ConcordDangerDialog
        mode={danger}
        onOpenChange={setDanger}
        community={community}
        pubkey={pubkey}
        onDone={() => { setDanger(null); refresh(); }}
      />
    </div>
  );
}

/** One header treatment, so the two sections read as peers rather than as a
 *  floating block above a bordered box.
 *
 *  /50, not /60: index.css's legibility floor only rewrites /20–/50, so a /60
 *  label opts itself OUT of the High and Maximum contrast presets entirely. */
function SectionHeader({ icon, label, badge }: { icon: ReactNode; label: string; badge?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-0.5 text-muted-foreground/50">
      <span className="text-muted-foreground/50">{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      {badge && (
        <span className="text-[10px] font-medium text-muted-foreground/40 border border-border/40 rounded px-1 py-px">
          {badge}
        </span>
      )}
    </div>
  );
}
