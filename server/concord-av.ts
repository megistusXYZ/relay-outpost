/**
 * The call-token service for encrypted group-chat calls (Concord CORD-07 §2,
 * the "broker"). A member proves they hold a room's voice key by signing a
 * kind-27235 request with it; the request's public key IS the room. They get a
 * LiveKit token for that room's call on our media server, under a random
 * identity: the broker never learns who is calling.
 */
import { createHmac, randomBytes } from "node:crypto";
import { verifyEvent, type Event } from "nostr-tools";
import type { Express } from "express";
import { TTLCache } from "./ttl-cache";
import { createCallCapacity, type Admit, type CallCapacity } from "./call-capacity";
import { verifyNip98 } from "./nip98-auth";
import { RELAY_OUTPOST_TEAM_PUBKEY } from "../shared/team-key";

/** The token request's kind (CORD-07 §2, NIP-98 shaped). */
export const KIND_AV_TOKEN_REQUEST = 27235;

export interface AvTokenInput {
  /** The `Authorization` header: `Concord <base64(signed event)>`. */
  authorization: string | undefined;
  /** The room from the path: the voice key's x-only public key, hex. */
  room: string;
  /** The exact URL this request was made to, as the signer had to name it. */
  url: string;
  /** Unix seconds. */
  now: number;
  /** Request ids already used, so none can be replayed. */
  seen: { has(id: string): boolean; add(id: string): void };
  apiKey: string;
  apiSecret: string;
  /** The media server clients connect to, e.g. wss://livekit.relayop.xyz. */
  livekitUrl: string;
  /** Call limits (call-capacity.ts), asked only for a genuine request. */
  admit?: (room: string) => Admit;
}

export type AvTokenResult =
  | { status: 200; body: { token: string; url: string; identity: string } }
  | { status: 400 | 401 | 429 | 503; body: { error: string } };

/** How far a request's timestamp may be from ours (CORD-07 §2: ±60s). */
const FRESH_SECONDS = 60;

/** A token lives an hour; LiveKit keeps a joined call going past it. */
const TOKEN_TTL_SECONDS = 3600;

export function issueAvToken(input: AvTokenInput): AvTokenResult {
  // Not set up: say so before touching the request (and never sign a token
  // with an empty secret, which anyone could forge).
  if (!input.apiKey || !input.apiSecret || !input.livekitUrl) {
    return { status: 503, body: { error: "Calls aren't set up on this server" } };
  }
  const event = readRequest(input.authorization);
  if (!event) return { status: 400, body: { error: "Expected Authorization: Concord <base64 signed event>" } };
  // Only the room's own voice key can ask for the room: its public key is the room.
  if (event.kind !== KIND_AV_TOKEN_REQUEST || event.pubkey !== input.room.toLowerCase() || !verifyEvent(event)) {
    return { status: 401, body: { error: "Not signed by this room's voice key" } };
  }
  // Made for exactly this link, as a GET: a request signed for another
  // broker (or another room's path) can't be replayed here.
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
  if (tag("u") !== input.url || tag("method")?.toUpperCase() !== "GET") {
    return { status: 401, body: { error: "Signed for a different request" } };
  }
  // Fresh: within a minute of our clock either way, so a captured request
  // goes stale fast (and the replay memory below only has to span that).
  if (Math.abs(input.now - event.created_at) > FRESH_SECONDS) {
    return { status: 401, body: { error: "Request is too old, or dated in the future" } };
  }
  // Once only. Checked after the signature, so an unsigned request can't take
  // a real one's id; recorded only when a token is actually issued.
  if (input.seen.has(event.id)) {
    return { status: 401, body: { error: "Request already used" } };
  }
  // Limits come after the signature, so nobody can use up a room's seats by
  // sending requests they couldn't sign; a refused request isn't spent.
  const admit = input.admit?.(event.pubkey) ?? { ok: true };
  if (!admit.ok) {
    return admit.reason === "room"
      ? { status: 429, body: { error: "Too many people are joining this call at once. Try again in a moment." } }
      : { status: 503, body: { error: "Calls are busy right now. Try again in a few minutes." } };
  }
  input.seen.add(event.id);
  const identity = randomBytes(16).toString("hex");
  const token = mintLiveKitToken(input.apiKey, input.apiSecret, input.room, identity, input.now);
  return { status: 200, body: { token, url: input.livekitUrl, identity } };
}

/** A LiveKit access token: an HS256 JWT with the room grant, signed with the API secret. */
function mintLiveKitToken(apiKey: string, apiSecret: string, room: string, identity: string, now: number): string {
  return signLiveKitJwt(apiKey, apiSecret, {
    sub: identity,
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  });
}

function signLiveKitJwt(apiKey: string, apiSecret: string, claims: object): string {
  const part = (x: object) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const header = part({ alg: "HS256", typ: "JWT" });
  const payload = part({ iss: apiKey, ...claims });
  const sig = createHmac("sha256", apiSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/**
 * The calls running on the media server right now: its room list (LiveKit's
 * RoomService.ListRooms), asked with a short-lived list-only token.
 */
async function liveKitRooms(): Promise<Set<string>> {
  const apiKey = process.env.LIVEKIT_API_KEY ?? "", apiSecret = process.env.LIVEKIT_API_SECRET ?? "", url = process.env.LIVEKIT_URL ?? "";
  if (!apiKey || !apiSecret || !url) throw new Error("calls aren't set up");
  const now = Math.floor(Date.now() / 1000);
  const token = signLiveKitJwt(apiKey, apiSecret, { nbf: now, exp: now + 60, video: { roomList: true } });
  const res = await fetch(`${url.replace(/^ws/, "http")}/twirp/livekit.RoomService/ListRooms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(3_000),
  });
  if (!res.ok) throw new Error(`media server answered ${res.status}`);
  const body = (await res.json()) as { rooms?: Array<{ name?: string }> };
  return new Set((body.rooms ?? []).map((r) => r.name).filter((n): n is string => typeof n === "string"));
}

/** Calls at once (CALLS_MAX overrides) and new seats a minute in one call (25 people plus rejoins). */
const DEFAULT_MAX_CALLS = 50;
const SEATS_PER_ROOM_PER_MINUTE = 30;

/** The signed event inside `Authorization: Concord <base64>`, or null when there isn't one. */
function readRequest(header: string | undefined): Event | null {
  const m = /^Concord\s+([A-Za-z0-9+/_=-]+)$/.exec(header?.trim() ?? "");
  if (!m) return null;
  try {
    const event = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    return event && typeof event === "object" && typeof event.pubkey === "string" ? (event as Event) : null;
  } catch {
    return null;
  }
}

/** Used request ids are kept past the ±60s window with room to spare (CORD-07: at least 240s). */
const REPLAY_MEMORY_MS = 5 * 60 * 1000;

/**
 * GET /.well-known/concord/av         → 204: this server hands out call tokens.
 * GET /.well-known/concord/av/<room>  → { token, url, identity } for that room's call.
 * Keys come from LIVEKIT_API_KEY / LIVEKIT_API_SECRET, the media server from
 * LIVEKIT_URL; with any missing it answers 503. Other apps' browsers may
 * call it too (see openToOtherApps below).
 */
export function registerConcordAvRoutes(app: Express, opts: {
  /** Who may read the call count (/api/calls/usage). */
  owners?: string[];
  capacity?: CallCapacity;
  /** Our own addresses (ALLOWED_ORIGINS); unset, as on a laptop, means any. */
  ownOrigins?: string[];
} = {}): void {
  const ownOrigins = opts.ownOrigins
    ?? (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim().toLowerCase()).filter(Boolean);
  const owners = new Set((opts.owners ?? [RELAY_OUTPOST_TEAM_PUBKEY]).map((p) => p.toLowerCase()));
  const capacity = opts.capacity ?? createCallCapacity({
    maxCalls: Number(process.env.CALLS_MAX) > 0 ? Number(process.env.CALLS_MAX) : DEFAULT_MAX_CALLS,
    seatsPerRoomPerMinute: SEATS_PER_ROOM_PER_MINUTE,
    liveRooms: liveKitRooms,
  });
  const used = new TTLCache<true>(10_000, REPLAY_MEMORY_MS);
  const seen = { has: (id: string) => used.get(id) !== undefined, add: (id: string) => used.set(id, true) };

  // Open to other apps' browsers (owner, 2026-10-06): groups made here name
  // this service (`av_brokers`), so a member using Armada joins our calls.
  // Only this endpoint; it stays members-only (the request is signed with the
  // room's voice key) and rate-limited (callTokenLimiter). Armada's own
  // service is open the same way.
  const openToOtherApps = (res: import("express").Response) => res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    // helmet's same-origin resource policy would block the answer otherwise.
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  app.options(["/.well-known/concord/av", "/.well-known/concord/av/:room"], (_req, res) => {
    openToOtherApps(res).status(204).end();
  });

  app.get("/.well-known/concord/av", (_req, res) => {
    openToOtherApps(res).set("Cache-Control", "no-store").status(204).end();
  });

  app.get("/.well-known/concord/av/:room", (req, res) => {
    openToOtherApps(res).set("Cache-Control", "no-store");
    const room = String(req.params.room);
    if (!/^[0-9a-f]{64}$/.test(room)) {
      return res.status(400).json({ error: "The room is the voice key's public key: 64 lowercase hex characters" });
    }
    // trust proxy is on, so this is the https://relayop.xyz/... the caller signed.
    // The host is the caller's word, so it must be one of ours: otherwise a
    // service could replay a request signed for its own address here, with
    // that address as the host.
    const origin = `${req.protocol}://${req.get("host")}`.toLowerCase();
    if (ownOrigins.length && !ownOrigins.includes(origin)) {
      return res.status(421).json({ error: "This request was made for a different call service" });
    }
    const url = `${origin}${req.originalUrl}`;
    const result = issueAvToken({
      authorization: req.get("authorization"),
      room,
      url,
      now: Math.floor(Date.now() / 1000),
      seen,
      apiKey: process.env.LIVEKIT_API_KEY ?? "",
      apiSecret: process.env.LIVEKIT_API_SECRET ?? "",
      livekitUrl: process.env.LIVEKIT_URL ?? "",
      admit: (r) => capacity.admit(r, Date.now()),
    });
    return res.status(result.status).json(result.body);
  });

  // How many calls are running, out of how many allowed: the team's status
  // line in Relay Control. Signed (NIP-98) by the team's key; our own site only.
  app.get("/api/calls/usage", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const who = verifyNip98(req);
    if ("error" in who) return res.status(who.status).json({ error: who.error });
    if (!owners.has(who.pubkey.toLowerCase())) return res.status(403).json({ error: "Only the Relay Outpost team can see this" });
    await capacity.refresh(Date.now());
    return res.json(capacity.usage(Date.now()));
  });
}
