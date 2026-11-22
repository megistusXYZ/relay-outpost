/**
 * Call limits (owner, 2026-10-06). Our call service answers any app, and a
 * room is just a key anyone can make, so without limits one person could fill
 * the media server for everyone. call-capacity.test.ts.
 *
 *  - A room takes at most `seatsPerRoomPerMinute` new seats a minute.
 *  - At most `maxCalls` calls run at once. A call already running is never
 *    refused: the limit is on starting new ones.
 *  - "Running" comes from the media server itself (`liveRooms`, looked up at
 *    most every 15 s), plus rooms just given a token: until the media server
 *    has been asked since, then only for the join window (JOIN_WINDOW_MS).
 *    If it can't be asked, calls go ahead: the per-room and per-address
 *    limits still hold.
 *  - One address can have at most MAX_WAITING_PER_ADDRESS rooms waiting for
 *    someone to join (a key is a room, so rooms are free to make).
 */
export type Admit = { ok: true } | { ok: false; reason: "room" | "busy" };

export interface CallCapacity {
  /** Called for a request already proven to come from the room's key; `caller` is its address. */
  admit(room: string, nowMs: number, caller?: string): Admit;
  /** Ask the media server which calls are running. */
  refresh(nowMs: number): Promise<void>;
  /** For the site owner's status line. */
  usage(nowMs: number): { calls: number; max: number };
  /** Is a call already running in this room (so a new seat doesn't start one)? */
  isRunning(room: string, nowMs: number): boolean;
}

const MINUTE = 60_000;
/** How long a room given a token counts as starting before anyone has joined it. */
export const JOIN_WINDOW_MS = 20_000;
/** Rooms one address may have waiting for someone to join. */
export const MAX_WAITING_PER_ADDRESS = 3;
const LOOK_EVERY_MS = 15_000;

export function createCallCapacity(o: {
  maxCalls: number;
  seatsPerRoomPerMinute: number;
  liveRooms: () => Promise<Set<string>>;
}): CallCapacity {
  const seats = new Map<string, number[]>();
  /** Calls started here, not yet seen running by the media server: room → first seat and who asked. */
  const started = new Map<string, { at: number; caller?: string }>();
  let live: Set<string> | null = null;
  let lookedAt = 0;
  let looking: Promise<void> | null = null;

  // A room given a token counts as starting until the media server has been
  // asked since: then only for the join window, unless it is running. It used
  // to count for a minute whatever the media server said, so tokens for
  // throwaway rooms nobody joined kept every slot taken.
  const waiting = (now: number): Map<string, { at: number; caller?: string }> => {
    for (const [room, s] of started) {
      const seenSince = lookedAt > s.at;
      const stillStarting = seenSince ? now - s.at < JOIN_WINDOW_MS : now - s.at < MINUTE;
      if ((live?.has(room) ?? false) || !stillStarting) started.delete(room);
    }
    return started;
  };
  const running = (now: number): Set<string> => {
    const all = new Set(live ?? []);
    for (const room of waiting(now).keys()) all.add(room);
    return all;
  };

  const refresh = (now: number): Promise<void> => {
    looking ??= o.liveRooms()
      .then((rooms) => { live = rooms; lookedAt = now; })
      .catch(() => { live = null; lookedAt = now; })
      .finally(() => { looking = null; });
    return looking;
  };

  return {
    admit(room, now, caller) {
      if (now - lookedAt > LOOK_EVERY_MS) void refresh(now);
      const recent = (seats.get(room) ?? []).filter((t) => now - t < MINUTE);
      if (recent.length >= o.seatsPerRoomPerMinute) { seats.set(room, recent); return { ok: false, reason: "room" }; }
      const calls = running(now);
      if (!calls.has(room) && live !== null && calls.size >= o.maxCalls) return { ok: false, reason: "busy" };
      // One address can have only a few rooms waiting for someone to join.
      if (!calls.has(room) && caller && [...started.values()].filter((s) => s.caller === caller).length >= MAX_WAITING_PER_ADDRESS) {
        return { ok: false, reason: "busy" };
      }
      recent.push(now);
      seats.set(room, recent);
      if (!calls.has(room)) started.set(room, { at: now, caller });
      // Rooms nobody has asked about for a while are forgotten.
      if (seats.size > 5_000) for (const [r, ts] of seats) if (!ts.some((t) => now - t < MINUTE)) seats.delete(r);
      return { ok: true };
    },
    refresh,
    usage(now) {
      return { calls: running(now).size, max: o.maxCalls };
    },
    isRunning(room, now) {
      return running(now).has(room);
    },
  };
}
