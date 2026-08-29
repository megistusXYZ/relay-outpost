import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ExtensionSigner, NostrConnectSigner, PrivateKeySigner, type ISigner } from "applesauce-signers";
import { loadSettingsFromRelay, initSettingsSync, scheduleSyncToRelay, teardownSettingsSync, handleAccountSwitch } from "@/lib/nip78-settings";
import { loadReadStateFromRelay, initReadStateSync, scheduleReadStateSync, teardownReadStateSync } from "@/lib/read-state-sync";
import { startNewsBookmarkSync, teardownNewsBookmarkSync } from "@/lib/news-bookmark-sync";
import { READSTATE_CHANGED_EVENT } from "@/lib/dm-read";
import { Observable } from "rxjs";
import { eventStore, pool, DEFAULT_RELAYS, fetchProfiles, fetchProfilesCached, throttledPoolSubscribe, startEventStorePruning, startIdleConnectionCleanup } from "@/lib/nostr";
import { getProfileContent, KIND_METADATA, KIND_FOLLOW_LIST, parseFollowList } from "@/lib/nostr-helpers";
import { setGlobalSigner } from "@/lib/nip42-auth";
import { clearBrainstormAuth } from "@/lib/graperank";
import { isReconnectInFlight, setReconnectInFlight, setSignerTimeoutBypass, canShowReconnectToast } from "@/lib/signer-timeout";
import { clearProcessedWraps } from "@/lib/gift-wrap";
import { clearAll as clearDmCache } from "@/lib/dm-cache";
import { cacheFollowEvent } from "@/lib/follow-list";
import { warmInterestsCache } from "@/lib/interests";
import { loadLocalSecret, saveLocalSecret, clearLocalSecret, markNewAccount } from "@/lib/local-account";
import {
  ensureRegistryBoot,
  syncActiveSession,
  removeAccount,
  activateAccount,
  getAccount,
  getActiveAccountPubkey,
  accountDisplayName,
  setPendingAccountToast,
  consumePendingAccountToast,
  updateAccountProfile,
  markExplicitSignOut,
} from "@/lib/account-registry";
import { useToast } from "@/hooks/use-toast";

NostrConnectSigner.subscriptionMethod = (relays, filters) => {
  return new Observable((subscriber) => {
    const requests = relays.flatMap((url: string) =>
      filters.map((f: any) => ({ url, filter: f }))
    );
    const sub = (pool as any).subscribeMap(requests, {
      onevent(event: any) {
        subscriber.next(event as any);
      },
      oneose() {},
      onclose(reason: any) {
        console.warn("[NIP-46] Relay subscription closed:", reason);
      },
    });
    return () => { sub.close(); };
  });
};

NostrConnectSigner.publishMethod = (relays, event) => {
  return Promise.any(pool.publish(relays, event as any));
};

export function isPWAStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

interface ProfileData {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  lud16?: string;
}

type LoginMethod = "extension" | "bunker" | "qr" | "local" | null;

export interface QRLoginState {
  uri: string;
  signer: NostrConnectSigner;
  abort: AbortController;
}

interface NostrAuthState {
  pubkey: string | null;
  signer: ISigner | null;
  profile: ProfileData | null;
  follows: string[];
  isLoggingIn: boolean;
  isReconnecting: boolean;
  signerDisconnected: boolean;
  loginMethod: LoginMethod;
  loginWithExtension: () => Promise<void>;
  loginWithBunker: (bunkerUri: string, silent?: boolean) => Promise<void>;
  loginWithLocalKey: (secretKey: Uint8Array, opts?: { isNewAccount?: boolean; persistPlainSecret?: boolean }) => Promise<void>;
  initQRLogin: () => QRLoginState | null;
  waitForQRLogin: (state: QRLoginState) => Promise<void>;
  cancelQRLogin: (state: QRLoginState) => void;
  login: () => Promise<void>;
  logout: () => void;
  updateFollows: (updater: (prev: string[]) => string[]) => void;
  attemptReconnect: () => Promise<boolean>;
}

const NostrAuthContext = createContext<NostrAuthState>({
  pubkey: null,
  signer: null,
  profile: null,
  follows: [],
  isLoggingIn: false,
  isReconnecting: false,
  signerDisconnected: false,
  loginMethod: null,
  loginWithExtension: async () => {},
  loginWithBunker: async () => {},
  loginWithLocalKey: async () => {},
  initQRLogin: () => null,
  updateFollows: () => {},
  waitForQRLogin: async () => {},
  cancelQRLogin: () => {},
  login: async () => {},
  logout: () => {},
  attemptReconnect: async () => false,
});

export function useNostrAuth() {
  return useContext(NostrAuthContext);
}

const BUNKER_STORAGE_KEY = "relay-outpost-bunker-uri";
export const LOGIN_METHOD_KEY = "relay-outpost-login-method";
const QR_SESSION_KEY = "relay-outpost-qr-session";

// Permissions requested once at NIP-46 connect time. Beyond signing kinds we
// request nip44/nip04 encrypt+decrypt up front so paranoid bunkers (Amber,
// nsec.app, nsecbunker) can grant DM reading/sending as a single app-scoped
// approval instead of prompting on every single decrypt. Kinds 13/1059 cover
// the seal + gift wrap signed when sending NIP-17 DMs.
const NOSTR_CONNECT_PERMISSIONS = [
  ...NostrConnectSigner.buildSigningPermissions([0, 1, 3, 6, 7, 13, 1059, 9735]),
  "nip44_decrypt",
  "nip44_encrypt",
  "nip04_decrypt",
  "nip04_encrypt",
];

function saveQRSession(signer: NostrConnectSigner) {
  try {
    const hex = Array.from(signer.signer.key).map(b => b.toString(16).padStart(2, "0")).join("");
    const data = { key: hex, remote: signer.remote, relays: signer.relays };
    localStorage.setItem(QR_SESSION_KEY, JSON.stringify(data));
  } catch {}
}

function loadQRSession(): NostrConnectSigner | null {
  try {
    const raw = localStorage.getItem(QR_SESSION_KEY);
    if (!raw) return null;
    const { key, remote, relays } = JSON.parse(raw);
    if (!key || !remote || !relays?.length) return null;
    const keyBytes = new Uint8Array(key.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
    const clientSigner = new PrivateKeySigner(keyBytes);
    const connectSigner = new NostrConnectSigner({
      relays,
      signer: clientSigner,
      remote,
    });
    return connectSigner;
  } catch {
    localStorage.removeItem(QR_SESSION_KEY);
    return null;
  }
}

function clearQRSession() {
  try { localStorage.removeItem(QR_SESSION_KEY); } catch {}
}

function waitForNostrExtension(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.nostr) {
      resolve(true);
      return;
    }
    const interval = 150;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += interval;
      if (window.nostr) {
        clearInterval(timer);
        resolve(true);
      } else if (elapsed >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, interval);
  });
}

const PUBKEY_CACHE_KEY = "relay-outpost-pubkey";

// Multi-account boot reconciliation must run ONCE, before the provider reads
// the singleton session keys below: it adopts a pre-registry session into the
// account registry, heals singleton credentials an aborted flow cleared, and
// re-activates a remaining account when the active one's singletons vanished.
let registryBootDone = false;

export function NostrAuthProvider({ children }: { children: ReactNode }) {
  if (!registryBootDone) {
    registryBootDone = true;
    try { ensureRegistryBoot(); } catch {}
  }
  const savedMethod = localStorage.getItem(LOGIN_METHOD_KEY);
  // "local" is auto-restored ONLY when the user opted into the persistent
  // "stay signed in on this device" path (which writes a plaintext nsec to
  // LOCAL_SECRET_STORAGE_KEY). Users on the encrypted-blob path still see
  // the unlock prompt — their passphrase opt-in is honored.
  const initialLocalSecret: Uint8Array | null = (() => {
    if (savedMethod !== "local") return null;
    return loadLocalSecret();
  })();
  const initialLocalSigner: PrivateKeySigner | null = initialLocalSecret
    ? (() => {
        try { return new PrivateKeySigner(initialLocalSecret); } catch { return null; }
      })()
    : null;
  const hasLocalAutoRestore = !!initialLocalSigner;
  const hasRemoteSavedSession = savedMethod === "extension" || savedMethod === "bunker" || savedMethod === "qr";
  const hasSavedSession = hasRemoteSavedSession || hasLocalAutoRestore;

  const [pubkey, setPubkey] = useState<string | null>(
    hasSavedSession ? localStorage.getItem(PUBKEY_CACHE_KEY) : null
  );
  const [signer, setSigner] = useState<ISigner | null>(initialLocalSigner);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [follows, setFollows] = useState<string[]>([]);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // Local auto-restore is synchronous; only the network-dependent methods
  // need the "reconnecting" gate.
  const [isReconnecting, setIsReconnecting] = useState(hasRemoteSavedSession);
  const [signerDisconnected, setSignerDisconnected] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>(
    hasSavedSession ? (savedMethod as LoginMethod) : null
  );
  const { toast } = useToast();

  // Belt-and-braces: when we auto-restored a local session above using the
  // cached pubkey, verify it actually matches the secret on disk. A stale
  // cache would silently sign as the wrong identity. This runs once on
  // mount and only writes when the cache was wrong.
  useEffect(() => {
    if (!hasLocalAutoRestore || !initialLocalSigner) return;
    let cancelled = false;
    initialLocalSigner.getPublicKey().then((pk) => {
      if (cancelled || !pk) return;
      const cached = localStorage.getItem(PUBKEY_CACHE_KEY);
      if (pk !== cached) {
        try { localStorage.setItem(PUBKEY_CACHE_KEY, pk); } catch {}
        setPubkey(pk);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setGlobalSigner(signer);
  }, [signer]);

  // Invalidate the cached Brainstorm session token whenever the active signer
  // changes (login, logout, switch from extension to nsec, bunker reconnect).
  // The token is keyed to the previous signer's identity; the next status
  // check will re-authenticate with whatever signer is now active. We skip
  // the very first transition so an auto-restored session keeps its cached
  // sessionStorage token across reloads and doesn't re-prompt the signer.
  const previousSignerRef = useRef<ISigner | null>(initialLocalSigner);
  useEffect(() => {
    const prev = previousSignerRef.current;
    previousSignerRef.current = signer;
    if (prev === signer) return;
    if (prev === null && signer !== null && hasSavedSession) return;
    try { clearBrainstormAuth(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer]);

  useEffect(() => {
    startEventStorePruning(pubkey ?? undefined);
    startIdleConnectionCleanup();
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey) {
      setProfile(null);
      setFollows([]);
      return;
    }

    const existing = eventStore.getReplaceable(KIND_METADATA, pubkey);
    if (existing) {
      setProfile(getProfileContent(existing) ?? null);
    }

    let latestProfile: any = null;
    let latestFollowList: any = null;

    // Profile (kind-0) must be fetched from a BROAD set — same footgun as the follow
    // list: a narrow 4-relay set meant metadata living on purplepag.es / nostr.band /
    // primal never hydrated, leaving profile (and the user's avatar) blank everywhere.
    const authRelays = Array.from(new Set([
      ...DEFAULT_RELAYS.slice(0, 4), "wss://purplepag.es", "wss://relay.nostr.band", "wss://relay.primal.net",
    ]));
    // Broad set for the follow list specifically — a narrow set was a root cause
    // of the wipe bug: if the kind-3 wasn't on these relays it never hydrated,
    // leaving in-memory follows empty so a follow click clobbered the real list.
    const followRelays = Array.from(new Set([
      ...DEFAULT_RELAYS, "wss://purplepag.es", "wss://relay.nostr.band", "wss://relay.primal.net",
    ]));
    const profileSub = throttledPoolSubscribe(authRelays, { kinds: [KIND_METADATA], authors: [pubkey] }, {
      onevent(event) {
        eventStore.add(event);
        if (!latestProfile || event.created_at > latestProfile.created_at) {
          latestProfile = event;
          setProfile(getProfileContent(event) ?? null);
        }
      },
      oneose() {
        profileSub.close();
      },
    });

    const followSub = throttledPoolSubscribe(followRelays, { kinds: [KIND_FOLLOW_LIST], authors: [pubkey] }, {
      onevent(event) {
        eventStore.add(event);
        if (!latestFollowList || event.created_at > latestFollowList.created_at) {
          latestFollowList = event;
          // Durable last-known-good cache (the safe append base used by every
          // follow handler). Only for the newest copy — not once per relay —
          // so the login burst doesn't re-parse/serialize the kind-3 8-9 times.
          cacheFollowEvent(event);
          const followPubkeys = Array.from(new Set(parseFollowList(event)));
          setFollows(followPubkeys);

          if (followPubkeys.length > 0) {
            const batch = followPubkeys.slice(0, 100);
            fetchProfilesCached(batch);
          }
        }
      },
      oneose() {
        followSub.close();
        if (latestFollowList) {
          const snapshotKey = `flight_log_contacts_${pubkey.slice(0, 16)}`;
          try {
            const existing = localStorage.getItem(snapshotKey);
            if (!existing) {
              const pubkeys = parseFollowList(latestFollowList);
              localStorage.setItem(snapshotKey, JSON.stringify({
                pubkeys,
                timestamp: latestFollowList.created_at,
              }));
            }
          } catch {}
        }
      },
    });

    // Warm the durable kind-10015 "Interests" (followed hashtags) cache the same
    // way we warm the follow list — so any later follow/unfollow builds on the
    // real base and can never wipe another client's portable hashtag list.
    warmInterestsCache(pubkey);

    return () => {
      profileSub.close();
      followSub.close();
    };
  }, [pubkey]);

  // Multi-account: an IN-PLACE account change (add-account signs B in on top
  // of A without a logout in between) must drop A's in-memory attempted-wrap
  // set — otherwise B's DM decrypt path is gated by A's wrap ids. Full
  // switches between existing accounts reload the page instead (see
  // account-registry.ts), which resets this trivially.
  const prevAccountRef = useRef<string | null>(pubkey);
  useEffect(() => {
    const prev = prevAccountRef.current;
    prevAccountRef.current = pubkey;
    if (prev && pubkey && prev !== pubkey) {
      try { clearProcessedWraps(); } catch {}
    }
  }, [pubkey]);

  // Multi-account: cache the active account's display name + avatar on its
  // registry entry whenever the profile hydrates, so the switcher can render
  // every known account without network work.
  useEffect(() => {
    if (!pubkey || !profile) return;
    try {
      updateAccountProfile(pubkey, {
        label: profile.display_name || profile.name || null,
        picture: profile.picture || null,
      });
    } catch {}
  }, [pubkey, profile]);

  // Multi-account: surface the post-reload toast queued by a switch/sign-out
  // (the reload that guarantees clean per-account state also eats any toast
  // fired before it, so the message is handed off via sessionStorage).
  // Consumed once at mount, but SHOWN only after the boot restore resolves —
  // firing it immediately would burn the toast's 3s lifetime behind the
  // full-screen boot loader where nobody can see it.
  const pendingBootToastRef = useRef<string | null>(null);
  useEffect(() => {
    try { pendingBootToastRef.current = consumePendingAccountToast(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (isReconnecting) return;
    const msg = pendingBootToastRef.current;
    if (!msg) return;
    pendingBootToastRef.current = null;
    // Local auto-restore never sets isReconnecting, so the app's boot loader
    // can still be on screen at this point — 3s clears it in practice.
    const timer = setTimeout(() => toast({ title: msg }), 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReconnecting]);

  const loginWithExtension = useCallback(async (reconnect = false) => {
    if (!window.nostr) {
      if (isPWAStandalone()) {
        if (!reconnect) {
          toast({
            title: "No signal in app mode",
            description: "Browser extensions aren't available here. Try the Signer app (QR) or a connection link to connect.",
            variant: "destructive",
          });
        }
        return;
      }
      if (isIOSDevice() && !reconnect) {
        toast({
          title: "No signer detected",
          description: "Install Nostash from the App Store for Safari. Extensions only work in the browser, not home screen apps.",
          variant: "destructive",
        });
        return;
      }

      setIsLoggingIn(true);
      const waitTime = isIOSDevice() ? 8000 : 3000;
      const found = await waitForNostrExtension(waitTime);
      if (!found) {
        setIsLoggingIn(false);
        if (reconnect) {
          setSignerDisconnected(true);
          return;
        }
        toast({
          title: "No signer detected",
          description: "Install a browser extension like Alby or nos2x, or try the Signer app (QR) for mobile.",
          variant: "destructive",
        });
        return;
      }
    }

    setIsLoggingIn(true);
    try {
      const ext = new ExtensionSigner();
      // getPublicKey() is otherwise unbounded. Some signers (e.g. Continuum, which
      // port-scans localhost on first call) are slow but legitimate, so we use a
      // generous 30s backstop — long enough for a slow signer or a first-time
      // permission prompt, but it prevents a truly-hung signer from spinning forever.
      let pubkeyTimer: ReturnType<typeof setTimeout> | undefined;
      const userPubkey = await Promise.race([
        ext.getPublicKey(),
        new Promise<string>((_, reject) => {
          pubkeyTimer = setTimeout(
            () => reject(new Error("Your signer didn't respond in time — make sure the signer app/extension is running and this site is approved.")),
            30_000,
          );
        }),
      ]).finally(() => clearTimeout(pubkeyTimer));
      setSigner(ext);
      setPubkey(userPubkey);
      setLoginMethod("extension");
      setIsReconnecting(false);
      setSignerDisconnected(false);
      localStorage.setItem(LOGIN_METHOD_KEY, "extension");
      localStorage.setItem(PUBKEY_CACHE_KEY, userPubkey);
      // Registry: record/refresh this account. The extension exposes ONE
      // identity IT controls — syncActiveSession keeps at most one extension
      // entry and updates its pubkey if the extension switched identities.
      try { syncActiveSession(); } catch {}
    } catch (err) {
      console.error("Extension login failed:", err);
      if (reconnect) {
        setIsReconnecting(false);
        setSignerDisconnected(true);
      } else {
        setIsReconnecting(false);
        setPubkey(null);
        setSigner(null);
        setLoginMethod(null);
        localStorage.removeItem(PUBKEY_CACHE_KEY);
        localStorage.removeItem(LOGIN_METHOD_KEY);
        // Surface the signer's actual error (e.g. "Continuum signer not found
        // (ports 5000–5010)") so the user can tell app-not-running/wrong-port from
        // origin-not-approved. Rendered as escaped text by the toast (no XSS).
        const detail = err instanceof Error && err.message ? ` (${err.message.slice(0, 200)})` : "";
        toast({
          title: "Sign in failed",
          description: `Could not get your public key from the extension. Make sure it's unlocked and this site is approved, then try again.${detail}`,
          variant: "destructive",
        });
      }
    } finally {
      setIsLoggingIn(false);
    }
  }, [toast]);

  const loginWithBunker = useCallback(async (bunkerUri: string, silent = false) => {
    setIsLoggingIn(true);
    try {
      const connectSigner = await NostrConnectSigner.fromBunkerURI(bunkerUri, {
        permissions: NOSTR_CONNECT_PERMISSIONS,
      });

      await connectSigner.connect();
      const userPubkey = await connectSigner.getPublicKey();

      setSigner(connectSigner);
      setPubkey(userPubkey);
      setLoginMethod("bunker");
      setIsReconnecting(false);
      localStorage.setItem(BUNKER_STORAGE_KEY, bunkerUri);
      localStorage.setItem(LOGIN_METHOD_KEY, "bunker");
      localStorage.setItem(PUBKEY_CACHE_KEY, userPubkey);
      try { syncActiveSession(); } catch {}
    } catch (err) {
      console.error("Bunker login failed:", err);
      setIsReconnecting(false);
      setPubkey(null);
      setSigner(null);
      setLoginMethod(null);
      localStorage.removeItem(PUBKEY_CACHE_KEY);
      localStorage.removeItem(LOGIN_METHOD_KEY);
      localStorage.removeItem(BUNKER_STORAGE_KEY);
      if (!silent) {
        toast({
          title: "Remote signer connection failed",
          description: err instanceof Error ? err.message : "Could not connect to the remote signer. Check your bunker:// URI.",
          variant: "destructive",
        });
      }
    } finally {
      setIsLoggingIn(false);
    }
  }, [toast]);

  const initQRLogin = useCallback(() => {
    try {
      const clientSigner = new PrivateKeySigner();
      const qrRelays = [
        "wss://relay.nsec.app",
        "wss://relay.primal.net",
        "wss://relay.damus.io",
        "wss://nos.lol",
        "wss://relay.snort.social",
      ];
      const connectSigner = new NostrConnectSigner({
        relays: qrRelays,
        signer: clientSigner,
      });
      const uri = connectSigner.getNostrConnectURI({
        name: "Relay Outpost",
        url: window.location.origin,
        permissions: NOSTR_CONNECT_PERMISSIONS,
      });
      const abort = new AbortController();
      return { uri, signer: connectSigner, abort };
    } catch (err) {
      console.error("Failed to init QR login:", err);
      toast({
        title: "QR login setup failed",
        description: "Could not generate connection code.",
        variant: "destructive",
      });
      return null;
    }
  }, [toast]);

  const waitForQRLogin = useCallback(async (state: QRLoginState) => {
    setIsLoggingIn(true);
    try {
      await state.signer.open();
      await state.signer.waitForSigner(state.abort.signal);
      const userPubkey = await state.signer.getPublicKey();
      setSigner(state.signer);
      setPubkey(userPubkey);
      setLoginMethod("qr");
      setIsReconnecting(false);
      localStorage.setItem(LOGIN_METHOD_KEY, "qr");
      localStorage.setItem(PUBKEY_CACHE_KEY, userPubkey);
      saveQRSession(state.signer);
      try { syncActiveSession(); } catch {}
    } catch (err: any) {
      if (err?.name === "AbortError" || state.abort.signal.aborted) return;
      console.error("QR login failed:", err);
      try { state.signer.close(); } catch {}
      toast({
        title: "Remote signer connection failed",
        description: "The signer did not respond. Try again or use another method.",
        variant: "destructive",
      });
    } finally {
      setIsLoggingIn(false);
    }
  }, [toast]);

  const loginWithLocalKey = useCallback(async (
    secretKey: Uint8Array,
    opts: { isNewAccount?: boolean; persistPlainSecret?: boolean } = {},
  ) => {
    setIsLoggingIn(true);
    try {
      const localSigner = new PrivateKeySigner(secretKey);
      const userPubkey = await localSigner.getPublicKey();
      setSigner(localSigner);
      setPubkey(userPubkey);
      setLoginMethod("local");
      setIsReconnecting(false);
      setSignerDisconnected(false);
      localStorage.setItem(LOGIN_METHOD_KEY, "local");
      localStorage.setItem(PUBKEY_CACHE_KEY, userPubkey);
      // Opt-in persistence: when the caller has chosen the "stay signed in
      // on this device" path, save the plaintext secret so the bootstrap
      // can auto-restore on the next load. Encrypted-blob users skip this
      // and continue to see the unlock prompt, honoring their opt-in.
      if (opts.persistPlainSecret) {
        saveLocalSecret(secretKey);
      }
      // Remember accounts created in-app so first-run nudges (Get Started
      // checklist) only show for genuinely new users, never imported keys.
      if (opts.isNewAccount) {
        markNewAccount(userPubkey);
      }
      // Registry: record this account and mirror its (already-written)
      // singleton credentials into per-pubkey slots. The plaintext secret is
      // mirrored ONLY when the opt-in persist path above actually wrote it.
      try { syncActiveSession(); } catch {}
      try {
        if (localStorage.getItem("debug-auth") === "1") {
          // eslint-disable-next-line no-console
          console.log("[auth] loginWithLocalKey: setPubkey", userPubkey);
        }
      } catch {}
    } catch (err) {
      console.error("Local key login failed:", err);
      toast({
        title: "Sign in failed",
        description: "Could not load that key. Please try again.",
        variant: "destructive",
      });
      throw err;
    } finally {
      setIsLoggingIn(false);
    }
  }, [toast]);

  const cancelQRLogin = useCallback((state: QRLoginState) => {
    state.abort.abort();
    try { state.signer.close(); } catch {}
    setIsLoggingIn(false);
  }, []);

  const login = useCallback(async () => {
    await loginWithExtension();
  }, [loginWithExtension]);

  const reconnectCancelledRef = useRef(false);

  const logout = useCallback(() => {
    reconnectCancelledRef.current = true;
    teardownSettingsSync();
    if (signer && signer instanceof NostrConnectSigner) {
      try {
        signer.close();
      } catch {}
    }
    const wasLocal = loginMethod === "local";
    const localPubkey = pubkey;
    // Explicit sign-out: mark it BEFORE touching storage so the boot self-heal
    // can never mistake the emptied session slots for an aborted flow and
    // silently log the user back in on refresh. The deliberate switch-to-next
    // branch below clears the marker via activateAccount (that IS an explicit
    // new session); a full sign-out leaves it set until the next real login.
    markExplicitSignOut();
    // Multi-account: signing out removes ONLY the active account — its
    // registry entry, its per-pubkey namespaced credentials, and (below) its
    // singleton session slots. Other known accounts keep their credentials;
    // if any remain, we switch to the next one (full reload — see
    // account-registry.ts) instead of leaving the user fully logged out.
    let nextPubkey: string | null = null;
    try {
      const active = getActiveAccountPubkey() ?? localPubkey;
      if (active) nextPubkey = removeAccount(active).nextPubkey;
    } catch {}
    setPubkey(null);
    setSigner(null);
    setProfile(null);
    setFollows([]);
    setLoginMethod(null);
    setIsReconnecting(false);
    setSignerDisconnected(false);
    // Drop the in-memory attempted-wrap set so the next account's DM decrypt
    // path isn't gated by this account's wrap ids (the persistent ledger is
    // per-owner and re-seeded on next login).
    try { clearProcessedWraps(); } catch {}
    // Drop the Brainstorm session token so the next sign-in re-authenticates
    // with whatever signer is active then (extension, nsec, bunker, etc.).
    try { clearBrainstormAuth(); } catch {}
    localStorage.removeItem(BUNKER_STORAGE_KEY);
    localStorage.removeItem(LOGIN_METHOD_KEY);
    localStorage.removeItem(PUBKEY_CACHE_KEY);
    // For local accounts, logout must wipe the encrypted key blob, the
    // plaintext "stay signed in" secret, and any per-account onboarding marker.
    if (wasLocal) {
      try {
        localStorage.removeItem("relay-outpost-local-account");
        clearLocalSecret();
        // Clear "ask me again" dismissal markers so the next sign-in on
        // this device sees the stay-signed-in / passkey nudges fresh.
        localStorage.removeItem("relay-outpost-stay-nudge-dismissed");
        localStorage.removeItem("relay-outpost-passkey-nudge-dismissed");
        if (localPubkey) {
          const raw = localStorage.getItem("relay-outpost-onboarding-complete");
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
              const next = arr.filter((p: string) => p !== localPubkey);
              if (next.length === 0) localStorage.removeItem("relay-outpost-onboarding-complete");
              else localStorage.setItem("relay-outpost-onboarding-complete", JSON.stringify(next));
            }
          }
        }
      } catch {}
    }
    clearQRSession();
    // Privacy on sign-out: don't leave this account's decrypted DM plaintext
    // (relay-outpost-dms) or its spend-capable wallet credential on the device.
    // clearDmCache is per-owner; the NWC URI embeds a spend secret.
    if (localPubkey) { try { void clearDmCache(localPubkey); } catch {} }
    try { localStorage.removeItem("relay-outpost-nwc-uri"); } catch {}
    // Another account remains on this device: restore its credentials into
    // the singleton slots and reload into it. The reload guarantees zero
    // cross-account state bleed; the toast (shown after reload) tells the
    // user what happened instead of silently changing identity.
    if (nextPubkey) {
      try {
        const next = getAccount(nextPubkey);
        if (activateAccount(nextPubkey)) {
          setPendingAccountToast(
            `Signed out — switched to ${next ? accountDisplayName(next) : "your other account"}`,
          );
          window.location.reload();
        }
      } catch {}
    }
  }, [toast, signer, loginMethod, pubkey]);

  useEffect(() => {
    reconnectCancelledRef.current = false;
    const savedMethod = localStorage.getItem(LOGIN_METHOD_KEY);

    const clearSavedSession = () => {
      setIsReconnecting(false);
      setPubkey(null);
      setSigner(null);
      setLoginMethod(null);
      localStorage.removeItem(LOGIN_METHOD_KEY);
      localStorage.removeItem(PUBKEY_CACHE_KEY);
      localStorage.removeItem(BUNKER_STORAGE_KEY);
    };

    if (savedMethod === "extension") {
      if (isPWAStandalone()) {
        console.warn("Extension login saved but unavailable in PWA standalone mode");
        clearSavedSession();
        return;
      }
      const waitTime = isIOSDevice() ? 8000 : 3000;
      waitForNostrExtension(waitTime).then((available) => {
        if (reconnectCancelledRef.current) return;
        if (available) {
          loginWithExtension(true).then(() => setSignerDisconnected(false));
        } else if (isIOSDevice()) {
          setTimeout(() => {
            if (reconnectCancelledRef.current) return;
            if (window.nostr) {
              loginWithExtension(true).then(() => setSignerDisconnected(false));
            } else {
              console.warn("Extension not detected after iOS retry — signer disconnected");
              setIsReconnecting(false);
              setSigner(null);
              setSignerDisconnected(true);
            }
          }, 5000);
        } else {
          console.warn("Extension not detected — signer disconnected");
          setIsReconnecting(false);
          setSigner(null);
          setSignerDisconnected(true);
        }
      });
    } else if (savedMethod === "bunker") {
      const savedUri = localStorage.getItem(BUNKER_STORAGE_KEY);
      if (savedUri) {
        loginWithBunker(savedUri, true).catch(() => {
          if (!reconnectCancelledRef.current) {
            clearSavedSession();
          }
        });
      } else {
        clearSavedSession();
      }
    } else if (savedMethod === "qr") {
      const restored = loadQRSession();
      if (restored) {
        restored.open().then(async () => {
          if (reconnectCancelledRef.current) return;
          try {
            const pk = await Promise.race([
              restored.getPublicKey(),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 5000)),
            ]);
            if (pk) {
              setSigner(restored);
              setPubkey(pk);
              setLoginMethod("qr");
              setIsReconnecting(false);
              setSignerDisconnected(false);
            } else {
              setIsReconnecting(false);
              setSignerDisconnected(true);
            }
          } catch {
            setIsReconnecting(false);
            setSignerDisconnected(true);
          }
        }).catch(() => {
          if (!reconnectCancelledRef.current) {
            setIsReconnecting(false);
            setSignerDisconnected(true);
          }
        });
      } else {
        clearSavedSession();
        clearQRSession();
      }
    } else {
      setIsReconnecting(false);
    }

    return () => {
      reconnectCancelledRef.current = true;
    };
  }, []);

  const lastAuthCheckRef = useRef<number>(0);
  const lastHiddenAtRef = useRef<number>(0);
  const lastNavAtRef = useRef<number>(0);
  const disconnectedAtRef = useRef<number>(0);

  const isIOSRef = useRef(isIOSDevice());
  const isIOSExtensionSigner = isIOSRef.current && loginMethod === "extension";

  useEffect(() => {
    setSignerTimeoutBypass(isIOSExtensionSigner);
    return () => {
      setSignerTimeoutBypass(false);
    };
  }, [isIOSExtensionSigner]);

  useEffect(() => {
    const onPopState = () => { lastNavAtRef.current = Date.now(); };
    window.addEventListener("popstate", onPopState);
    const origPush = window.history.pushState.bind(window.history);
    const origReplace = window.history.replaceState.bind(window.history);
    window.history.pushState = function (...args: Parameters<typeof origPush>) {
      lastNavAtRef.current = Date.now();
      return origPush(...args);
    };
    window.history.replaceState = function (...args: Parameters<typeof origReplace>) {
      lastNavAtRef.current = Date.now();
      return origReplace(...args);
    };
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.history.pushState = origPush;
      window.history.replaceState = origReplace;
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastHiddenAtRef.current = Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;
      if (isLoggingIn) return;

      if (Date.now() - lastNavAtRef.current < 3000) return;

      const hiddenDuration = lastHiddenAtRef.current > 0 ? Date.now() - lastHiddenAtRef.current : 0;

      if (signerDisconnected && pubkey) {
        const method = loginMethod || (localStorage.getItem(LOGIN_METHOD_KEY) as LoginMethod);
        if (method === "extension" && window.nostr) {
          loginWithExtension(true).then(async () => {
            try {
              const pk = await window.nostr?.getPublicKey?.();
              if (pk) {
                setSignerDisconnected(false);
                const elapsed = disconnectedAtRef.current > 0 ? Date.now() - disconnectedAtRef.current : Infinity;
                if (elapsed > 2000 && canShowReconnectToast()) {
                  toast({ title: "Signer reconnected", description: "Your extension is back online." });
                }
              }
            } catch {}
          });
        } else if (method === "bunker") {
          const savedUri = localStorage.getItem(BUNKER_STORAGE_KEY);
          if (savedUri) {
            loginWithBunker(savedUri, true).then(async () => {
              await new Promise((r) => setTimeout(r, 100));
              if (signerRef.current) {
                setSignerDisconnected(false);
                const elapsed = disconnectedAtRef.current > 0 ? Date.now() - disconnectedAtRef.current : Infinity;
                if (elapsed > 2000 && canShowReconnectToast()) {
                  toast({ title: "Signer reconnected", description: "Your remote signer is back online." });
                }
              }
            });
          }
        } else if (method === "qr" && signerRef.current) {
          Promise.race([
            signerRef.current.getPublicKey(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 5000)),
          ]).then(() => {
            setSignerDisconnected(false);
            const elapsed = disconnectedAtRef.current > 0 ? Date.now() - disconnectedAtRef.current : Infinity;
            if (elapsed > 2000 && canShowReconnectToast()) {
              toast({ title: "Signer reconnected", description: "Your remote signer is back online." });
            }
          }).catch(() => {});
        }
        lastAuthCheckRef.current = Date.now();
        if (hiddenDuration > 5 * 60 * 1000) {
          window.dispatchEvent(new CustomEvent("nostr-soft-refresh"));
        }
        return;
      }

      if (pubkey && hiddenDuration > 5 * 60 * 1000) {
        window.dispatchEvent(new CustomEvent("nostr-soft-refresh"));
      }

      const now = Date.now();
      if (now - lastAuthCheckRef.current < 5000) return;
      lastAuthCheckRef.current = now;

      if (pubkey) {
        const method = loginMethod || (localStorage.getItem(LOGIN_METHOD_KEY) as LoginMethod);
        if (method === "extension" && !window.nostr) {
          // On mobile (iOS Safari/NoStash) window.nostr is often re-injected a beat
          // after the app foregrounds. Don't declare a disconnect on that transient
          // gap — give the extension a short window to reappear first, so we don't
          // start a needless disconnect→reconnect→toast cycle on every focus.
          waitForNostrExtension(1500).then((available) => {
            if (!available) {
              setSignerDisconnected(true);
              disconnectedAtRef.current = Date.now();
            }
          });
        }
        return;
      }
      const savedMethod = localStorage.getItem(LOGIN_METHOD_KEY);
      if (savedMethod === "bunker") {
        const savedUri = localStorage.getItem(BUNKER_STORAGE_KEY);
        if (savedUri) {
          loginWithBunker(savedUri, true);
        }
      } else if (savedMethod === "qr") {
        const restored = loadQRSession();
        if (restored) {
          restored.open().then(async () => {
            try {
              const pk = await Promise.race([
                restored.getPublicKey(),
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 5000)),
              ]);
              if (pk) {
                setSigner(restored);
                setPubkey(pk);
                setLoginMethod("qr");
              } else {
                setSignerDisconnected(true);
              }
            } catch {
              setSignerDisconnected(true);
            }
          }).catch(() => {
            setSignerDisconnected(true);
          });
        } else {
          setSignerDisconnected(true);
        }
      } else if (savedMethod === "extension" && window.nostr) {
        loginWithExtension(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pubkey, signer, isLoggingIn, signerDisconnected, loginMethod, loginWithBunker, loginWithExtension]);

  useEffect(() => {
    if (!pubkey || !signerDisconnected || loginMethod !== "extension") return;
    const interval = setInterval(() => {
      if (window.nostr) {
        clearInterval(interval);
        loginWithExtension(true).then(() => setSignerDisconnected(false));
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [pubkey, signerDisconnected, loginMethod, loginWithExtension]);

  const signerRef = useRef(signer);
  signerRef.current = signer;

  const attemptReconnect = useCallback(async (): Promise<boolean> => {
    const method = loginMethod || (localStorage.getItem(LOGIN_METHOD_KEY) as LoginMethod);
    if (!method) return false;
    // A local in-app key is always present — it can't disconnect. Treat it as
    // already connected so a timeout (main-thread jank) is never read as a drop.
    if (method === "local") { setSignerDisconnected(false); return true; }
    try {
      if (method === "extension") {
        if (!window.nostr) return false;
        await loginWithExtension(true);
        const pk = await window.nostr.getPublicKey?.();
        if (!pk) return false;
        setSignerDisconnected(false);
        return true;
      }
      if (method === "bunker") {
        const savedUri = localStorage.getItem(BUNKER_STORAGE_KEY);
        if (!savedUri) return false;
        await loginWithBunker(savedUri, true);
        await new Promise((r) => setTimeout(r, 100));
        if (!signerRef.current) return false;
        setSignerDisconnected(false);
        return true;
      }
      if (method === "qr") {
        if (signerRef.current) {
          try {
            const pk = await Promise.race([
              signerRef.current.getPublicKey(),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 5000)),
            ]);
            if (pk) { setSignerDisconnected(false); return true; }
          } catch {}
        }
        const restored = loadQRSession();
        if (!restored) return false;
        try {
          await restored.open();
          const pk = await Promise.race([
            restored.getPublicKey(),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 5000)),
          ]);
          if (!pk) { try { restored.close(); } catch {} return false; }
          setSigner(restored);
          setPubkey(pk);
          setSignerDisconnected(false);
          return true;
        } catch {
          try { restored.close(); } catch {}
          clearQRSession();
          return false;
        }
      }
    } catch {
      return false;
    }
    return false;
  }, [loginMethod, loginWithExtension, loginWithBunker]);

  useEffect(() => {
    if (!pubkey) return;
    const handleSignerFailure = async () => {
      if (signerDisconnected || isReconnectInFlight()) return;
      // A local in-app key never disconnects — a signer-failure here is just a
      // timeout from main-thread jank, not a dropped signer. Ignore it entirely so
      // nsec users are never flagged disconnected or shown the reconnect toast.
      const method = loginMethod || (localStorage.getItem(LOGIN_METHOD_KEY) as LoginMethod);
      if (method === "local") return;
      const failedAt = Date.now();
      setSignerDisconnected(true);
      disconnectedAtRef.current = failedAt;
      setReconnectInFlight(true);
      try {
        const ok = await attemptReconnect();
        if (ok) {
          const elapsed = Date.now() - failedAt;
          if (elapsed > 2000 && canShowReconnectToast()) {
            toast({ title: "Signer reconnected", description: "Please try your action again." });
          }
        }
      } finally {
        setReconnectInFlight(false);
      }
    };
    window.addEventListener("signer-failure", handleSignerFailure);
    return () => window.removeEventListener("signer-failure", handleSignerFailure);
  }, [pubkey, signerDisconnected, attemptReconnect, toast]);

  const settingsSyncInitRef = useRef(false);

  useEffect(() => {
    if (!pubkey || !signer) {
      teardownSettingsSync();
      settingsSyncInitRef.current = false;
      return;
    }
    if (settingsSyncInitRef.current) return;
    settingsSyncInitRef.current = true;

    handleAccountSwitch(pubkey);
    initSettingsSync(pubkey, signer);

    const delayTimer = setTimeout(() => {
      loadSettingsFromRelay(pubkey, signer).catch(() => {});
    }, 2000);

    const handleSync = () => scheduleSyncToRelay();

    window.addEventListener("nip78-trigger-sync", handleSync);

    return () => {
      clearTimeout(delayTimer);
      window.removeEventListener("nip78-trigger-sync", handleSync);
      teardownSettingsSync();
      settingsSyncInitRef.current = false;
    };
  }, [pubkey, signer]);

  // Cross-device READ/SEEN state sync (notif last-seen + per-DM last-read).
  // Separate NIP-78 doc from settings; MONOTONIC merge (never un-read).
  const readStateSyncInitRef = useRef(false);

  useEffect(() => {
    if (!pubkey || !signer) {
      teardownReadStateSync();
      readStateSyncInitRef.current = false;
      return;
    }
    if (readStateSyncInitRef.current) return;
    readStateSyncInitRef.current = true;

    initReadStateSync(pubkey, signer);

    const delayTimer = setTimeout(() => {
      loadReadStateFromRelay(pubkey, signer).catch(() => {});
    }, 2500);

    const handleReadStateChange = () => scheduleReadStateSync();
    window.addEventListener(READSTATE_CHANGED_EVENT, handleReadStateChange);

    return () => {
      clearTimeout(delayTimer);
      window.removeEventListener(READSTATE_CHANGED_EVENT, handleReadStateChange);
      teardownReadStateSync();
      readStateSyncInitRef.current = false;
    };
  }, [pubkey, signer]);

  // Cross-device NEWS BOOKMARK sync (encrypted NIP-78, additive union merge
  // with tombstoned deletes). Separate doc from settings and read-state; the
  // lib wires its own change/storage/visibility listeners + delayed hydrate.
  const newsBookmarkSyncInitRef = useRef(false);

  useEffect(() => {
    if (!pubkey || !signer) {
      teardownNewsBookmarkSync();
      newsBookmarkSyncInitRef.current = false;
      return;
    }
    if (newsBookmarkSyncInitRef.current) return;
    newsBookmarkSyncInitRef.current = true;

    const stop = startNewsBookmarkSync(pubkey, signer);

    return () => {
      stop();
      newsBookmarkSyncInitRef.current = false;
    };
  }, [pubkey, signer]);

  return (
    <NostrAuthContext.Provider value={{
      pubkey, signer, profile, follows, isLoggingIn, isReconnecting, signerDisconnected, loginMethod,
      loginWithExtension, loginWithBunker, loginWithLocalKey, initQRLogin, waitForQRLogin, cancelQRLogin, login, logout,
      updateFollows: (updater: (prev: string[]) => string[]) => setFollows(updater),
      attemptReconnect,
    }}>
      {children}
    </NostrAuthContext.Provider>
  );
}
