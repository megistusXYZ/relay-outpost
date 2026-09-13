/**
 * The call itself (Concord CORD-07), the parts that aren't a screen. Pure.
 *
 * Who gets a real frame key is re-decided whenever someone joins the media
 * server or presence changes, exactly as Armada decides it: our own seat, and
 * any seat exactly one member's fresh presence claims, get the caller's real
 * key; every other seat gets a key that opens nothing, so an unverified
 * caller's audio and video never play under someone else's name.
 */
import { matchCallers, type CallerMatch, type CallPresence, type CallSeat } from "./concord-presence";
import type { VoiceKeys } from "./concord-voice";

/** What a seat's installed key is: its real frame key, or one that opens nothing. */
export type KeyState = "sender" | "blocked";

/**
 * The key changes to make for the seats in a call. Only what differs from
 * `applied` is returned (installing a key is async and not free), and
 * `applied` is left for the caller to update once each install lands.
 */
export function planCallerKeys(input: {
  /** Our own seat: always keyed, without waiting for our heartbeat to echo back. */
  own: string;
  /** Seats to decide: the media server's participants plus any presence already claims. */
  present: string[];
  roster: Map<string, CallSeat>;
  applied: Map<string, KeyState>;
}): Array<{ identity: string; want: KeyState }> {
  const seats = [...new Set(input.present)];
  const verified = new Set(
    matchCallers(input.roster, seats).filter((m) => m.member !== null).map((m) => m.identity),
  );
  const plan: Array<{ identity: string; want: KeyState }> = [];
  for (const identity of seats) {
    const want: KeyState = identity === input.own || verified.has(identity) ? "sender" : "blocked";
    if (input.applied.get(identity) !== want) plan.push({ identity, want });
  }
  return plan;
}

/** How often a caller re-announces "joined" (CORD-07 §4); three missed = gone. */
export const HEARTBEAT_MS = 30_000;

/**
 * Keep the room aware we're in its call: "joined" now and every 30 seconds,
 * then "left" once on stop. A failed announce never stops the heartbeat (the
 * next beat heals it), and "left" is best effort: a missed one heals when our
 * last "joined" goes stale.
 */
export function startPresenceHeartbeat(input: {
  announce: (presence: CallPresence) => Promise<void>;
  identity: string;
  broker: string;
  everyMs?: number;
}): { stop(): Promise<void> } {
  const joined: CallPresence = { state: "joined", identity: input.identity, broker: input.broker };
  const beat = () => { input.announce(joined).catch(() => {}); };
  beat();
  const timer = setInterval(beat, input.everyMs ?? HEARTBEAT_MS);
  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await input.announce({ state: "left" }).catch(() => {});
    },
  };
}

/**
 * What an ongoing call does when the room's keys change (CORD-07 §1): the call
 * keys ride the room's epoch, so a rekey (someone removed) moves the call to a
 * new room and everyone rejoins there. Losing the room's key means we've been
 * cut off from calls too, so we leave. Same room name, same media key: stay.
 */
export function callKeysChange(current: VoiceKeys, next: VoiceKeys | null): "stay" | "rejoin" | "leave" {
  if (!next) return "leave";
  return next.room === current.room ? "stay" : "rejoin";
}

/** How long a caller the media server shows may go unclaimed before we call them unverified (Armada: 15s). */
export const VERIFY_GRACE_MS = 15_000;

export type CallerLabel = { kind: "member"; pubkey: string } | { kind: "verifying" } | { kind: "unverified" };

/**
 * What a caller is called on screen. A seat one member's fresh presence alone
 * claims shows that member. Anyone else shows "Verifying…" for their first 15
 * seconds (presence usually lands a moment after the media server shows them),
 * then "Unverified", never a name we can't back.
 */
export function callerLabel(match: CallerMatch, firstSeenMs: number, nowMs: number): CallerLabel {
  if (match.member) return { kind: "member", pubkey: match.member };
  return nowMs - firstSeenMs < VERIFY_GRACE_MS ? { kind: "verifying" } : { kind: "unverified" };
}
