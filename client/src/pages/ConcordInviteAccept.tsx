/**
 * Accept a Concord invite link (CORD-05). The URL fragment (secret token) is
 * read client-side and never sent anywhere. Shows the community preview from the
 * decrypted bundle, then joins on tap.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Lock, Loader2, Check, UserPlus, WifiOff, SearchX, Link2Off, Clock, RotateCw } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { persistentPoolSubscribe, publishEvent } from "@/lib/nostr";
import { getActiveDefaultRelays } from "@/lib/outpost-relays";
import { canReachAny } from "@/lib/relay-reach";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { forceEnableConcord } from "@/lib/concord/concord-prefs";
import { decodeFragment, acceptInviteLink, pickBundleEvent } from "@/lib/concord/concord-invites";
import { classifyInviteFetch, type InviteLookup } from "@/lib/concord/invite-resolve";
import { getCommunity } from "@/lib/concord/concord-keys";
import { inviterFromCreator, setInviteConnect } from "@/lib/invite-connect";
import { KIND_INVITE_BUNDLE } from "@/lib/concord/concord-events";
import { nip19, type Event } from "nostr-tools";

const PENDING_KEY = "relay-outpost-concord-invite-pending";
const clearPending = () => { try { sessionStorage.removeItem(PENDING_KEY); } catch {} };

/** While the group's relays can't be reached, look again this often, this many times (a minute). */
const RETRY_MS = 5_000;
const AUTO_RETRIES = 12;

export default function ConcordInviteAccept({ naddr }: { naddr: string }) {
  const { pubkey } = useNostrAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [lookup, setLookup] = useState<InviteLookup | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);
  const autoJoinedRef = useRef(false);
  // Bumped on a short timer while the global signer isn't registered yet, so
  // the auto-join effect below re-runs instead of dead-ending (see comment).
  const [signerTick, setSignerTick] = useState(0);
  const fragment = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  const bundle = lookup && (lookup.status === "ok" || lookup.status === "expired") ? lookup.bundle : null;
  // Already in this group? Then the invite only opens it; your keys stay yours.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!pubkey || !bundle?.community_id) { setHeld(false); return; }
    let cancelled = false;
    getCommunity(pubkey, bundle.community_id).then((r) => { if (!cancelled) setHeld(!!r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pubkey, bundle?.community_id]);

  // You can't gate someone out of a link they were handed — flip the flag on so
  // this page and the outpost they land in are enabled even if they'd killed it.
  useEffect(() => { forceEnableConcord(); }, []);

  // Fetch + decrypt the bundle for preview. A lookup has three outcomes, not
  // two: the bundle, relays that answered without it, and relays we never
  // reached. "Invalid, expired, or revoked" used to cover all of them, so a
  // good link met on a bad connection read as dead and got thrown away.
  useEffect(() => {
    const frag = decodeFragment(fragment);
    let decoded: nip19.DecodedResult | null = null;
    try { decoded = nip19.decode(naddr); } catch {}
    if (!frag || !decoded || decoded.type !== "naddr" || decoded.data.kind !== KIND_INVITE_BUNDLE) {
      setLookup({ status: "broken" }); return;
    }
    const linkSigner = decoded.data.pubkey;
    const relays = [...new Set([...(decoded.data.relays ?? []), ...frag.relays])];
    let cancelled = false;
    let sub: { close: () => void } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      if (!(await canReachAny(relays))) { if (!cancelled) setLookup({ status: "unreachable" }); return; }
      if (cancelled) return;
      // Every version at the link's address, not only the newest: a tombstone
      // seen anywhere means the link was turned off (pickBundleEvent).
      const seen: Event[] = [];
      sub = persistentPoolSubscribe(relays, { kinds: [KIND_INVITE_BUNDLE], authors: [linkSigner], "#d": [""] }, {
        onevent: (e: Event) => { seen.push(e); },
      });
      timer = setTimeout(() => {
        sub?.close();
        if (!cancelled) setLookup(classifyInviteFetch({ reached: true, event: pickBundleEvent(seen) }, frag.token));
      }, 3500);
    })();
    return () => { cancelled = true; clearTimeout(timer); sub?.close(); };
  }, [naddr, fragment, attempt]);

  // Unreachable relays usually come back: keep looking for a minute.
  useEffect(() => {
    if (lookup?.status !== "unreachable" || attempt >= AUTO_RETRIES) return;
    const t = setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
    return () => clearTimeout(t);
  }, [lookup, attempt]);

  // Only a proven dead end releases the onboarding hold; a lookup that may
  // still succeed keeps it, so the auto-join can land when it does.
  useEffect(() => {
    if (lookup?.status === "revoked" || lookup?.status === "broken" || lookup?.status === "expired") clearPending();
  }, [lookup]);

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
          const seen: Event[] = [];
          const sub = persistentPoolSubscribe(set, { kinds: [KIND_INVITE_BUNDLE], authors: [linkSigner], "#d": [""] }, {
            onevent: (e: Event) => { seen.push(e); },
          });
          setTimeout(() => { sub.close(); resolve(pickBundleEvent(seen)); }, 3500);
        });
      };
      const result = await acceptInviteLink(pubkey, signer, naddr, fragment, fetchBundle, (e, r) => publishEvent(e, r), (e) => publishEvent(e, relays));
      clearPending();
      if (!result) {
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
      if (result.status === "invalid") {
        toast({ title: "This invite didn't check out", description: "Its group details don't match the group's owner. Ask for a new link.", variant: "destructive" });
        setJoining(false);
        return;
      }
      if (result.status === "unverified") {
        // The owner's own record didn't open with this invite's keys, or the
        // relays haven't handed it over yet. Nothing was kept; try again.
        toast({ title: "Couldn't confirm this group yet", description: "We couldn't read the group's own record with this invite. The relays may be slow. Try again in a moment." });
        setJoining(false);
        return;
      }
      if (result.status === "already") {
        toast({
          title: "You're already in this group",
          description: result.kept
            ? "This link carried older keys, so yours were kept."
            : result.added > 0 ? `Added ${result.added} room${result.added === 1 ? "" : "s"} you were missing.` : result.record.name,
        });
        setLocation(`/outposts/c/${result.record.community_id}`);
        return;
      }
      const record = result.record;
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
    if (autoJoinedRef.current || !pubkey || lookup?.status !== "ok") return;
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
  }, [pubkey, lookup, join, signerTick]);

  // A logged-out visitor: preview first, then a focused sign-in that returns
  // here (App.tsx already stashed the full url incl. fragment + the pending
  // marker) and auto-joins once the account exists.
  const createAccount = () => setLocation("/login");
  const tryAgain = () => { setLookup(undefined); setAttempt((n) => n + 1); };

  if (lookup === undefined) {
    return <Wrap><Loader2 className="w-6 h-6 animate-spin text-muted-foreground/40 mx-auto" /><p className="text-sm text-muted-foreground/50 mt-3">Opening invite…</p></Wrap>;
  }
  if (lookup.status === "unreachable") {
    const retrying = attempt < AUTO_RETRIES;
    return (
      <Dead icon={WifiOff} title="Couldn't reach this group's relays" testId="invite-unreachable"
        body={retrying ? "The invite may be fine. Trying again…" : "The invite may be fine. Check your connection and try again."}
        action={retrying ? undefined : tryAgain} />
    );
  }
  if (lookup.status === "missing") {
    return (
      <Dead icon={SearchX} title="We couldn't find this invite" testId="invite-missing"
        body="The relays we reached don't have it. It may have been turned off, or it hasn't reached them yet."
        action={tryAgain} />
    );
  }
  if (lookup.status === "revoked") {
    return <Dead icon={Link2Off} title="This invite link was turned off" body="Ask whoever sent it for a new one." testId="invite-revoked" />;
  }
  if (!bundle) {
    return <Dead icon={Lock} title="This invite link is incomplete" body="Part of the link is missing or damaged. Ask for a new one." testId="invite-broken" />;
  }

  const expired = lookup.status === "expired";
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
      {held ? (
        <Button onClick={() => setLocation(`/outposts/c/${bundle.community_id}`)} className="w-full mt-5" data-testid="button-invite-open-held">
          <Check className="w-4 h-4 mr-1.5" /> You're in · Open group chat
        </Button>
      ) : expired ? (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left" data-testid="invite-expired">
          <p className="text-sm font-medium flex items-center gap-1.5"><Clock className="w-4 h-4 text-amber-500 shrink-0" aria-hidden="true" /> This invite expired</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            It stopped letting people join on {new Date(bundle.expires_at!).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. Ask whoever sent it for a new one.
          </p>
        </div>
      ) : !pubkey ? (
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

/** An invite we can't open, saying which of the reasons it is. */
function Dead({ icon: Icon, title, body, action, testId }: {
  icon: React.ComponentType<{ className?: string }>; title: string; body: string; action?: () => void; testId: string;
}) {
  return (
    <Wrap>
      <div data-testid={testId}>
        <Icon className="w-10 h-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm font-medium text-foreground/90 mt-3">{title}</p>
        <p className="text-xs text-muted-foreground/60 mt-1">{body}</p>
        {action && (
          <Button variant="outline" onClick={action} className="mt-4 gap-1.5" data-testid="button-invite-retry">
            <RotateCw className="w-3.5 h-3.5" /> Try again
          </Button>
        )}
      </div>
    </Wrap>
  );
}
