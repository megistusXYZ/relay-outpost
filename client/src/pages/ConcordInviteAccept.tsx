/**
 * Accept a Concord invite link (CORD-05). The URL fragment (secret token) is
 * read client-side and never sent anywhere. Shows the community preview from the
 * decrypted bundle, then joins on tap.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Lock, Loader2, Check, UserPlus } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { persistentPoolSubscribe, publishEvent } from "@/lib/nostr";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import { canReachAny } from "@/lib/relay-reach";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { forceEnableConcord } from "@/lib/concord/concord-prefs";
import { decodeFragment, decryptBundle, acceptInviteLink, type InviteBundle } from "@/lib/concord/concord-invites";
import { inviterFromCreator, setInviteConnect } from "@/lib/invite-connect";
import { KIND_INVITE_BUNDLE } from "@/lib/concord/concord-events";
import { nip19, type Event } from "nostr-tools";

const PENDING_KEY = "relay-outpost-concord-invite-pending";
const clearPending = () => { try { sessionStorage.removeItem(PENDING_KEY); } catch {} };

export default function ConcordInviteAccept({ naddr }: { naddr: string }) {
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [bundle, setBundle] = useState<InviteBundle | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);
  const autoJoinedRef = useRef(false);
  // Bumped on a short timer while the global signer isn't registered yet, so
  // the auto-join effect below re-runs instead of dead-ending (see comment).
  const [signerTick, setSignerTick] = useState(0);
  const fragment = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";

  // You can't gate someone out of a link they were handed — flip the flag on so
  // this page and the outpost they land in are enabled even if they'd killed it.
  useEffect(() => { forceEnableConcord(); }, []);

  // Fetch + decrypt the bundle for preview.
  useEffect(() => {
    const frag = decodeFragment(fragment);
    let decoded: nip19.DecodedResult | null = null;
    try { decoded = nip19.decode(naddr); } catch {}
    if (!frag || !decoded || decoded.type !== "naddr" || decoded.data.kind !== KIND_INVITE_BUNDLE) {
      setBundle(null); return;
    }
    const linkSigner = decoded.data.pubkey;
    const relays = [...new Set([...(decoded.data.relays ?? []), ...frag.relays])];
    let latest: Event | null = null;
    const sub = persistentPoolSubscribe(relays, { kinds: [KIND_INVITE_BUNDLE], authors: [linkSigner], "#d": [""] }, {
      onevent: (e: Event) => { if (!latest || e.created_at > latest.created_at) latest = e; },
    });
    const done = setTimeout(() => {
      sub.close();
      if (!latest || latest.tags.some((t) => t[0] === "vsk" && t[1] === "9") || !latest.content) { setBundle(null); return; }
      setBundle(decryptBundle(latest.content, frag.token) ?? null);
    }, 3500);
    return () => { clearTimeout(done); sub.close(); };
  }, [naddr, fragment]);

  const join = useCallback(async () => {
    const signer = getGlobalSigner();
    if (!pubkey || !signer) { toast({ title: "Sign in to join", variant: "destructive" }); return; }
    setJoining(true);
    try {
      const relays = getActiveDefaultRelays();
      // An invite has THREE outcomes, and the toast below used to have two:
      // valid, genuinely revoked, and "we never reached a relay that would
      // know". The third told people a good invite was dead, so they threw the
      // link away. `bundleReached` carries which of the last two happened.
      let bundleReached = true;
      // The reachability check is an `await` OUTSIDE the executor on purpose.
      // `new Promise(async (resolve) => …)` swallows a throw from the async
      // function and leaves the promise pending forever — a hang dressed as a
      // slow relay, which is the same "failure that looks like an answer" this
      // whole change is about.
      const fetchBundle = async (linkSigner: string, bootstrap: string[]): Promise<Event | null> => {
        const set = bootstrap.length ? bootstrap : relays;
        if (!(await canReachAny(set))) { bundleReached = false; return null; }
        return new Promise<Event | null>((resolve) => {
          let latest: Event | null = null;
          const sub = persistentPoolSubscribe(set, { kinds: [KIND_INVITE_BUNDLE], authors: [linkSigner], "#d": [""] }, {
            onevent: (e: Event) => { if (!latest || e.created_at > latest.created_at) latest = e; },
          });
          setTimeout(() => { sub.close(); resolve(latest); }, 3500);
        });
      };
      const record = await acceptInviteLink(pubkey, signer, naddr, fragment, fetchBundle, (e, r) => publishEvent(e, r), (e) => publishEvent(e, relays));
      clearPending();
      if (!record) {
        // Even having REACHED relays, "none of them have it" is not proof of
        // revocation — a bundle published seconds ago may not have propagated
        // to this reader's relay set yet, and the window here is 3.5s. Say what
        // we actually know, and leave the door open to retry.
        toast(bundleReached
          ? { title: "Couldn't confirm this invite", description: "No relay we checked has it. It may have been revoked, or it may not have reached them yet — try again in a moment." }
          : { title: "Couldn't reach any relay", description: "We can't check this invite right now. Try again when you're back online.", variant: "destructive" });
        setJoining(false);
        return;
      }
      // Hand off the human behind the link so they don't land among strangers.
      // A community link can be forwarded or scanned off a QR, so this only
      // ARMS the prompt — the follow itself stays an explicit tap.
      const inviter = inviterFromCreator(bundle?.creator_npub, pubkey);
      if (inviter) setInviteConnect({ inviter, step: "follow", source: "link", context: record.name });
      toast({ title: "Joined", description: record.name });
      setLocation(`/outposts/c/${record.community_id}`);
    } catch (err) {
      toast({ title: "Couldn't join", description: String((err as Error)?.message ?? err), variant: "destructive" });
      setJoining(false);
    }
  }, [pubkey, naddr, fragment, bundle, setLocation, toast]);

  // Auto-join when the account was created FROM this invite (pending marker set
  // during the logged-out → sign-in bounce). Already-logged-in visitors instead
  // tap Join deliberately. Runs once, after the preview bundle has loaded.
  useEffect(() => {
    if (autoJoinedRef.current || !pubkey || !bundle) return;
    let pending = false;
    try { pending = sessionStorage.getItem(PENDING_KEY) === "1"; } catch {}
    if (!pending) return;
    // A brand-new account can reach here before the auth provider's effect has
    // registered the global signer (child effects run first). Consuming the
    // one-shot auto-join then would dead-end on "Sign in to join" — retry
    // shortly until the signer exists, THEN consume it.
    if (!getGlobalSigner()) {
      const t = setTimeout(() => setSignerTick((n) => n + 1), 250);
      return () => clearTimeout(t);
    }
    autoJoinedRef.current = true;
    join();
  }, [pubkey, bundle, join, signerTick]);

  // A logged-out visitor: preview first, then a focused sign-in that returns
  // here (App.tsx already stashed the full url incl. fragment + the pending
  // marker) and auto-joins once the account exists.
  const createAccount = () => setLocation("/login");

  if (bundle === undefined) {
    return <Wrap><Loader2 className="w-6 h-6 animate-spin text-muted-foreground/40 mx-auto" /><p className="text-sm text-muted-foreground/50 mt-3">Opening invite…</p></Wrap>;
  }
  if (bundle === null) {
    clearPending(); // a dead invite must never keep suppressing onboarding
    return <Wrap><Lock className="w-10 h-10 text-muted-foreground/30 mx-auto" /><p className="text-sm text-muted-foreground/70 mt-3">This invite is invalid, expired, or revoked.</p></Wrap>;
  }

  return (
    <Wrap>
      <p className="text-[11px] font-medium uppercase tracking-wider text-brand/60">You're invited to join</p>
      <Avatar className="w-16 h-16 mx-auto border border-primary/30 mt-3">
        <AvatarImage src={bundle.icon} />
        <AvatarFallback className="bg-brand/25 text-brand text-xl font-bold">{bundle.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <p className="text-lg font-bold mt-3">{bundle.name}</p>
      <p className="text-xs text-muted-foreground/60 mt-1 flex items-center justify-center gap-1.5">
        {/* Armada-style bundles ship channels: [] (the list lives in the encrypted
            governance stream and appears after joining) — "0 channels" read broken. */}
        <Lock className="w-3 h-3 text-muted-foreground/50" aria-hidden="true" /> {bundle.channels?.length
          ? `${bundle.channels.length} channel${bundle.channels.length !== 1 ? "s" : ""} · encrypted`
          : "Encrypted group chat"}
      </p>
      {!pubkey ? (
        <>
          <Button onClick={createAccount} className="w-full mt-5" data-testid="button-invite-create-account">
            <UserPlus className="w-4 h-4 mr-1.5" /> Create account to join
          </Button>
          <p className="text-[11px] text-muted-foreground/45 mt-2">Free, takes a few seconds. You'll land right in the chat.</p>
        </>
      ) : (
        <Button onClick={join} disabled={joining} className="w-full mt-5" data-testid="button-accept-invite">
          {joining ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Joining…</> : <><Check className="w-4 h-4 mr-1.5" /> Join group chat</>}
        </Button>
      )}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="max-w-sm mx-auto px-4 py-20 text-center">{children}</div>;
}
