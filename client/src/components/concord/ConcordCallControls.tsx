/**
 * A room's call, on screen (Concord CORD-07): the Call button in the header,
 * the call bar under it, and the stage of callers. The call itself lives in
 * ConcordCallContext, at the app level, so it survives leaving the room.
 *
 * Types only from LiveKit here: the library loads when you join, not before.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, Mic, MicOff, MonitorUp, MonitorX, Phone, PhoneOff, ShieldCheck, Video, VideoOff, X } from "lucide-react";
import type { Participant, Track } from "livekit-client";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useConcordProfile } from "./ConcordIdentity";
import { senderColor } from "@/lib/sender-color";
import { persistentPoolSubscribe } from "@/lib/nostr";
import type { StoredChannel, StoredCommunity } from "@/lib/concord/concord-keys";
import { callRoster } from "@/lib/concord/concord-presence";
import { subscribeCallPresence } from "@/lib/concord/concord-stream";
import type { CallerLabel } from "@/lib/concord/concord-call";
import { useConcordCall, callRoomKey, type ActiveCall, type CallParticipant } from "@/contexts/ConcordCallContext";
import { useConcordCallsEnabled } from "@/lib/concord/concord-prefs";

type PresenceRumor = { kind: number; pubkey: string; content: string; created_at: number; tags: string[][] };

/** Is the call we're in this room's call? */
function useHereCall(community: StoredCommunity, channel: StoredChannel | undefined): ActiveCall | null {
  const { call } = useConcordCall();
  if (!call || !channel) return null;
  return callRoomKey(call.communityId, call.channelId) === callRoomKey(community.community_id, channel.id) ? call : null;
}

/**
 * How many members are in a room's call, from its presence, while we aren't in
 * it. Presence isn't stored by relays, so a freshly opened room knows within
 * one 30-second heartbeat.
 */
function useRoomCallCount(community: StoredCommunity, channel: StoredChannel | undefined, enabled: boolean): number {
  const [count, setCount] = useState(0);
  const latest = useRef({ community, channel });
  latest.current = { community, channel };
  const epoch = channel ? (channel.isPrivate ? channel.epoch : community.root_epoch) : -1;
  useEffect(() => {
    const { community: c, channel: ch } = latest.current;
    if (!enabled || !ch) { setCount(0); return; }
    const rumors: PresenceRumor[] = [];
    const recount = () => setCount(callRoster(rumors, Date.now()).size);
    const sub = subscribeCallPresence(c, ch, (r) => { rumors.push(r as PresenceRumor); recount(); },
      (relays, filter, onevent) => persistentPoolSubscribe(relays, filter, { onevent }));
    const tick = setInterval(recount, 10_000);
    return () => { sub.close(); clearInterval(tick); };
  }, [community.community_id, channel?.id, epoch, enabled]);
  return count;
}

/** The header's Call button: join this room's call, or show you're already in it. */
export function ConcordCallButton({ community, channel, title, compact }: {
  community: StoredCommunity; channel: StoredChannel | undefined; title: string; compact?: boolean;
}) {
  const { joining, join } = useConcordCall();
  const here = useHereCall(community, channel);
  const enabled = useConcordCallsEnabled();
  if (!enabled && !here) return null;
  const size = compact ? "w-10 h-10" : "w-7 h-7";
  const icon = compact ? "w-[18px] h-[18px]" : "w-4 h-4";
  return (
    <button
      onClick={() => { if (channel && !here && !joining) void join(community, channel, title); }}
      disabled={!channel || joining}
      className={`flex items-center justify-center ${size} shrink-0 rounded-full transition-colors disabled:opacity-60 ${
        here ? "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
      }`}
      title={here ? "You're in this room's call" : "Start or join a call"}
      aria-label={here ? "In this room's call" : "Start or join a call"}
      aria-pressed={!!here}
      data-testid="concord-call-button"
    >
      {joining ? <Loader2 className={`${icon} animate-spin`} /> : <Phone className={icon} />}
    </button>
  );
}

const barButton = "flex items-center justify-center h-11 w-11 md:h-8 md:w-8 shrink-0 rounded-full transition-colors";

/** Under the header: who's in the call and a Join, or, once in, the call's controls. */
export function ConcordCallBar({ community, channel, title }: {
  community: StoredCommunity; channel: StoredChannel | undefined; title: string;
}) {
  const { join, joining, error, leave, toggleMic, toggleCamera, toggleScreen } = useConcordCall();
  const here = useHereCall(community, channel);
  const enabled = useConcordCallsEnabled();
  // No listening for a room's call until calls are switched on here.
  const count = useRoomCallCount(community, channel, enabled && !here);

  if (!here) {
    if (!enabled) return null;
    if (count === 0 && !error) return null;
    return (
      <div className="flex items-center gap-2.5 px-3 md:px-4 py-2 border-b border-border/20 shrink-0 bg-emerald-500/5" data-testid="concord-call-bar">
        <Phone className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {count > 0 && <p className="text-xs font-medium text-foreground/90">{count} in the call</p>}
          {error && <p className="text-[11px] text-destructive truncate" data-testid="concord-call-error">{error}</p>}
        </div>
        {count > 0 && channel && (
          <button
            onClick={() => void join(community, channel, title)}
            disabled={joining}
            className="h-11 md:h-8 px-3.5 rounded-lg bg-emerald-600 text-white text-xs font-medium shrink-0 hover:bg-emerald-600/90 disabled:opacity-60 transition-colors"
            data-testid="concord-call-join"
          >
            {joining ? "Joining…" : "Join"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-3 md:px-4 py-1.5 border-b border-border/20 shrink-0 bg-emerald-500/5" data-testid="concord-call-bar">
      <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground/90 truncate">In the call · {here.participants.length}</p>
        <p className="text-[11px] text-muted-foreground/70 truncate">End-to-end encrypted</p>
      </div>
      <button onClick={() => void toggleMic()} aria-label={here.micOn ? "Mute" : "Unmute"} aria-pressed={!here.micOn} data-testid="concord-call-mic"
        className={`${barButton} ${here.micOn ? "bg-muted/60 text-foreground" : "bg-destructive/15 text-destructive"}`}>
        {here.micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
      </button>
      <button onClick={() => void toggleCamera()} aria-label={here.cameraOn ? "Turn camera off" : "Turn camera on"} aria-pressed={here.cameraOn} data-testid="concord-call-camera"
        className={`${barButton} ${here.cameraOn ? "bg-brand/15 text-brand" : "bg-muted/60 text-foreground"}`}>
        {here.cameraOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
      </button>
      <button onClick={() => void toggleScreen()} aria-label={here.sharing ? "Stop sharing your screen" : "Share your screen"} aria-pressed={here.sharing} data-testid="concord-call-screen"
        className={`${barButton} hidden sm:flex ${here.sharing ? "bg-brand/15 text-brand" : "bg-muted/60 text-foreground"}`}>
        {here.sharing ? <MonitorX className="w-4 h-4" /> : <MonitorUp className="w-4 h-4" />}
      </button>
      <button onClick={() => void leave()} aria-label="Leave the call" data-testid="concord-call-leave"
        className={`${barButton} bg-destructive text-destructive-foreground hover:bg-destructive/90`}>
        <PhoneOff className="w-4 h-4" />
      </button>
    </div>
  );
}

/** The callers in a room's call: camera or avatar tiles, screens large, a full-screen view. */
export function ConcordCallStage({ community, channel }: { community: StoredCommunity; channel: StoredChannel | undefined }) {
  const here = useHereCall(community, channel);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  if (!here) return null;

  const grid = (big: boolean) => (
    <div className={`grid gap-2 ${big ? "grid-cols-2 lg:grid-cols-3 p-4" : "grid-cols-2 md:grid-cols-3"}`}>
      {here.participants.flatMap((p) => {
        const lp = participantOf(here, p);
        const tiles = [<CallTile key={p.identity} p={p} participant={lp} source="camera" />];
        if (p.sharing) tiles.push(<CallTile key={`${p.identity}-screen`} p={p} participant={lp} source="screen_share" />);
        return tiles;
      })}
    </div>
  );

  return (
    <>
      <div className="relative shrink-0 max-h-[40vh] overflow-y-auto border-b border-border/20 px-3 md:px-4 py-2" data-testid="concord-call-stage">
        <button onClick={() => setFull(true)} aria-label="Full screen" className="absolute right-4 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground">
          <Maximize2 className="w-4 h-4" />
        </button>
        {grid(false)}
      </div>
      {full && createPortal(
        <div className="fixed inset-0 z-[100] flex flex-col bg-black text-white" data-testid="concord-call-theater">
          <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
            <p className="text-sm font-medium">{here.title} · {here.participants.length} in the call</p>
            <button onClick={() => setFull(false)} aria-label="Close full screen" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/10">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">{grid(true)}</div>
        </div>,
        document.body,
      )}
    </>
  );
}

function participantOf(call: ActiveCall, p: CallParticipant): Participant | undefined {
  return p.isLocal ? call.room.localParticipant : call.room.remoteParticipants.get(p.identity);
}

function CallTile({ p, participant, source }: { p: CallParticipant; participant: Participant | undefined; source: "camera" | "screen_share" }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const showVideo = source === "screen_share" ? p.sharing : p.cameraOn;
  const track = showVideo ? participant?.getTrackPublication(source as Track.Source)?.track : undefined;
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  const screen = source === "screen_share";
  return (
    <div
      className={`relative aspect-video overflow-hidden rounded-xl bg-muted/40 ${screen ? "col-span-2" : ""} ${p.speaking && !screen ? "ring-2 ring-emerald-500" : ""}`}
      data-testid={screen ? "concord-call-screen-tile" : "concord-call-tile"}
    >
      {track ? (
        <video ref={videoRef} autoPlay playsInline muted={p.isLocal}
          className={`h-full w-full ${screen ? "object-contain bg-black" : "object-cover"} ${p.isLocal && !screen ? "scale-x-[-1]" : ""}`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <TileAvatar label={p.label} />
        </div>
      )}
      <div className="absolute bottom-1.5 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white">
        {/* Always on the tile's dark pill, so the light 200 shade (not 300/400). */}
        {!p.micOn && <MicOff className="h-3 w-3 shrink-0 text-red-200" aria-label="Muted" />}
        <span className="truncate">{screen ? <>Screen · <TileName label={p.label} isLocal={p.isLocal} /></> : <TileName label={p.label} isLocal={p.isLocal} />}</span>
      </div>
    </div>
  );
}

function TileName({ label, isLocal }: { label: CallerLabel; isLocal: boolean }) {
  if (label.kind === "member") return <MemberName pubkey={label.pubkey} isLocal={isLocal} />;
  return <span className={label.kind === "unverified" ? "text-amber-200" : "text-white/80"}>{label.kind === "verifying" ? "Verifying…" : "Unverified"}</span>;
}

function MemberName({ pubkey, isLocal }: { pubkey: string; isLocal: boolean }) {
  const { name, hasProfile } = useConcordProfile(pubkey);
  return <span style={hasProfile && !isLocal ? { color: senderColor(pubkey) } : undefined}>{isLocal ? "You" : name}</span>;
}

function TileAvatar({ label }: { label: CallerLabel }) {
  if (label.kind !== "member") {
    return <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg text-muted-foreground">?</div>;
  }
  return <MemberAvatar pubkey={label.pubkey} />;
}

function MemberAvatar({ pubkey }: { pubkey: string }) {
  const { name, avatar } = useConcordProfile(pubkey);
  return (
    <Avatar className="h-14 w-14">
      {avatar && <AvatarImage src={avatar} alt="" />}
      <AvatarFallback className="text-lg">{(name || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
