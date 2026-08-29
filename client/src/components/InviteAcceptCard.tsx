// Existing signed-in recipient "you were invited" prompt.
//
// A brand-new signup is handled entirely inside CreateAccountFlow (which
// auto-follows the inviter as the anchor, auto-joins the outpost, and then
// REMOVES the invite markers). This card is the counterpart for an
// ALREADY-signed-in user who opens an invite link — because new accounts
// consume the markers at creation, the two paths can never both act on the
// same signup.
//
// Flow: "follow" step → (one-tap Follow, using the SAME safe follow path as the
// Profile follow button — load durable base kind-3, append, publish; never a
// list-wiping 1-entry kind-3) → "sayhi" step (skippable prefilled DM) → done.
// Dismiss at any point clears the captured inviter so it never nags again.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, X } from "lucide-react";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Event } from "nostr-tools";
import {
  eventStore, publishEvent, fetchProfilesCached, getCachedProfile, verifySignedEventKind,
} from "@/lib/nostr";
import { KIND_FOLLOW_LIST, getDisplayName, getAvatarUrl } from "@/lib/nostr-helpers";
import { signWithTimeout } from "@/lib/signer-timeout";
import { loadFollowBase, cacheFollowEvent } from "@/lib/follow-list";
import { sendSayHiDM } from "@/lib/invite-links";
import { joinOutpostWithEnrichment } from "@/lib/outpost-relays";
import { readInviteConnect, clearInviteConnect, sayHiDefault, type InviteSource } from "@/lib/invite-connect";

const INVITER_KEY = "relay-outpost-inviter";

function readInviter(): string | null {
  try {
    return sessionStorage.getItem(INVITER_KEY) || null;
  } catch {
    return null;
  }
}

function clearInviter(): void {
  try { sessionStorage.removeItem(INVITER_KEY); } catch {}
  clearInviteConnect();
}

// Hex pubkey is 64 lowercase hex chars (parseInviteParams already decoded npub→hex).
function isValidHexPubkey(s: string | null): s is string {
  return !!s && /^[0-9a-f]{64}$/.test(s);
}

type Step = "follow" | "sayhi";

export function InviteAcceptCard() {
  const { pubkey, signer, follows, updateFollows } = useNostrAuth();
  const { toast } = useToast();

  const [inviterHex, setInviterHex] = useState<string | null>(() => readInviter());
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("follow");
  const [profile, setProfile] = useState<Event | null>(null);
  const [working, setWorking] = useState(false);
  const [hiText, setHiText] = useState(() => sayHiDefault());
  /** Which rail they arrived on — a forwardable link is worded differently. */
  const [source, setSource] = useState<InviteSource>("friend");
  /** The community relay to join — CONSENTED here, not auto-joined at signup. */
  const inviteRelayRef = useRef<string | null>(null);
  const relayJoinedRef = useRef(false);
  // Guards the gate effect from closing the card mid-advance. handleFollow does an
  // optimistic updateFollows() BEFORE the await, which re-runs the gate effect with
  // the inviter now in `follows` — without this it would clearInviter()+close and the
  // "sayhi" step would never render. Held true from the moment Follow is tapped and
  // for as long as we're on the say-hi step; cleared only on real close/dismiss.
  const advancingRef = useRef(false);

  // Decide whether to show. Gate: signed in, valid inviter, not self, and the
  // viewer is NOT already following the inviter. (App.tsx only mounts this when
  // NOT in the onboarding/new-account flow, so we don't re-check that here.)
  useEffect(() => {
    // Mid-advance (Follow tapped → say-hi): the optimistic follow update must not
    // trip the "already following → close" branch and eat the say-hi step.
    if (advancingRef.current) return;
    // Prefer the structured hand-off — both invite rails write it now: a brand-new
    // signup (already followed its inviter via the anchor) and a community-link
    // arrival. Fall back to the raw marker, which is an already-signed-in visitor
    // opening a plain friend link.
    const connect = readInviteConnect();
    const raw = connect?.inviter ?? readInviter();
    if (!isValidHexPubkey(raw) || !pubkey) {
      setOpen(false);
      return;
    }
    if (raw === pubkey) {
      // Self-invite — nothing to do; clear so it can't linger.
      clearInviter();
      setOpen(false);
      return;
    }
    const alreadyFollows = (follows ?? []).includes(raw);
    if (!connect && alreadyFollows) {
      // No hand-off and the follow already happened: nothing left to ask.
      clearInviter();
      setOpen(false);
      return;
    }
    // Skip straight to hello when the follow is already done — a fresh signup
    // followed its inviter at creation, so re-asking would be nonsense.
    const startAtHello = connect?.step === "sayhi" || alreadyFollows;
    setInviterHex(raw);
    setSource(connect?.source ?? "friend");
    inviteRelayRef.current = connect?.relay ?? null;
    setHiText(sayHiDefault(connect?.context));
    setStep(startAtHello ? "sayhi" : "follow");
    // Opening straight at the say-hi step means the user is typing in a box this
    // effect would otherwise re-render out from under them the next time `follows`
    // changes. Same guard the Follow tap uses, armed one step earlier.
    if (startAtHello) advancingRef.current = true;
    setProfile((getCachedProfile(raw) as Event | null) ?? null);
    fetchProfilesCached([raw]);
    setOpen(true);
  }, [pubkey, follows]);

  // Poll the eventStore for the inviter's profile until it hydrates.
  useEffect(() => {
    if (!open || !inviterHex || profile) return;
    const tick = () => {
      const ev = (eventStore.getReplaceable?.(0, inviterHex) ?? getCachedProfile(inviterHex)) as Event | null;
      if (ev) setProfile(ev);
    };
    tick();
    const id = setInterval(tick, 800);
    return () => clearInterval(id);
  }, [open, inviterHex, profile]);

  const name = profile ? getDisplayName(profile) : inviterHex ? `${inviterHex.slice(0, 8)}…` : "";
  const avatar = profile ? getAvatarUrl(profile) : undefined;

  const dismiss = () => {
    // "Maybe later" / close: clear so we never nag again this session. The
    // invite relay is deliberately NOT joined on dismiss — declining the invite
    // means declining its community.
    advancingRef.current = false;
    clearInviter();
    setOpen(false);
  };

  // Join the invited community relay — but only once, and only when the person
  // ENGAGED with the invite (followed, said hi, or skipped hi), never on
  // dismiss. This is the consent the old silent auto-join-at-signup skipped.
  const joinInviteRelayOnce = () => {
    const relay = inviteRelayRef.current;
    if (!relay || relayJoinedRef.current || !pubkey) return;
    relayJoinedRef.current = true;
    void joinOutpostWithEnrichment(relay, undefined, pubkey).catch(() => {});
  };

  // Follow the inviter via the EXACT safe path the Profile follow button uses:
  // load the authoritative durable base kind-3, append, sign, publish, re-cache.
  // Never publishes a 1-entry kind-3 that would wipe an existing follow list.
  const handleFollow = async () => {
    if (!pubkey || !signer || !inviterHex) return;
    // Arm the gate guard BEFORE the optimistic follow update below, so the gate
    // effect can't close the card while we advance to the say-hi step.
    advancingRef.current = true;
    setWorking(true);
    try {
      const { base, blocked } = await loadFollowBase(pubkey, follows?.length ?? 0);
      if (blocked) {
        advancingRef.current = false; // not advancing — let the gate resume
        toast({
          title: "Couldn't load your follow list",
          description: "Try again in a moment — your follows are safe, we just need to fetch the list first.",
          variant: "destructive",
        });
        return;
      }

      const existingTags: string[][] = base ? [...base.tags] : [];
      const alreadyHas = existingTags.some((t) => t[0] === "p" && t[1] === inviterHex);
      const newTags = alreadyHas ? existingTags : [...existingTags, ["p", inviterHex]];

      const event = {
        kind: KIND_FOLLOW_LIST,
        created_at: Math.floor(Date.now() / 1000),
        tags: newTags,
        content: base?.content || "",
      };

      // Optimistic local update so the gate (already-following) holds afterwards.
      updateFollows((prev) => (prev.includes(inviterHex) ? prev : [...prev, inviterHex]));

      const signed = await signWithTimeout(signer, event);
      if (!verifySignedEventKind(signed, KIND_FOLLOW_LIST)) {
        advancingRef.current = false; // reverting the optimistic follow — not advancing
        toast({ title: "Signer error", description: "Your signer modified the event type — follow was not updated.", variant: "destructive" });
        updateFollows((prev) => prev.filter((pk) => pk !== inviterHex));
        return;
      }
      await publishEvent(signed as Event);
      cacheFollowEvent(signed as Event, { force: true }); // keep durable base current with user intent

      // They accepted the invite — now it's consented to join its community.
      joinInviteRelayOnce();
      toast({ title: `Following ${name}` });
      setStep("sayhi");
    } catch (err) {
      advancingRef.current = false; // reverting the optimistic follow — not advancing
      console.error("Invite follow failed:", err);
      updateFollows((prev) => prev.filter((pk) => pk !== inviterHex));
      toast({ title: "Couldn't follow", variant: "destructive" });
    } finally {
      setWorking(false);
    }
  };

  const handleSayHi = async () => {
    if (!pubkey || !signer || !inviterHex) return;
    setWorking(true);
    try {
      // A fresh signup opens straight here (already auto-followed the inviter),
      // so sending hi is its positive-engagement signal to join the community.
      joinInviteRelayOnce();
      const res = await sendSayHiDM({ signer, senderPubkey: pubkey, inviterHex, content: hiText });
      if (res.success) {
        toast({ title: "Sent!", description: `Said hi to ${name}.` });
      } else {
        toast({ title: "Couldn't send", description: res.error || "Try again from Messages.", variant: "destructive" });
      }
    } catch (err) {
      console.error("Invite say-hi failed:", err);
      toast({ title: "Couldn't send", variant: "destructive" });
    } finally {
      setWorking(false);
      advancingRef.current = false;
      clearInviter();
      setOpen(false);
    }
  };

  const skipSayHi = () => {
    // Following already closed the main loop; sending hi is optional. They
    // engaged with the invite (reached this step), so the community join is
    // consented even when they skip the message.
    joinInviteRelayOnce();
    advancingRef.current = false;
    clearInviter();
    setOpen(false);
  };

  if (!open || !inviterHex) return null;

  // Non-blocking banner (was a full-screen dimming modal). It floats just below
  // the app header without a backdrop or focus trap, so an invitee who opened a
  // deep link lands ON the content they came for (a chat channel, a profile) and
  // sees the Follow prompt alongside it — never buried behind it. Anchored top
  // (not bottom) so it can't collide with the chat composer / bottom nav on
  // mobile. `pointer-events-none` on the wrapper lets taps pass through to the
  // content around the card; the card itself re-enables them.
  return (
    <div
      className="fixed inset-x-0 top-[calc(4.25rem+env(safe-area-inset-top,0px))] z-[60] px-3 pointer-events-none md:top-[calc(3.5rem+env(safe-area-inset-top,0px))]"
      data-testid="invite-accept-card"
    >
      <div className="pointer-events-auto mx-auto w-full max-w-md rounded-2xl border border-border/40 bg-background/95 backdrop-blur shadow-lg shadow-black/25 p-3 animate-in fade-in slide-in-from-top-2 duration-200">
        {step === "follow" ? (
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10 shrink-0">
              <AvatarImage src={avatar} />
              <AvatarFallback className="text-xs">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              {/* A community link can be forwarded or scanned off a QR, so
                  claiming it was addressed to this reader would be a lie —
                  say what we actually know: who made it. */}
              <p className="text-sm font-semibold truncate">{source === "link" ? `${name} created this invite` : `${name} invited you`}</p>
              <p className="text-xs text-muted-foreground truncate">Follow to connect</p>
            </div>
            <Button
              onClick={handleFollow}
              disabled={working}
              size="sm"
              className="min-h-[40px] shrink-0"
              data-testid="button-invite-follow"
            >
              {working ? <Loader2 className="w-4 h-4 animate-spin" /> : "Follow"}
            </Button>
            <button
              onClick={dismiss}
              disabled={working}
              className="p-1.5 -mr-1 text-muted-foreground/60 hover:text-foreground shrink-0"
              aria-label="Dismiss invite"
              data-testid="button-invite-dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold truncate">Say hi to {name}?</p>
              <button
                onClick={skipSayHi}
                disabled={working}
                className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                data-testid="button-invite-sayhi-skip"
              >
                Skip
              </button>
            </div>
            <Textarea
              value={hiText}
              onChange={(e) => setHiText(e.target.value)}
              rows={2}
              className="resize-none text-sm"
              aria-label={`Message to ${name}`}
              data-testid="input-invite-sayhi"
            />
            <Button
              onClick={handleSayHi}
              disabled={working || !hiText.trim()}
              size="sm"
              className="min-h-[40px] w-full"
              data-testid="button-invite-sayhi-send"
            >
              {working ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Send
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
