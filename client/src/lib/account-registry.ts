// Multi-account registry — a thin, dependency-free localStorage index of the
// accounts this device knows how to sign in as, plus an active-account
// pointer.
//
// DESIGN (read this before touching auth storage):
//
// The app's session storage keeps its existing "singleton" keys —
// relay-outpost-login-method / relay-outpost-pubkey / relay-outpost-bunker-uri /
// relay-outpost-qr-session / relay-outpost-local-account /
// relay-outpost-local-secret — and those singletons ALWAYS describe the
// ACTIVE account, exactly as before this registry existed. Every existing
// reader (boot restore, reconnect handlers, unlock screen, key backup)
// keeps working untouched.
//
// What the registry adds:
//   1. `relay-outpost-accounts` — a list of known accounts
//      { pubkey, method, label?, picture?, addedAt } plus the active pubkey.
//      NO SECRETS live here, ever — it only records which accounts exist and
//      how they log in.
//   2. Per-pubkey NAMESPACED copies of the credential singletons
//      (`<singleton-key>:<pubkey>`), so a signed-out-of-view account's
//      credentials survive while another account occupies the singletons.
//      These are the same values the app already persists (including the
//      opt-in plaintext "stay signed in" nsec) — namespaced, never new
//      kinds of secret material. An account whose method can't silently
//      restore (encrypted-blob local key, disconnected bunker) re-prompts
//      exactly like it does today.
//
// Switching accounts (`switchAccount`) copies the target's namespaced
// credentials into the singletons, moves the pointer, and then performs a
// FULL `window.location.reload()`. The reload is deliberate: it guarantees
// zero cross-account state bleed — in-memory event stores, relay
// subscriptions, decrypt ledgers, react-query caches all start clean, and
// `handleAccountSwitch` (nip78-settings) wipes per-account localStorage on
// the way back up. A soft in-place switch would have to enumerate every
// cache in the app and would rot the first time someone adds a new one.
//
// Extension (NIP-07) caveat: the extension holds exactly ONE identity that
// the extension (not us) controls. The registry therefore keeps at most one
// "extension" entry, and its pubkey is whatever the extension currently
// exposes — on restore/login we re-verify and UPDATE the entry's pubkey if
// the extension switched identities, rather than misattributing sessions.

export type AccountMethod = "extension" | "local" | "bunker";

/** The app-level login method as stored in relay-outpost-login-method. */
export type AppLoginMethod = "extension" | "bunker" | "qr" | "local";

export interface RegisteredAccount {
  pubkey: string;
  method: AccountMethod;
  /** Cached display name — refreshed whenever this account's profile loads. */
  label?: string;
  /** Cached avatar URL — same lifecycle as label. Not a secret. */
  picture?: string;
  addedAt: number;
}

interface RegistryState {
  version: 1;
  accounts: RegisteredAccount[];
  active: string | null;
}

export const ACCOUNT_REGISTRY_KEY = "relay-outpost-accounts";

// Singleton session keys — MUST stay in sync with NostrAuthContext /
// local-account.ts. Duplicated here (rather than imported) so this module
// stays dependency-free and safe to import from anywhere.
export const SINGLETON_LOGIN_METHOD_KEY = "relay-outpost-login-method";
export const SINGLETON_PUBKEY_KEY = "relay-outpost-pubkey";
export const SINGLETON_BUNKER_KEY = "relay-outpost-bunker-uri";
export const SINGLETON_QR_SESSION_KEY = "relay-outpost-qr-session";
export const SINGLETON_LOCAL_ACCOUNT_KEY = "relay-outpost-local-account";
export const SINGLETON_LOCAL_SECRET_KEY = "relay-outpost-local-secret";

/** sessionStorage flag: the sign-in flow was opened to ADD an account. */
const ADD_ACCOUNT_FLAG = "relay-outpost-add-account-pending";
/** sessionStorage: a toast to show after the post-switch reload. */
const PENDING_TOAST_KEY = "relay-outpost-account-toast";

/** Credential singletons owned by each app-level login method. */
const CRED_SLOTS: Record<AppLoginMethod, string[]> = {
  extension: [],
  bunker: [SINGLETON_BUNKER_KEY],
  qr: [SINGLETON_QR_SESSION_KEY],
  local: [SINGLETON_LOCAL_ACCOUNT_KEY, SINGLETON_LOCAL_SECRET_KEY],
};

const ALL_CRED_SLOTS = [
  SINGLETON_BUNKER_KEY,
  SINGLETON_QR_SESSION_KEY,
  SINGLETON_LOCAL_ACCOUNT_KEY,
  SINGLETON_LOCAL_SECRET_KEY,
];

export function namespacedKey(base: string, pubkey: string): string {
  return `${base}:${pubkey}`;
}

// ── Explicit sign-out marker ─────────────────────────────────────────────────
// Boot's self-heal (ensureRegistryBoot) restores a registry account whenever
// the singleton session keys are empty — right for an ABORTED flow, wrong
// after an EXPLICIT sign-out: the user saw themselves logged out, refreshed,
// and got silently logged back in (a real security/UX violation — sign-out
// must stick). logout() sets this marker; any explicit activation (login,
// account switch, logout's deliberate switch-to-next) clears it.
const SIGNED_OUT_KEY = "relay-outpost-signed-out";

export function markExplicitSignOut(): void {
  try { localStorage.setItem(SIGNED_OUT_KEY, "1"); } catch {}
}

export function clearExplicitSignOut(): void {
  try { localStorage.removeItem(SIGNED_OUT_KEY); } catch {}
}

function hasExplicitSignOut(): boolean {
  try { return localStorage.getItem(SIGNED_OUT_KEY) === "1"; } catch { return false; }
}

function ls(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}
function lsRemove(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

function loadState(): RegistryState {
  try {
    const raw = localStorage.getItem(ACCOUNT_REGISTRY_KEY);
    if (!raw) return { version: 1, accounts: [], active: null };
    const parsed = JSON.parse(raw) as Partial<RegistryState>;
    const accounts = Array.isArray(parsed?.accounts)
      ? parsed.accounts.filter(
          (a): a is RegisteredAccount =>
            !!a && typeof a.pubkey === "string" && a.pubkey.length > 0 &&
            (a.method === "extension" || a.method === "local" || a.method === "bunker"),
        )
      : [];
    const active =
      typeof parsed?.active === "string" && accounts.some((a) => a.pubkey === parsed.active)
        ? parsed.active
        : null;
    return { version: 1, accounts, active };
  } catch {
    return { version: 1, accounts: [], active: null };
  }
}

function saveState(state: RegistryState): void {
  try { localStorage.setItem(ACCOUNT_REGISTRY_KEY, JSON.stringify(state)); } catch {}
}

function toRegistryMethod(appMethod: AppLoginMethod): AccountMethod {
  // QR sessions ARE NIP-46 remote-signer sessions; the registry's coarse
  // method is "bunker". The exact app-level method (incl. "qr") is kept in
  // the namespaced login-method slot so restore picks the right credential.
  return appMethod === "qr" ? "bunker" : appMethod;
}

export function listAccounts(): RegisteredAccount[] {
  return loadState().accounts.slice();
}

export function getAccount(pubkey: string): RegisteredAccount | null {
  return loadState().accounts.find((a) => a.pubkey === pubkey) ?? null;
}

export function getActiveAccountPubkey(): string | null {
  return loadState().active;
}

/** Delete every namespaced credential copy for a pubkey. */
function removeNamespacedCredentials(pubkey: string): void {
  lsRemove(namespacedKey(SINGLETON_LOGIN_METHOD_KEY, pubkey));
  for (const slot of ALL_CRED_SLOTS) lsRemove(namespacedKey(slot, pubkey));
}

/**
 * Sync the CURRENT singleton session with the registry:
 *  - upserts a registry entry for the active singleton session (this is also
 *    the one-time migration that adopts a pre-registry session),
 *  - copies present credential singletons to their per-pubkey namespaced
 *    slots, and fills MISSING singletons back from namespaced copies
 *    (self-heal after an aborted add-account flow cleared a singleton).
 *
 * Never deletes anything: credential deletion happens only in
 * removeAccount / sign-out / vanish paths, so a sync can never lose a
 * session or resurrect one that was explicitly removed.
 *
 * Returns the active pubkey, or null when no singleton session exists.
 */
export function syncActiveSession(): string | null {
  const appMethod = ls(SINGLETON_LOGIN_METHOD_KEY) as AppLoginMethod | null;
  const pubkey = ls(SINGLETON_PUBKEY_KEY);
  if (!appMethod || !pubkey || !(appMethod in CRED_SLOTS)) return null;

  lsSet(namespacedKey(SINGLETON_LOGIN_METHOD_KEY, pubkey), appMethod);
  for (const slot of CRED_SLOTS[appMethod]) {
    const singletonVal = ls(slot);
    const nsKey = namespacedKey(slot, pubkey);
    if (singletonVal != null) {
      lsSet(nsKey, singletonVal);
    } else {
      const nsVal = ls(nsKey);
      if (nsVal != null) lsSet(slot, nsVal);
    }
  }

  const state = loadState();
  const method = toRegistryMethod(appMethod);
  if (method === "extension") {
    // At most ONE extension entry — the extension exposes a single identity
    // it controls. If it changed identity, the old entry is unreachable:
    // update in place (drop the stale one and its namespaced slots).
    for (const stale of state.accounts.filter((a) => a.method === "extension" && a.pubkey !== pubkey)) {
      removeNamespacedCredentials(stale.pubkey);
    }
    state.accounts = state.accounts.filter((a) => !(a.method === "extension" && a.pubkey !== pubkey));
  }
  const existing = state.accounts.find((a) => a.pubkey === pubkey);
  if (existing) {
    existing.method = method;
  } else {
    state.accounts.push({ pubkey, method, addedAt: Date.now() });
  }
  state.active = pubkey;
  saveState(state);
  return pubkey;
}

/**
 * Make `pubkey` the active account by restoring its namespaced credentials
 * into the singleton slots. Does NOT reload — callers decide (switchAccount
 * reloads; boot self-heal runs before the auth provider reads storage).
 */
export function activateAccount(pubkey: string): boolean {
  const state = loadState();
  const entry = state.accounts.find((a) => a.pubkey === pubkey);
  if (!entry) return false;
  // An explicit activation (login, switcher, logout's switch-to-next) ends any
  // signed-out state — the user chose to have an active session again.
  clearExplicitSignOut();

  const appMethod =
    (ls(namespacedKey(SINGLETON_LOGIN_METHOD_KEY, pubkey)) as AppLoginMethod | null) ?? entry.method;

  lsSet(SINGLETON_LOGIN_METHOD_KEY, appMethod);
  lsSet(SINGLETON_PUBKEY_KEY, pubkey);
  // Clear ALL credential singletons first so nothing from the previous
  // account lingers, then restore only what this account actually has.
  // (Its own namespaced copies keep everything; an encrypted-blob local
  // account without the opt-in plaintext secret simply gets the unlock
  // prompt, same as today.)
  for (const slot of ALL_CRED_SLOTS) lsRemove(slot);
  const slots = appMethod in CRED_SLOTS ? CRED_SLOTS[appMethod] : [];
  for (const slot of slots) {
    const v = ls(namespacedKey(slot, pubkey));
    if (v != null) lsSet(slot, v);
  }

  state.active = pubkey;
  saveState(state);
  return true;
}

/**
 * Switch to another known account. Stashes the current session, restores the
 * target's, then hard-reloads (see file header for why the reload is
 * deliberate). `toastMessage` is shown after the reload completes.
 */
export function switchAccount(pubkey: string, opts?: { toastMessage?: string }): boolean {
  syncActiveSession();
  if (!activateAccount(pubkey)) return false;
  setPendingAccountToast(opts?.toastMessage ?? "Switched account");
  hardReload();
  return true;
}

export interface RemoveAccountResult {
  removed: boolean;
  wasActive: boolean;
  /** First remaining account to fall back to, if any. */
  nextPubkey: string | null;
}

/**
 * Remove ONE account from this device: its registry entry and its namespaced
 * credential copies. If it was the active account, its singleton session is
 * cleared too. Other accounts' credentials are untouched. The caller decides
 * what to do with `nextPubkey` (switch to it, or finish a full logout).
 */
export function removeAccount(pubkey: string): RemoveAccountResult {
  const state = loadState();
  const existed = state.accounts.some((a) => a.pubkey === pubkey);
  const wasActive = state.active === pubkey || ls(SINGLETON_PUBKEY_KEY) === pubkey;

  state.accounts = state.accounts.filter((a) => a.pubkey !== pubkey);
  if (state.active === pubkey) state.active = null;
  saveState(state);

  removeNamespacedCredentials(pubkey);

  if (ls(SINGLETON_PUBKEY_KEY) === pubkey) {
    lsRemove(SINGLETON_LOGIN_METHOD_KEY);
    lsRemove(SINGLETON_PUBKEY_KEY);
    for (const slot of ALL_CRED_SLOTS) lsRemove(slot);
  }

  return {
    removed: existed,
    wasActive,
    nextPubkey: state.accounts[0]?.pubkey ?? null,
  };
}

/** Refresh the cached display label / avatar for a known account. */
export function updateAccountProfile(
  pubkey: string,
  meta: { label?: string | null; picture?: string | null },
): void {
  const state = loadState();
  const entry = state.accounts.find((a) => a.pubkey === pubkey);
  if (!entry) return;
  const label = meta.label ?? undefined;
  const picture = meta.picture ?? undefined;
  if (entry.label === label && entry.picture === picture) return;
  entry.label = label;
  entry.picture = picture;
  saveState(state);
}

/**
 * Boot-time reconciliation, run BEFORE NostrAuthProvider reads storage:
 *  - active singleton session present → adopt/refresh it in the registry
 *    (the migration path for pre-registry sessions) and heal any singleton
 *    credential a crashed/aborted flow cleared;
 *  - no singleton session but known accounts remain → activate the recorded
 *    active account (or the first known one) so a failed add-account attempt
 *    or a forget-this-account never strands the user logged out while other
 *    accounts exist. Empty registry + no singletons = genuinely logged out.
 */
export function ensureRegistryBoot(): void {
  const adopted = syncActiveSession();
  if (adopted) {
    // A live singleton session means the user IS signed in — any stale
    // signed-out marker (e.g. from a sign-out followed by a fresh login that
    // predates the marker-clearing path) must not linger.
    clearExplicitSignOut();
    return;
  }
  const state = loadState();
  if (state.accounts.length === 0) return;
  // The empty singletons are the RESULT of an explicit sign-out, not an
  // aborted flow — do NOT resurrect a session the user deliberately ended.
  // They go through the normal sign-in (or account picker) instead.
  if (hasExplicitSignOut()) return;
  const target = state.accounts.find((a) => a.pubkey === state.active) ?? state.accounts[0];
  activateAccount(target.pubkey);
}

// ——— Add-account flow flag (sessionStorage, consumed by the /login page) ———

export function beginAddAccount(): void {
  // Snapshot the CURRENT account at the moment of intent, not just at boot:
  // the incoming account's login will overwrite the credential singletons,
  // and a credential that rotated since boot (a bunker reconnect, a refreshed
  // QR session) would otherwise only exist in the singleton about to be
  // clobbered — switching back would restore boot's stale copy.
  try { syncActiveSession(); } catch {}
  try { sessionStorage.setItem(ADD_ACCOUNT_FLAG, "1"); } catch {}
}

export function isAddAccountPending(): boolean {
  try { return sessionStorage.getItem(ADD_ACCOUNT_FLAG) === "1"; } catch { return false; }
}

export function clearAddAccountPending(): void {
  try { sessionStorage.removeItem(ADD_ACCOUNT_FLAG); } catch {}
}

// ——— Post-reload toast handoff ———

export function setPendingAccountToast(message: string): void {
  try { sessionStorage.setItem(PENDING_TOAST_KEY, message); } catch {}
}

export function consumePendingAccountToast(): string | null {
  try {
    const msg = sessionStorage.getItem(PENDING_TOAST_KEY);
    if (msg) sessionStorage.removeItem(PENDING_TOAST_KEY);
    return msg;
  } catch {
    return null;
  }
}

function hardReload(): void {
  try { window.location.reload(); } catch {}
}

/** Short display handle for an account row: label, else npub-ish prefix. */
export function accountDisplayName(account: RegisteredAccount): string {
  if (account.label) return account.label;
  return `${account.pubkey.slice(0, 8)}…${account.pubkey.slice(-4)}`;
}
