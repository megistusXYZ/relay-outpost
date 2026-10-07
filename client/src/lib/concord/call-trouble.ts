/**
 * The moments people get stuck in an encrypted call, said plainly (owner,
 * 2026-10-06 audit; call-trouble.test.ts).
 */
import { useCallback, useEffect, useState } from "react";

type Device = "mic" | "camera" | "screen";
const NOUN: Record<Device, string> = { mic: "microphone", camera: "camera", screen: "screen share" };
const TAP: Record<Device, string> = { mic: "mic", camera: "camera", screen: "share button" };

/**
 * What to tell someone when turning on their mic, camera or screen share
 * failed — never the browser's raw message. Null when there's nothing to say
 * (closing the screen-share picker is a choice, not an error).
 */
export function callTrouble(err: unknown, which: Device): string | null {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (which === "screen") return null;
    const n = NOUN[which];
    return `Your ${n} is blocked. Allow it for this site in your browser's settings, then tap the ${TAP[which]} again.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return `No ${NOUN[which]} was found on this device.`;
  if (name === "NotReadableError" || name === "AbortError") return `Your ${NOUN[which]} is in use by another app. Close it there and try again.`;
  return `Something went wrong with your ${NOUN[which]}. Try again.`;
}

/** The slice of a LiveKit Room this needs. */
export interface AudioRoom {
  readonly canPlaybackAudio: boolean;
  startAudio(): Promise<void>;
  on(event: "audioPlaybackChanged", cb: () => void): unknown;
  off(event: "audioPlaybackChanged", cb: () => void): unknown;
}

/**
 * Whether the browser is holding the call's sound back until a tap (iPhone,
 * and the home-screen app most of all), and the tap that releases it. LiveKit
 * reports it as canPlaybackAudio / "audioPlaybackChanged"; startAudio() must
 * run inside the tap.
 */
export function useCallAudio(room: AudioRoom | null): { blocked: boolean; start: () => Promise<void> } {
  const [blocked, setBlocked] = useState(() => !!room && !room.canPlaybackAudio);
  useEffect(() => {
    if (!room) { setBlocked(false); return; }
    const sync = () => setBlocked(!room.canPlaybackAudio);
    sync();
    room.on("audioPlaybackChanged", sync);
    return () => { room.off("audioPlaybackChanged", sync); };
  }, [room]);
  const start = useCallback(async () => {
    if (!room) return;
    try { await room.startAudio(); } catch { /* the next tap tries again */ }
    setBlocked(!room.canPlaybackAudio);
  }, [room]);
  return { blocked, start };
}
