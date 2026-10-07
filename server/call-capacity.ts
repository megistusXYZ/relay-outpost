/**
 * Call limits (owner, 2026-10-06). Our call service answers any app, and a
 * room is just a key anyone can make, so without limits one person could fill
 * the media server for everyone. call-capacity.test.ts.
 *
 *  - A room takes at most `seatsPerRoomPerMinute` new seats a minute.
 *  - At most `maxCalls` calls run at once. A call already running is never
 *    refused: the limit is on starting new ones.
 *  - "Running" comes from the media server itself (`liveRooms`, looked up at
 *    most every 15 s), plus calls started since that look. If it can't be
 *    asked, calls go ahead: the per-room and per-address limits still hold.
 */
export type Admit = { ok: true } | { ok: false; reason: "room" | "busy" };

export interface CallCapacity {
  /** Called for a request already proven to come from the room's key. */
  admit(room: string, nowMs: number): Admit;
  /** Ask the media server which calls are running. */
  refresh(nowMs: number): Promise<void>;
  /** For the site owner's status line. */
  usage(nowMs: number): { calls: number; max: number };
}

const MINUTE = 60_000;
const LOOK_EVERY_MS = 15_000;

export function createCallCapacity(o: {
  maxCalls: number;
  seatsPerRoomPerMinute: number;
  liveRooms: () => Promise<Set<string>>;
}): CallCapacity {
  const seats = new Map<string, number[]>();
  /** Calls started here since the media server was last asked: room → first seat. */
  const started = new Map<string, number>();
  let live: Set<string> | null = null;
  let lookedAt = 0;
  let looking: Promise<void> | null = null;

  const running = (now: number): Set<string> => {
    const all = new Set(live ?? []);
    for (const [room, at] of started) {
      if (at >= lookedAt || now - at < MINUTE) all.add(room);
      else started.delete(room);
    }
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
    admit(room, now) {
      if (now - lookedAt > LOOK_EVERY_MS) void refresh(now);
      const recent = (seats.get(room) ?? []).filter((t) => now - t < MINUTE);
      if (recent.length >= o.seatsPerRoomPerMinute) { seats.set(room, recent); return { ok: false, reason: "room" }; }
      const calls = running(now);
      if (!calls.has(room) && live !== null && calls.size >= o.maxCalls) return { ok: false, reason: "busy" };
      recent.push(now);
      seats.set(room, recent);
      if (!calls.has(room)) started.set(room, now);
      // Rooms nobody has asked about for a while are forgotten.
      if (seats.size > 5_000) for (const [r, ts] of seats) if (!ts.some((t) => now - t < MINUTE)) seats.delete(r);
      return { ok: true };
    },
    refresh,
    usage(now) {
      return { calls: running(now).size, max: o.maxCalls };
    },
  };
}
