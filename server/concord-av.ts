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
}

export type AvTokenResult =
  | { status: 200; body: { token: string; url: string; identity: string } }
  | { status: 400 | 401 | 503; body: { error: string } };

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
  input.seen.add(event.id);
  const identity = randomBytes(16).toString("hex");
  const token = mintLiveKitToken(input.apiKey, input.apiSecret, input.room, identity, input.now);
  return { status: 200, body: { token, url: input.livekitUrl, identity } };
}

/** A LiveKit access token: an HS256 JWT with the room grant, signed with the API secret. */
function mintLiveKitToken(apiKey: string, apiSecret: string, room: string, identity: string, now: number): string {
  const part = (x: object) => Buffer.from(JSON.stringify(x)).toString("base64url");
  const header = part({ alg: "HS256", typ: "JWT" });
  const payload = part({
    iss: apiKey,
    sub: identity,
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  });
  const sig = createHmac("sha256", apiSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

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
 * LIVEKIT_URL; with any missing it answers 503. Same-origin for now: the
 * site-wide CORS rules apply, so only our own app can call it.
 */
export function registerConcordAvRoutes(app: Express): void {
  const used = new TTLCache<true>(10_000, REPLAY_MEMORY_MS);
  const seen = { has: (id: string) => used.get(id) !== undefined, add: (id: string) => used.set(id, true) };

  app.get("/.well-known/concord/av", (_req, res) => {
    res.set("Cache-Control", "no-store").status(204).end();
  });

  app.get("/.well-known/concord/av/:room", (req, res) => {
    res.set("Cache-Control", "no-store");
    const room = String(req.params.room);
    if (!/^[0-9a-f]{64}$/.test(room)) {
      return res.status(400).json({ error: "The room is the voice key's public key: 64 lowercase hex characters" });
    }
    // trust proxy is on, so this is the https://relayop.xyz/... the caller signed.
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const result = issueAvToken({
      authorization: req.get("authorization"),
      room,
      url,
      now: Math.floor(Date.now() / 1000),
      seen,
      apiKey: process.env.LIVEKIT_API_KEY ?? "",
      apiSecret: process.env.LIVEKIT_API_SECRET ?? "",
      livekitUrl: process.env.LIVEKIT_URL ?? "",
    });
    return res.status(result.status).json(result.body);
  });
}
