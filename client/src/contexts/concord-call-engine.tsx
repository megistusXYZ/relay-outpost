/**
 * The one group-chat call you're in (Concord CORD-07), kept at the app level so
 * it survives moving between rooms and pages, like Armada's.
 *
 * LiveKit (12 MB) loads only when you join. While you're in a call:
 * - your seat is announced to the room every 30 seconds;
 * - everyone's presence is folded into a roster;
 * - each seat on the media server gets its real frame key only when exactly one
 *   member claims it (planCallerKeys), so an unverified caller never plays
 *   under someone else's name;
 * - this provider plays everyone's audio, so you keep hearing the call on any page.
 * Off the call's room, a small draggable bar keeps it in reach.
 */
import { useLeaveWhenCallsOff } from "@/lib/concord/calls-off";
import { useConcordCallsEnabled } from "@/lib/concord/concord-prefs";
import { callTrouble, useCallAudio, type AudioRoom } from "@/lib/concord/call-trouble";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setCallActive } from "@/lib/call-presence";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { GripVertical, Maximize2, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import type { Room, RemoteTrack } from "livekit-client";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { persistentPoolSubscribe, publishEvent } from "@/lib/nostr";
import { getCommunity, type StoredChannel, type StoredCommunity } from "@/lib/concord/concord-keys";
import { useToast } from "@/hooks/use-toast";
import { effectiveTime } from "@/lib/concord/concord-events";
import { roomVoiceKeys, callerFrameKey, type VoiceKeys } from "@/lib/concord/concord-voice";
import { callRoster, matchCallers } from "@/lib/concord/concord-presence";
import { planCallerKeys, startPresenceHeartbeat, callerLabel, callKeysForRoom, type CallerLabel, type KeyState } from "@/lib/concord/concord-call";
import { publishCallPresence, subscribeCallPresence } from "@/lib/concord/concord-stream";
import type { JoinedCall } from "@/lib/concord/concord-call-e2ee";

import { callRoomKey, type ActiveCall, type CallParticipant, type CallCtx } from "./ConcordCallContext";
import { CallRinger } from "@/components/concord/CallRinger";
import { syncClosedAppRooms, takeClosedAppNotifyOffer, turnOnClosedAppNotify } from "@/lib/push-notify";
import { useNotifications } from "@/contexts/NotificationContext";
import { ToastAction } from "@/components/ui/toast";
import { MUTE_CHANGED_EVENT } from "@/lib/concord/concord-mute";
import { chooseCallService, probeCallService, callServicesIn, agreedCallServices, agreeCallService } from "@/lib/concord/concord-av-brokers";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

/** Presence older than this can't change the roster (a "joined" goes stale at 90s). */
const RUMOR_KEEP_MS = 3 * 60 * 1000;
const RESYNC_MS = 5_000;
/** How often an ongoing call re-reads its group for a rekey (someone removed). */
const KEY_CHECK_MS = 10_000;

type PresenceRumor = { kind: number; pubkey: string; content: string; created_at: number; tags: string[][] };

interface Session {
  /** Our own pubkey: the member behind our seat. */
  ownPubkey: string;
  community: StoredCommunity;
  channel: StoredChannel;
  title: string;
  keys: VoiceKeys;
  /** The call service this call is on. */
  brokerOrigin: string;
  joined: JoinedCall;
  room: Room;
  applied: Map<string, KeyState>;
  rumors: PresenceRumor[];
  firstSeen: Map<string, number>;
  audio: HTMLDivElement;
  stopBeat: () => Promise<void>;
  closePresence: () => void;
  tick: ReturnType<typeof setInterval>;
  /** Re-reads the group so a rekey moves the call (or ends it for us). */
  keyCheck?: ReturnType<typeof setInterval>;
  checking?: boolean;
}

/**
 * The call engine: the session, presence, keys and the floating bar. It
 * renders only the bar and hands its value up to ConcordCallContext, which
 * loads this as its own chunk once someone is signed in — a visitor never
 * downloads the group-chat library this leans on.
 */
export default function ConcordCallEngine({ onChange }: { onChange: (value: CallCtx) => void }) {
  const { pubkey } = useNostrAuth();
  const [, navigate] = useLocation();
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onScreen, setOnScreen] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const { toast } = useToast();
  /** "Join this call on armada.buzz?" — asked once per group before using another app's service. */
  const [asking, setAsking] = useState<{ host: string; answer: (ok: boolean) => void } | null>(null);

  /** Re-decide every seat's key and redraw the callers. Cheap; runs on every room event and every 5s. */
  const resync = useCallback(() => {
    const s = session.current;
    if (!s) return;
    const now = Date.now();
    s.rumors = s.rumors.filter((r) => now - effectiveTime(r) < RUMOR_KEEP_MS);
    const roster = callRoster(s.rumors, now);
    const remote = [...s.room.remoteParticipants.values()];
    const seats = [s.joined.identity, ...remote.map((p) => p.identity), ...[...roster.values()].map((seat) => seat.identity)];
    for (const step of planCallerKeys({ own: s.joined.identity, present: seats, roster, applied: s.applied })) {
      // Recorded before the install lands, so a burst of resyncs installs once.
      s.applied.set(step.identity, step.want);
      void s.joined.keyProvider
        .setCallerKey(callerFrameKey(s.keys.mediaKey, step.identity, step.want === "sender"), step.identity)
        .catch(() => s.applied.delete(step.identity));
    }
    const matches = matchCallers(roster, remote.map((p) => p.identity));
    for (const p of remote) if (!s.firstSeen.has(p.identity)) s.firstSeen.set(p.identity, now);
    const local = s.room.localParticipant;
    const participants: CallParticipant[] = [
      {
        identity: s.joined.identity, label: { kind: "member", pubkey: s.ownPubkey }, isLocal: true,
        speaking: local.isSpeaking, micOn: local.isMicrophoneEnabled, cameraOn: local.isCameraEnabled, sharing: local.isScreenShareEnabled,
      },
      ...remote.map((p, i) => ({
        identity: p.identity,
        label: callerLabel(matches[i], s.firstSeen.get(p.identity) ?? now, now),
        isLocal: false,
        speaking: p.isSpeaking,
        micOn: p.isMicrophoneEnabled,
        cameraOn: p.isCameraEnabled,
        sharing: p.isScreenShareEnabled,
      })),
    ];
    setCall({
      communityId: s.community.community_id,
      channelId: s.channel.id,
      title: s.title,
      participants,
      micOn: local.isMicrophoneEnabled,
      cameraOn: local.isCameraEnabled,
      sharing: local.isScreenShareEnabled,
      room: s.room,
    });
  }, []);

  const leave = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    setCallActive(false);
    clearInterval(s.tick);
    if (s.keyCheck) clearInterval(s.keyCheck);
    s.closePresence();
    await s.stopBeat();
    await s.room.disconnect().catch(() => {});
    s.joined.worker.terminate();
    s.audio.remove();
    setCall(null);
    // A mic or camera trouble from this call isn't news after it ends.
    setError(null);
  }, []);

  /** One join at a time: a second (the ringer's Join while the first waits on the question) would strand the first. */
  const joiningNow = useRef(false);
  const join = useCallback(async (community: StoredCommunity, channel: StoredChannel, title: string,
    /** A rejoin after a rekey: the service the call was on, so the question isn't asked again mid-call. */
    rejoinOn?: string) => {
    if (joiningNow.current) return;
    joiningNow.current = true;
    // Through the ref: the latest render's joinOnce, never a stale one.
    try { await joinOnceRef.current(community, channel, title, rejoinOn); } finally { joiningNow.current = false; }
  }, []);
  const joinOnce = async (community: StoredCommunity, channel: StoredChannel, title: string, rejoinOn?: string) => {
    if (session.current) await leave();
    const signer = getGlobalSigner();
    if (!pubkey || !signer) { setError("Sign in to join the call"); return; }
    const keys = roomVoiceKeys(community, channel);
    if (!keys) { setError("You don't hold this room's key, so you can't join its call"); return; }
    setJoining(true);
    setError(null);
    try {
      // Where the call is (CORD-07 §5): the group's listed services, or where
      // people already are, or ours. Another app's only once you've agreed.
      const own = window.location.origin;
      const choice = await chooseCallService({
        room: keys.room,
        listed: community.avBrokers ?? [],
        present: callServicesIn(callRoomKey(community.community_id, channel.id), Date.now()),
        own,
        agreed: agreedCallServices(community.community_id),
        probe: (origin) => probeCallService(origin),
        // Asked before anything is sent to another app's service.
        // A rejoin keeps the earlier answer: on ours, stay on ours; on theirs, it was already agreed.
        consent: rejoinOn !== undefined ? async () => rejoinOn !== own : (origins) => new Promise<boolean>((answer) => {
          setAsking({ host: origins.map((o) => new URL(o).host).join(" or "), answer: (ok) => { setAsking(null); answer(ok); } });
        }),
      });
      if (!choice) { setError("This group's call service isn't answering. Try again in a moment."); return; }
      for (const origin of choice.agreedTo) agreeCallService(community.community_id, origin);
      const brokerOrigin = choice.origin;
      const [{ joinCall }, lk, workerModule] = await Promise.all([
        import("@/lib/concord/concord-call-e2ee"),
        import("livekit-client"),
        import("livekit-client/e2ee-worker?worker"),
      ]);
      const joined = await joinCall({
        keys,
        brokerOrigin,
        now: () => Math.floor(Date.now() / 1000),
        fetch: window.fetch.bind(window),
        startWorker: () => new workerModule.default(),
        createRoom: (e2ee) => new lk.Room({ e2ee, adaptiveStream: true, dynacast: true }) as never,
      });
      const room = joined.room as unknown as Room;
      setCallActive(true);

      // Everyone's audio plays here, so the call keeps sounding on any page.
      const audio = document.createElement("div");
      audio.hidden = true;
      audio.dataset.testid = "concord-call-audio";
      document.body.appendChild(audio);
      room.on(lk.RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === lk.Track.Kind.Audio) audio.appendChild(track.attach());
      });
      room.on(lk.RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => { track.detach().forEach((el) => el.remove()); });

      const heartbeat = startPresenceHeartbeat({
        announce: (presence) => publishCallPresence(signer, pubkey, community, channel, presence, (e, relays) => publishEvent(e, relays)),
        identity: joined.identity,
        broker: brokerOrigin,
      });
      const s: Session = {
        ownPubkey: pubkey, community, channel, title, keys, brokerOrigin, joined, room,
        applied: new Map(), rumors: [], firstSeen: new Map(), audio,
        stopBeat: heartbeat.stop,
        closePresence: () => {},
        tick: setInterval(() => resync(), RESYNC_MS),
      };
      const presence = subscribeCallPresence(community, channel, (rumor) => { s.rumors.push(rumor as PresenceRumor); resync(); },
        (relays, filter, onevent) => persistentPoolSubscribe(relays, filter, { onevent }));
      s.closePresence = () => presence.close();
      session.current = s;

      for (const ev of [
        lk.RoomEvent.ParticipantConnected, lk.RoomEvent.ParticipantDisconnected, lk.RoomEvent.TrackSubscribed,
        lk.RoomEvent.TrackUnsubscribed, lk.RoomEvent.TrackMuted, lk.RoomEvent.TrackUnmuted, lk.RoomEvent.ActiveSpeakersChanged,
        lk.RoomEvent.LocalTrackPublished, lk.RoomEvent.LocalTrackUnpublished,
      ]) room.on(ev, resync);
      room.on(lk.RoomEvent.Disconnected, () => { if (session.current === s) void leave(); });

      // Joined MUTED: tapping Call by accident, or joining to listen, never
      // opens the mic. The first unmute asks for microphone permission.

      // A rekey (someone removed) rolls the call keys with the room's keys
      // (CORD-07 §1): the call moves to the new room, and whoever lost the
      // room's key leaves. Re-read the stored group while in the call, on or
      // off its room. A failed read is retried, never taken as "no access".
      s.keyCheck = setInterval(async () => {
        if (session.current !== s || s.checking) return;
        s.checking = true;
        try {
          let stored: StoredCommunity | null;
          try { stored = await getCommunity(s.ownPubkey, s.community.community_id); } catch { return; }
          if (session.current !== s) return;
          const latest = stored?.channels.find((c) => c.id === s.channel.id);
          const decision = stored ? callKeysForRoom(s.keys, stored, latest) : "leave";
          if (decision === "rejoin" && stored && latest) {
            await joinRef.current(stored, latest, s.title, s.brokerOrigin);
            toast({ title: "Call secured again", description: "The group's keys changed, so the call moved to its new room." });
          } else if (decision === "leave") {
            await leave();
            setError("You no longer have access to this room, so the call ended");
          }
        } finally {
          s.checking = false;
        }
      }, KEY_CHECK_MS);
      resync();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setJoining(false);
    }
  };
  const joinOnceRef = useRef(joinOnce);
  joinOnceRef.current = joinOnce;
  const joinRef = useRef(join);
  joinRef.current = join;

  const toggle = useCallback(async (which: "mic" | "camera" | "screen") => {
    const s = session.current;
    if (!s) return;
    const lp = s.room.localParticipant;
    try {
      if (which === "mic") await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
      if (which === "camera") await lp.setCameraEnabled(!lp.isCameraEnabled);
      if (which === "screen") await lp.setScreenShareEnabled(!lp.isScreenShareEnabled);
      setError(null);
    } catch (err) {
      // In plain words, with what to do (lib/concord/call-trouble.ts) — and
      // shown in the call itself, not only before joining.
      setError(callTrouble(err, which));
    }
    resync();
  }, [resync]);

  // The first message or call that arrives while the app is open: offer to
  // tell you about them when it's closed, once (lib/push-notify.ts).
  const offerClosedApp = useCallback(() => {
    if (!pubkey) return;
    const readiness = takeClosedAppNotifyOffer();
    if (readiness === "install-first") {
      toast({ title: "Want to know about calls and messages when Relay Outpost is closed?", description: "Add it to your Home Screen (Share › Add to Home Screen), then turn it on in Settings › Chats." });
    } else if (readiness === "ready") {
      toast({
        title: "Want to know about calls and messages when Relay Outpost is closed?",
        description: "It only ever says \"New message\" or \"Call in\" a group — never who or what.",
        action: (
          <ToastAction altText="Turn on notifications" data-testid="offer-closed-app-notify"
            onClick={() => { void turnOnClosedAppNotify(pubkey).then((r) => { if (!r.ok && r.reason === "denied") toast({ title: "Notifications are blocked for this site", description: "Allow them in your browser's settings, then turn this on in Settings › Chats." }); }); }}>
            Turn on
          </ToastAction>
        ),
      });
    }
  }, [pubkey, toast]);
  const { unreadDmCount } = useNotifications();
  const seenUnread = useRef(unreadDmCount);
  useEffect(() => {
    if (unreadDmCount > seenUnread.current) offerClosedApp();
    seenUnread.current = unreadDmCount;
  }, [unreadDmCount, offerClosedApp]);

  // Signing out, or closing the tab, ends the call.
  useEffect(() => { if (!pubkey) void leave(); }, [pubkey, leave]);
  // …and so does switching Encrypted calls off (lib/concord/calls-off.ts).
  const callsOn = useConcordCallsEnabled();
  const leaveNow = useCallback(() => { void leave(); }, [leave]);
  useLeaveWhenCallsOff(callsOn, !!call, leaveNow);
  // Notifications while the app is closed: keep the rooms that ring this
  // device current — calls switched, a group muted, a new group (lib/push-notify.ts).
  useEffect(() => {
    if (!pubkey) return;
    const sync = () => { void syncClosedAppRooms(pubkey).catch(() => {}); };
    sync();
    window.addEventListener(MUTE_CHANGED_EVENT, sync);
    const again = setInterval(sync, 5 * 60_000);
    return () => { window.removeEventListener(MUTE_CHANGED_EVENT, sync); clearInterval(again); };
  }, [pubkey, callsOn]);

  useEffect(() => () => { void leave(); }, [leave]);

  const value = useMemo<CallCtx>(() => ({
    call, joining, error, join, leave,
    toggleMic: () => toggle("mic"),
    toggleCamera: () => toggle("camera"),
    toggleScreen: () => toggle("screen"),
    setOnScreen,
  }), [call, joining, error, join, leave, toggle]);
  useEffect(() => { onChange(value); }, [value, onChange]);

  return (
    <>
      {call && onScreen !== callRoomKey(call.communityId, call.channelId)
        ? <FloatingCallBar call={call} error={error} onToggleMic={value.toggleMic} onLeave={leave} />
        : null}
      <AlertDialog open={!!asking} onOpenChange={(open) => { if (!open) asking?.answer(false); }}>
        <AlertDialogContent className="z-[320]" overlayClassName="z-[320]" data-testid="call-service-ask">
          <AlertDialogHeader>
            <AlertDialogTitle>Join this call on {asking?.host}?</AlertDialogTitle>
            <AlertDialogDescription>
              This group's calls run on {asking?.host}, another app's call service. The call stays end-to-end encrypted:
              that service can see when you join, not what's said. Using Relay Outpost's instead may put you in a separate call.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => asking?.answer(false)} data-testid="call-service-ours">Use Relay Outpost's</AlertDialogCancel>
            <AlertDialogAction onClick={() => asking?.answer(true)} data-testid="call-service-there">Join there</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* "Ana started a call in Bali crew" — Join / Not now (components/concord/CallRinger). */}
      {pubkey && (
        <CallRinger
          me={pubkey}
          inCallKey={call ? callRoomKey(call.communityId, call.channelId) : null}
          onRing={offerClosedApp}
          onJoin={(community, channel) => {
            navigate(`/outposts/c/${community.community_id}?channel=${channel.id}`);
            void join(community, channel, channel.name || community.name || "Call");
          }}
        />
      )}
    </>
  );
}

const CARD_W = 260;
const CARD_H = 52;
const MARGIN = 12;
const BOTTOM_NAV = 92; // leave room above the mobile bottom nav

function clampPos(x: number, y: number) {
  return {
    x: Math.max(MARGIN, Math.min(x, window.innerWidth - CARD_W - MARGIN)),
    y: Math.max(MARGIN, Math.min(y, window.innerHeight - CARD_H - MARGIN)),
  };
}

/** The call in reach while you're elsewhere: who's talking, mute, back to the room, leave. */
function FloatingCallBar({ call, error, onToggleMic, onLeave }: { call: ActiveCall; error: string | null; onToggleMic: () => Promise<void>; onLeave: () => Promise<void> }) {
  const [, navigate] = useLocation();
  const sound = useCallAudio(call.room as unknown as AudioRoom);
  const [pos, setPos] = useState(() => clampPos(window.innerWidth - CARD_W - MARGIN, window.innerHeight - CARD_H - MARGIN - BOTTOM_NAV));
  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p.x, p.y));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const back = () => {
    if (drag.current?.moved) return;
    navigate(`/outposts/c/${call.communityId}?channel=${call.channelId}`);
  };
  const others = call.participants.length - 1;
  return createPortal(
    <div
      className="fixed z-[60] flex h-[52px] w-[260px] items-center gap-1.5 rounded-full border border-border/50 bg-background/95 pl-1.5 pr-2 shadow-2xl shadow-black/30 backdrop-blur select-none"
      style={{ left: pos.x, top: pos.y, touchAction: "none" }}
      data-testid="concord-call-floating"
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false }; }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const nx = e.clientX - drag.current.dx, ny = e.clientY - drag.current.dy;
        if (Math.abs(nx - pos.x) > 4 || Math.abs(ny - pos.y) > 4) drag.current.moved = true;
        setPos(clampPos(nx, ny));
      }}
      onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50" />
      <button onClick={back} className="min-w-0 flex-1 text-left" data-testid="concord-call-floating-back">
        <p className="truncate text-sm font-medium leading-tight">{call.title}</p>
        {error
          ? <p className="truncate text-[11px] text-destructive" title={error} data-testid="concord-call-floating-error">{error}</p>
          : <p className="truncate text-[11px] text-muted-foreground">In call{others > 0 ? ` · ${others} other${others === 1 ? "" : "s"}` : ""}</p>}
      </button>
      {sound.blocked && (
        <button onClick={() => void sound.start()} aria-label="Tap to hear the call" title="Tap to hear the call" data-testid="concord-call-floating-hear"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground">
          <Volume2 className="h-4 w-4" />
        </button>
      )}
      <button onClick={() => void onToggleMic()} aria-label={call.micOn ? "Mute" : "Unmute"}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${call.micOn ? "bg-muted text-foreground" : "bg-destructive/15 text-destructive"}`}>
        {call.micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </button>
      <button onClick={back} aria-label="Back to the call" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
        <Maximize2 className="h-4 w-4" />
      </button>
      <button onClick={() => void onLeave()} aria-label="Leave the call" data-testid="concord-call-floating-leave"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
        <PhoneOff className="h-4 w-4" />
      </button>
    </div>,
    document.body,
  );
}
