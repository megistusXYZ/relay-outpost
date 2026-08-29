import type { ISigner } from "applesauce-signers";
import type { SimplePool } from "nostr-tools";
import type { EventTemplate, VerifiedEvent } from "nostr-tools";

export type AuthStatus = "none" | "challenged" | "authenticating" | "authenticated" | "failed";

interface AuthState {
  status: AuthStatus;
  challenge?: string;
  error?: string;
}

const authStates = new Map<string, AuthState>();
const authListeners = new Set<() => void>();

let poolRef: SimplePool | null = null;
let globalSigner: ISigner | null = null;

export function setPoolRef(p: SimplePool) {
  poolRef = p;
}

export function setGlobalSigner(s: ISigner | null) {
  globalSigner = s;
}

export function getGlobalSigner(): ISigner | null {
  return globalSigner;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getAuthStatus(relayUrl: string): AuthState {
  return authStates.get(normalizeUrl(relayUrl)) ?? { status: "none" };
}

export function getAllAuthStates(): Map<string, AuthState> {
  return new Map(authStates);
}

function notifyListeners() {
  authListeners.forEach((fn) => fn());
}

export function onAuthChange(listener: () => void): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

export async function handleAuthChallenge(
  relayUrl: string,
  challenge: string,
  signer: ISigner | null,
): Promise<boolean> {
  const key = normalizeUrl(relayUrl);
  authStates.set(key, { status: "challenged", challenge });
  notifyListeners();

  if (!signer) {
    authStates.set(key, { status: "failed", error: "No signer available" });
    notifyListeners();
    return false;
  }

  try {
    authStates.set(key, { status: "authenticating", challenge });
    notifyListeners();

    const authEvent = {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["relay", relayUrl],
        ["challenge", challenge],
      ],
      content: "",
    };

    const signed = await signer.signEvent(authEvent as any);

    const ws = findWebSocket(relayUrl);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(["AUTH", signed]));
      } catch {
        authStates.set(key, { status: "failed", error: "Connection closed during auth" });
        notifyListeners();
        return false;
      }
      authStates.set(key, { status: "authenticated", challenge });
      notifyListeners();
      return true;
    }

    authStates.set(key, { status: "failed", error: "WebSocket not connected" });
    notifyListeners();
    return false;
  } catch (err) {
    authStates.set(key, {
      status: "failed",
      error: err instanceof Error ? err.message : "Auth signing failed",
    });
    notifyListeners();
    return false;
  }
}

function findWebSocket(relayUrl: string): WebSocket | null {
  if (!poolRef) return null;
  try {
    const relayPool = poolRef as any;
    if (relayPool.relays) {
      const relay = relayPool.relays.get(relayUrl);
      if (relay?.ws) return relay.ws;
      if (relay) return relay;
    }
    if (relayPool._relays) {
      const relay = relayPool._relays.get(relayUrl);
      if (relay?.ws) return relay.ws;
      if (relay) return relay;
    }
  } catch {}
  return null;
}

export function resetAuthState(relayUrl: string) {
  authStates.delete(normalizeUrl(relayUrl));
  notifyListeners();
}

/** Minimal surface of a pool relay entry used by the Concord plane-AUTH path. */
export interface PoolRelayHandle {
  url?: string;
  challenge?: string;
  send: (message: string) => Promise<void> | void;
}

/**
 * The pool's relay entry for a URL (normalized match, tolerant of nostr-tools'
 * trailing-slash form), or null when not connected. Used by concord-plane-auth
 * to read the pending challenge and direct-send AUTH frames in-order on the
 * live socket.
 */
export function getPoolRelay(relayUrl: string): PoolRelayHandle | null {
  if (!poolRef) return null;
  const target = normalizeUrl(relayUrl).toLowerCase();
  try {
    const relays: Map<string, unknown> | undefined =
      (poolRef as unknown as { relays?: Map<string, unknown>; _relays?: Map<string, unknown> }).relays ??
      (poolRef as unknown as { _relays?: Map<string, unknown> })._relays;
    if (!relays) return null;
    for (const [u, relay] of relays) {
      if (normalizeUrl(u).toLowerCase() === target && relay && typeof (relay as PoolRelayHandle).send === "function") {
        return relay as PoolRelayHandle;
      }
    }
  } catch { /* pool internals unavailable */ }
  return null;
}

let outpostUrlsProvider: (() => Set<string>) | null = null;

export function setOutpostUrlsProvider(provider: () => Set<string>) {
  outpostUrlsProvider = provider;
}

// Relays the user has designated as their OWN DM inbox (kind-10050 + locally
// configured). Reading your own mailbox from an AUTH-gated relay legitimately
// requires proving it's you — the privacy cost is nil since you chose those
// relays — so we auto-AUTH on passive reads for THESE relays only (not the
// broader read/write/fallback set folded into DM reception). Set by the DM
// subsystem; returns raw (un-normalized) URLs.
let ownDMInboxProvider: (() => string[]) | null = null;

export function setOwnDMInboxProvider(provider: () => string[]) {
  ownDMInboxProvider = provider;
}

// Relays cleared for NIP-42 auto-AUTH during a deliberate outbound publish — e.g.
// delivering a gift-wrapped DM to a recipient's auth-required inbox relay
// (auth.nostr1.com, relay.nsec.app, …). Scoped to publishes the user initiated,
// AND time-boxed: the grant is consulted on passive reads too, so a permanent
// session-wide grant would auto-identify the user to a recipient's inbox relay
// on every background read for the rest of the session. url -> grant expiry (ms).
const PUBLISH_AUTH_TTL_MS = 60_000;
const publishAuthAllowed = new Map<string, number>();

export function shouldAutoAuth(relayURL: string): boolean {
  const key = normalizeUrl(relayURL);
  if (isAuthEnabled(key)) return true;
  const grantExpiry = publishAuthAllowed.get(key);
  if (grantExpiry !== undefined) {
    if (Date.now() < grantExpiry) return true;
    publishAuthAllowed.delete(key); // expired — stop leaking into passive reads
  }
  // Own DM inbox: auto-AUTH so we can READ our own mailbox from an auth-gated
  // relay (auth.nostr1.com, inbox.nostr.wine, …). Scoped to the relays we chose
  // as our inbox — never arbitrary relays. Small set, so the linear scan is fine.
  if (ownDMInboxProvider) {
    for (const u of ownDMInboxProvider()) {
      if (normalizeUrl(u) === key) return true;
    }
  }
  if (outpostUrlsProvider) {
    return outpostUrlsProvider().has(key);
  }
  return false;
}

// The actual AUTH sign callback nostr-tools invokes when a relay sends a challenge.
// Extracted so both the pool auth handler and the retroactive publish-time arming
// (allowAuthForPublish) share one implementation.
function buildAuthSigner(relayURL: string): ((evt: EventTemplate) => Promise<VerifiedEvent>) | null {
  const s = globalSigner;
  if (!s) return null;
  return async (evt: EventTemplate): Promise<VerifiedEvent> => {
    const key = normalizeUrl(relayURL);
    authStates.set(key, { status: "authenticating" });
    notifyListeners();
    try {
      const timeoutMs = 15000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const signed = await Promise.race([
        s.signEvent(evt).then((result) => {
          clearTimeout(timer);
          return result;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("auth timed out"));
          }, timeoutMs);
        }),
      ]);
      // NOT "authenticated" — we have only SIGNED something. nostr-tools has
      // not sent the frame yet (AbstractRelay.auth awaits this callback first),
      // and the relay's `OK <id> <bool> <reason>` lands a round-trip later.
      //
      // Writing "authenticated" here was the reason an auth-gated relay could
      // refuse us and still be reported as serving a genuine empty list:
      // relayRefusedUs() only fires on "failed", so a refusal was indexed as a
      // success and the UI told the owner of a four-channel community that it
      // had no channels. Signing is not acceptance. recordAuthVerdict() below
      // writes the real outcome when the relay answers.
      authStates.set(key, { status: "authenticating" });
      notifyListeners();
      return signed as unknown as VerifiedEvent;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Auth signing failed";
      console.warn(`[NIP-42] Auth failed for ${relayURL}: ${msg}`);
      authStates.set(key, {
        status: "failed",
        error: msg,
      });
      notifyListeners();
      // Re-throw rather than returning the UNSIGNED template: nostr-tools'
      // auth() swallows a thrown error (console.warn), but if we hand back an
      // invalid event it sends it as AUTH, the relay rejects it with "auth
      // event validation failed", and that rejection bubbles up unhandled
      // (the dev error overlay on sign-out). Never emit an invalid AUTH event.
      throw err instanceof Error ? err : new Error(msg);
    }
  };
}

/**
 * One `onauth` that stays correctly per-relay across a MULTI-relay read.
 *
 * nostr-tools takes a single `onauth` for a whole relay set, which is exactly
 * the wrong shape for this gate: `shouldAutoAuth` is per-relay on purpose, so
 * a pubkey is never offered to a relay the user hasn't opted into. Handing one
 * relay's signer to the set would authenticate to all of them — the very leak
 * the scoped gate exists to prevent.
 *
 * The way out is that the relay names itself in the request: nostr-tools calls
 * the signer with `makeAuthEvent(this.url, challenge)`, so the template carries
 * a `relay` tag identifying whichever relay is asking. Read it back out and
 * apply the same per-relay gate we would have applied up front.
 *
 * Throwing for an ungated relay is deliberate and is not an error path —
 * AbstractRelay.auth() catches and warns, so the effect is exactly "we declined
 * to authenticate here", which is the policy.
 */
export function createTemplateScopedAuthHandler(): (evt: EventTemplate) => Promise<VerifiedEvent> {
  const perRelay = createPoolAuthHandler();
  return async (evt: EventTemplate): Promise<VerifiedEvent> => {
    const url = (evt as any)?.tags?.find((t: string[]) => t[0] === "relay")?.[1];
    const signer = url ? perRelay(url) : null;
    if (!signer) throw new Error(`auth not enabled for ${url || "unknown relay"}`);
    return signer(evt);
  };
}

/**
 * Reasons an auth promise rejects that are NOT the relay refusing us.
 *
 * nostr-tools rejects the same promise from `closeAllSubscriptions` on an
 * ordinary disconnect and from its own 15s auth timeout. Recording those as
 * "the relay declined our sign-in" would manufacture the mirror image of the
 * bug this fixes — a refusal reported every time a socket closes.
 */
function isNotARefusal(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("connection closed") ||
    m.includes("closed by us") ||
    m.includes("relay connection") ||
    m.includes("timed out") ||
    m.includes("timeout")
  );
}

/**
 * The relay's own verdict on our AUTH — the signal the app already had three
 * times over and threw away at every one.
 *
 * `ok` comes from nostr-tools resolving/rejecting the promise returned by
 * `relay.auth()`, which settles on the relay's `OK <id> <bool> <reason>`. That
 * is the ONLY authority on whether we may read; everything before it is us
 * talking to ourselves.
 */
export function recordAuthVerdict(relayUrl: string, ok: boolean, reason?: string) {
  const key = normalizeUrl(relayUrl);
  if (ok) {
    authStates.set(key, { status: "authenticated" });
    notifyListeners();
    return;
  }
  const message = reason || "the relay declined our sign-in";
  // A disconnect is not a verdict. Leave whatever we knew before standing
  // rather than inventing a refusal the relay never made.
  if (isNotARefusal(message)) return;
  authStates.set(key, { status: "failed", error: message });
  notifyListeners();
}

/**
 * Auth state does not survive the socket it described.
 *
 * A reconnect gets a fresh challenge and is unauthenticated until it answers
 * one; carrying "authenticated" across the gap is how a brand-new socket
 * inherits a claim nothing has verified.
 */
export function clearAuthOnDisconnect(relayUrl: string) {
  const key = normalizeUrl(relayUrl);
  const prev = authStates.get(key);
  if (!prev || prev.status === "none") return;
  authStates.delete(key);
  notifyListeners();
}

export function createPoolAuthHandler(): (relayURL: string) => null | ((evt: EventTemplate) => Promise<VerifiedEvent>) {
  return (relayURL: string) => {
    if (!globalSigner) return null;
    if (!shouldAutoAuth(relayURL)) return null;
    return buildAuthSigner(relayURL);
  };
}

/**
 * Clear these relays for NIP-42 auto-AUTH during a deliberate outbound publish (DM
 * delivery + explicit relay picks). Call BEFORE pool.publish: freshly connected relays
 * pick up an onauth handler via the pool's automaticallyAuth hook, and any relay that's
 * already connected without one is armed retroactively (and re-authed if a challenge is
 * already pending). Scoped to a short window after the publish — a passive read
 * more than PUBLISH_AUTH_TTL_MS later no longer auto-authenticates.
 */
export function allowAuthForPublish(relayUrls: string[]) {
  const expiry = Date.now() + PUBLISH_AUTH_TTL_MS;
  for (const url of relayUrls) {
    publishAuthAllowed.set(normalizeUrl(url), expiry);
  }
  // Arm relays already connected before they were cleared (their onauth is null, so
  // nostr-tools won't auto-auth them on its own).
  if (!poolRef || !globalSigner) return;
  const relays: Map<string, any> | undefined = (poolRef as any).relays;
  if (!relays) return;
  for (const [rUrl, relay] of relays) {
    if (!relay || relay.onauth) continue;
    if (!publishAuthAllowed.has(normalizeUrl(rUrl))) continue;
    const fn = buildAuthSigner(rUrl);
    if (!fn) continue;
    relay.onauth = fn;
    if (relay.challenge) {
      try {
        relay.auth(fn).catch(() => {});
      } catch {}
    }
  }
}

const AUTH_RELAYS_KEY = "nostr_auth_relays";

export function getAuthEnabledRelays(): Set<string> {
  try {
    const stored = localStorage.getItem(AUTH_RELAYS_KEY);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

export function setAuthEnabled(relayUrl: string, enabled: boolean) {
  const current = getAuthEnabledRelays();
  if (enabled) {
    current.add(normalizeUrl(relayUrl));
  } else {
    current.delete(normalizeUrl(relayUrl));
  }
  localStorage.setItem(AUTH_RELAYS_KEY, JSON.stringify(Array.from(current)));
}

export function isAuthEnabled(relayUrl: string): boolean {
  return getAuthEnabledRelays().has(normalizeUrl(relayUrl));
}
