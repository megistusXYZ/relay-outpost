/**
 * Incoming calls (owner, 2026-10-06): "Ana started a call in Bali crew" — a
 * calm banner with Join / Not now and a soft chime. Before, nothing told you
 * a call had started unless you were looking at that room.
 *
 * Only while Encrypted calls is on for this device; never for a muted group
 * or room; never for a call you're in; once per call (lib/concord/
 * call-ring.ts). Listens to each room you hold the key for — presence is
 * ephemeral, so only a live listener ever hears it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PhoneIncoming, X } from "lucide-react";
import { persistentPoolSubscribe } from "@/lib/nostr";
import { getCommunities, type StoredChannel, type StoredCommunity } from "@/lib/concord/concord-keys";
import { roomVoiceKeys } from "@/lib/concord/concord-voice";
import { subscribeCallPresence } from "@/lib/concord/concord-stream";
import { isCommunityMuted, isChannelMuted } from "@/lib/concord/concord-mute";
import { useConcordCallsEnabled } from "@/lib/concord/concord-prefs";
import { createRingDecider, QUIET_MS } from "@/lib/concord/call-ring";
import { effectiveTime } from "@/lib/concord/concord-events";
import { useConcordProfile } from "./ConcordIdentity";

interface Ringing { key: string; community: StoredCommunity; channel: StoredChannel; caller: string; at: number }

/** A short, soft two-note chime. Best effort: a browser may not let a page make sound before a tap. */
function chime(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const t0 = ctx.currentTime;
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + i * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.06, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    setTimeout(() => { void ctx.close().catch(() => {}); }, 1200);
  } catch { /* silent is fine */ }
}

function CallerName({ pubkey }: { pubkey: string }) {
  const { name } = useConcordProfile(pubkey);
  return <>{name}</>;
}

export function CallRinger({ me, inCallKey, onJoin }: {
  me: string;
  /** The room key of the call you're in, if any (callRoomKey). */
  inCallKey: string | null;
  onJoin: (community: StoredCommunity, channel: StoredChannel) => void;
}) {
  const enabled = useConcordCallsEnabled();
  const [communities, setCommunities] = useState<StoredCommunity[]>([]);
  const [ringing, setRinging] = useState<Ringing | null>(null);
  const inCallRef = useRef(inCallKey);
  inCallRef.current = inCallKey;
  const decider = useMemo(() => createRingDecider({ me }), [me]);

  useEffect(() => {
    if (!enabled) { setCommunities([]); return; }
    let live = true;
    const load = () => { void getCommunities(me).then((c) => { if (live) setCommunities(c); }).catch(() => {}); };
    load();
    const again = setInterval(load, 5 * 60_000); // new groups and rooms join the watch
    return () => { live = false; clearInterval(again); };
  }, [enabled, me]);

  useEffect(() => {
    if (!enabled) return;
    const subs: Array<{ close: () => void }> = [];
    for (const community of communities) {
      for (const channel of community.channels ?? []) {
        if (!roomVoiceKeys(community, channel)) continue; // no key, no call to join
        const key = `${community.community_id}:${channel.id}`;
        subs.push(subscribeCallPresence(community, channel, (rumor) => {
          const ring = decider.see({
            room: key,
            caller: rumor.pubkey,
            at: Date.now(),
            state: rumor.content === "left" ? "left" : "joined",
            sentAt: effectiveTime(rumor),
            muted: isCommunityMuted(community.community_id) || isChannelMuted(community.community_id, channel.id),
            inCall: inCallRef.current === key,
          });
          if (!ring) return;
          setRinging({ key, community, channel, caller: ring.caller, at: Date.now() });
          chime();
          if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
            try { new Notification("Incoming call", { body: `A call started in ${community.name || "your group"}`, tag: `call-${key}` }); } catch { /* not allowed here */ }
          }
        }, (relays, filter, onevent) => persistentPoolSubscribe(relays, filter, { onevent })));
      }
    }
    return () => { for (const s of subs) { try { s.close(); } catch { /* gone */ } } };
  }, [enabled, communities, decider]);

  // The banner goes when you join, or once the call has gone quiet.
  useEffect(() => {
    if (!ringing) return;
    if (inCallKey === ringing.key) { setRinging(null); return; }
    const t = setTimeout(() => setRinging(null), QUIET_MS);
    return () => clearTimeout(t);
  }, [ringing, inCallKey]);

  if (!enabled || !ringing) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+12px)] z-[300] flex w-[min(92vw,420px)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-emerald-500/30 bg-background/95 p-3 shadow-2xl backdrop-blur"
      data-testid="call-ring-banner"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <PhoneIncoming className="h-5 w-5" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold"><CallerName pubkey={ringing.caller} /></span> started a call in{" "}
        <span className="font-medium">{ringing.community.name || "your group"}</span>
        {ringing.channel.name ? <span className="text-muted-foreground"> · {ringing.channel.name}</span> : null}
      </p>
      <button
        type="button"
        onClick={() => { const r = ringing; setRinging(null); onJoin(r.community, r.channel); }}
        className="h-11 shrink-0 rounded-full bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-600/90"
        data-testid="call-ring-join"
      >
        Join
      </button>
      <button type="button" onClick={() => setRinging(null)} aria-label="Not now" title="Not now"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/50" data-testid="call-ring-dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>,
    document.body,
  );
}
