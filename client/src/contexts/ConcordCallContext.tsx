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
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { GripVertical, Maximize2, Mic, MicOff, PhoneOff } from "lucide-react";
import type { Room, RemoteTrack } from "livekit-client";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { getGlobalSigner } from "@/lib/nip42-auth";
import { persistentPoolSubscribe, publishEvent } from "@/lib/nostr";
import type { StoredChannel, StoredCommunity } from "@/lib/concord/concord-keys";
import { effectiveTime } from "@/lib/concord/concord-events";
import { roomVoiceKeys, callerFrameKey, type VoiceKeys } from "@/lib/concord/concord-voice";
import { callRoster, matchCallers } from "@/lib/concord/concord-presence";
import { planCallerKeys, startPresenceHeartbeat, callerLabel, type CallerLabel, type KeyState } from "@/lib/concord/concord-call";
import { publishCallPresence, subscribeCallPresence } from "@/lib/concord/concord-stream";
import type { JoinedCall } from "@/lib/concord/concord-call-e2ee";

export interface CallParticipant {
  identity: string;
  label: CallerLabel;
  isLocal: boolean;
  speaking: boolean;
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
}

export interface ActiveCall {
  communityId: string;
  channelId: string;
  title: string;
  participants: CallParticipant[];
  micOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  /** The LiveKit room, for the stage to attach video. */
  room: Room;
}

interface CallCtx {
  call: ActiveCall | null;
  joining: boolean;
  error: string | null;
  join(community: StoredCommunity, channel: StoredChannel, title: string): Promise<void>;
  leave(): Promise<void>;
  toggleMic(): Promise<void>;
  toggleCamera(): Promise<void>;
  toggleScreen(): Promise<void>;
  /** A room screen says which room it's showing, so the floating bar hides there. */
  setOnScreen(key: string | null): void;
}

export const callRoomKey = (communityId: string, channelId: string) => `${communityId}:${channelId}`;

const noop = async () => {};
const Ctx = createContext<CallCtx>({
  call: null, joining: false, error: null,
  join: noop, leave: noop, toggleMic: noop, toggleCamera: noop, toggleScreen: noop, setOnScreen: () => {},
});
export const useConcordCall = () => useContext(Ctx);

/** Presence older than this can't change the roster (a "joined" goes stale at 90s). */
const RUMOR_KEEP_MS = 3 * 60 * 1000;
const RESYNC_MS = 5_000;

type PresenceRumor = { kind: number; pubkey: string; content: string; created_at: number; tags: string[][] };

interface Session {
  /** Our own pubkey: the member behind our seat. */
  ownPubkey: string;
  community: StoredCommunity;
  channel: StoredChannel;
  title: string;
  keys: VoiceKeys;
  joined: JoinedCall;
  room: Room;
  applied: Map<string, KeyState>;
  rumors: PresenceRumor[];
  firstSeen: Map<string, number>;
  audio: HTMLDivElement;
  stopBeat: () => Promise<void>;
  closePresence: () => void;
  tick: ReturnType<typeof setInterval>;
}

export function ConcordCallProvider({ children }: { children: React.ReactNode }) {
  const { pubkey } = useNostrAuth();
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onScreen, setOnScreen] = useState<string | null>(null);
  const session = useRef<Session | null>(null);

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
    clearInterval(s.tick);
    s.closePresence();
    await s.stopBeat();
    await s.room.disconnect().catch(() => {});
    s.joined.worker.terminate();
    s.audio.remove();
    setCall(null);
  }, []);

  const join = useCallback(async (community: StoredCommunity, channel: StoredChannel, title: string) => {
    if (session.current) await leave();
    const signer = getGlobalSigner();
    if (!pubkey || !signer) { setError("Sign in to join the call"); return; }
    const keys = roomVoiceKeys(community, channel);
    if (!keys) { setError("You don't hold this room's key, so you can't join its call"); return; }
    setJoining(true);
    setError(null);
    try {
      const [{ joinCall }, lk, workerModule] = await Promise.all([
        import("@/lib/concord/concord-call-e2ee"),
        import("livekit-client"),
        import("livekit-client/e2ee-worker?worker"),
      ]);
      const joined = await joinCall({
        keys,
        brokerOrigin: window.location.origin,
        now: () => Math.floor(Date.now() / 1000),
        fetch: window.fetch.bind(window),
        startWorker: () => new workerModule.default(),
        createRoom: (e2ee) => new lk.Room({ e2ee, adaptiveStream: true, dynacast: true }) as never,
      });
      const room = joined.room as unknown as Room;

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
        broker: window.location.origin,
      });
      const s: Session = {
        ownPubkey: pubkey, community, channel, title, keys, joined, room,
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

      await room.localParticipant.setMicrophoneEnabled(true).catch(() => {
        setError("Your microphone isn't available, so you've joined muted");
      });
      resync();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setJoining(false);
    }
  }, [pubkey, leave, resync]);

  const toggle = useCallback(async (which: "mic" | "camera" | "screen") => {
    const s = session.current;
    if (!s) return;
    const lp = s.room.localParticipant;
    try {
      if (which === "mic") await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled);
      if (which === "camera") await lp.setCameraEnabled(!lp.isCameraEnabled);
      if (which === "screen") await lp.setScreenShareEnabled(!lp.isScreenShareEnabled);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
    resync();
  }, [resync]);

  // Signing out, or closing the tab, ends the call.
  useEffect(() => { if (!pubkey) void leave(); }, [pubkey, leave]);
  useEffect(() => () => { void leave(); }, [leave]);

  const value: CallCtx = {
    call, joining, error, join, leave,
    toggleMic: () => toggle("mic"),
    toggleCamera: () => toggle("camera"),
    toggleScreen: () => toggle("screen"),
    setOnScreen,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {call && onScreen !== callRoomKey(call.communityId, call.channelId) && (
        <FloatingCallBar call={call} onToggleMic={value.toggleMic} onLeave={leave} />
      )}
    </Ctx.Provider>
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
function FloatingCallBar({ call, onToggleMic, onLeave }: { call: ActiveCall; onToggleMic: () => Promise<void>; onLeave: () => Promise<void> }) {
  const [, navigate] = useLocation();
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
        <p className="truncate text-[11px] text-muted-foreground">In call{others > 0 ? ` · ${others} other${others === 1 ? "" : "s"}` : ""}</p>
      </button>
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
