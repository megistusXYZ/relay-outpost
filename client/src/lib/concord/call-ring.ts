/**
 * When a call rings (owner, 2026-10-06; call-ring.test.ts). A call is a run
 * of presence in a room with no gap longer than QUIET_MS; the first presence
 * from someone else in a quiet room rings — unless the room is muted or
 * you're already in its call — and nothing else in that run does.
 */
export const QUIET_MS = 90_000; // presence goes stale at 90 s (concord-call.ts)

export interface SeenPresence {
  room: string; caller: string; at: number; muted: boolean; inCall: boolean;
  /** "left" is someone going, never a call starting. Default "joined". */
  state?: "joined" | "left";
  /** When the caller sent it (their clock); one older than QUIET_MS is stale. */
  sentAt?: number;
}
export interface Ring { room: string; caller: string }

export function createRingDecider(o: { me: string; quietMs?: number }) {
  const quiet = o.quietMs ?? QUIET_MS;
  const last = new Map<string, number>();
  return {
    see(p: SeenPresence): Ring | null {
      if (p.state === "left") return null;
      if (p.sentAt !== undefined && p.at - p.sentAt > quiet) return null;
      const prev = last.get(p.room);
      last.set(p.room, p.at);
      const fresh = prev === undefined || p.at - prev > quiet;
      if (!fresh || p.caller === o.me || p.muted || p.inCall) return null;
      return { room: p.room, caller: p.caller };
    },
  };
}
