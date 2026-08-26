// Locks the multi-account registry contract: add/remove/switch pointer
// semantics, the at-most-one-extension-entry rule, the migration that adopts
// a pre-registry singleton session, remove-active-falls-back-to-next, and
// empty-registry = logged out. The registry itself must NEVER hold secrets —
// credentials live only in the (now per-pubkey namespaced) slots the app
// already used.

import { describe, it, expect, beforeEach, vi } from "vitest";

// node env has no localStorage/sessionStorage/window; the registry reads them
// synchronously (same stub pattern as feed-prefs.test.ts).
const __local = new Map<string, string>();
const __session = new Map<string, string>();
const reloadSpy = vi.fn();

vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__local.has(k) ? __local.get(k)! : null),
  setItem: (k: string, v: string) => { __local.set(k, String(v)); },
  removeItem: (k: string) => { __local.delete(k); },
  clear: () => { __local.clear(); },
});
vi.stubGlobal("sessionStorage", {
  getItem: (k: string) => (__session.has(k) ? __session.get(k)! : null),
  setItem: (k: string, v: string) => { __session.set(k, String(v)); },
  removeItem: (k: string) => { __session.delete(k); },
  clear: () => { __session.clear(); },
});
vi.stubGlobal("window", {
  location: { reload: reloadSpy },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
});

import {
  ACCOUNT_REGISTRY_KEY,
  SINGLETON_LOGIN_METHOD_KEY,
  SINGLETON_PUBKEY_KEY,
  SINGLETON_BUNKER_KEY,
  SINGLETON_LOCAL_ACCOUNT_KEY,
  SINGLETON_LOCAL_SECRET_KEY,
  namespacedKey,
  listAccounts,
  getActiveAccountPubkey,
  syncActiveSession,
  activateAccount,
  switchAccount,
  removeAccount,
  updateAccountProfile,
  ensureRegistryBoot,
  consumePendingAccountToast,
  accountDisplayName,
  markExplicitSignOut,
  beginAddAccount,
} from "./account-registry";

const PK_A = "a".repeat(64);
const PK_B = "b".repeat(64);
const PK_C = "c".repeat(64);

/** Simulate a login writing the singletons (what NostrAuthContext does). */
function writeSingletonSession(
  method: "extension" | "bunker" | "qr" | "local",
  pubkey: string,
  creds: Record<string, string> = {},
) {
  localStorage.setItem(SINGLETON_LOGIN_METHOD_KEY, method);
  localStorage.setItem(SINGLETON_PUBKEY_KEY, pubkey);
  for (const [k, v] of Object.entries(creds)) localStorage.setItem(k, v);
}

beforeEach(() => {
  __local.clear();
  __session.clear();
  reloadSpy.mockClear();
});

describe("empty registry", () => {
  it("means logged out: no accounts, no active pointer, boot is a no-op", () => {
    expect(listAccounts()).toEqual([]);
    expect(getActiveAccountPubkey()).toBeNull();
    ensureRegistryBoot();
    expect(listAccounts()).toEqual([]);
    expect(localStorage.getItem(SINGLETON_LOGIN_METHOD_KEY)).toBeNull();
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBeNull();
  });

  it("tolerates garbage in the registry key", () => {
    localStorage.setItem(ACCOUNT_REGISTRY_KEY, "not json {{{");
    expect(listAccounts()).toEqual([]);
    expect(getActiveAccountPubkey()).toBeNull();
  });
});

describe("migration adopts an existing singleton session", () => {
  it("adopts a pre-registry bunker session as the active entry with namespaced creds", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://uri-a" });
    ensureRegistryBoot();

    const accounts = listAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].pubkey).toBe(PK_A);
    expect(accounts[0].method).toBe("bunker");
    expect(getActiveAccountPubkey()).toBe(PK_A);
    // Credential mirrored into the per-pubkey namespaced slot…
    expect(localStorage.getItem(namespacedKey(SINGLETON_BUNKER_KEY, PK_A))).toBe("bunker://uri-a");
    // …and the existing singleton session is NEVER lost.
    expect(localStorage.getItem(SINGLETON_BUNKER_KEY)).toBe("bunker://uri-a");
    expect(localStorage.getItem(SINGLETON_LOGIN_METHOD_KEY)).toBe("bunker");
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBe(PK_A);
  });

  it("adopts a local stay-signed-in session, namespacing blob + plaintext slot as-is", () => {
    writeSingletonSession("local", PK_A, {
      [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"pubkey":"' + PK_A + '","ncryptsec":"ncryptsec1x"}',
      [SINGLETON_LOCAL_SECRET_KEY]: "nsec1existing",
    });
    ensureRegistryBoot();
    expect(getActiveAccountPubkey()).toBe(PK_A);
    expect(localStorage.getItem(namespacedKey(SINGLETON_LOCAL_SECRET_KEY, PK_A))).toBe("nsec1existing");
    expect(localStorage.getItem(SINGLETON_LOCAL_SECRET_KEY)).toBe("nsec1existing");
  });

  it("keeps the app-level 'qr' method in the namespaced slot while the registry records 'bunker'", () => {
    writeSingletonSession("qr", PK_A, { "relay-outpost-qr-session": '{"key":"k"}' });
    ensureRegistryBoot();
    expect(listAccounts()[0].method).toBe("bunker");
    expect(localStorage.getItem(namespacedKey(SINGLETON_LOGIN_METHOD_KEY, PK_A))).toBe("qr");
  });

  it("registry JSON never contains credential material", () => {
    writeSingletonSession("local", PK_A, { [SINGLETON_LOCAL_SECRET_KEY]: "nsec1supersecret" });
    ensureRegistryBoot();
    expect(localStorage.getItem(ACCOUNT_REGISTRY_KEY)).not.toContain("nsec1supersecret");
  });

  it("self-heals a singleton credential an aborted flow cleared (namespaced copy wins back)", () => {
    writeSingletonSession("local", PK_A, { [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"blob":"a"}' });
    syncActiveSession();
    // Aborted import flow cleared the singleton blob but left method+pubkey.
    localStorage.removeItem(SINGLETON_LOCAL_ACCOUNT_KEY);
    ensureRegistryBoot();
    expect(localStorage.getItem(SINGLETON_LOCAL_ACCOUNT_KEY)).toBe('{"blob":"a"}');
  });
});

describe("add + switch pointer semantics", () => {
  it("adding a second account keeps the first and moves the active pointer", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://a" });
    syncActiveSession();
    // Add-account: the new login simply overwrites the singletons…
    writeSingletonSession("local", PK_B, { [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"blob":"b"}' });
    syncActiveSession();

    expect(listAccounts().map((a) => a.pubkey)).toEqual([PK_A, PK_B]);
    expect(getActiveAccountPubkey()).toBe(PK_B);
    // …and A's credentials survive in its namespaced slots.
    expect(localStorage.getItem(namespacedKey(SINGLETON_BUNKER_KEY, PK_A))).toBe("bunker://a");
  });

  it("switchAccount restores the target's creds into the singletons, clears the others, and reloads", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://a" });
    syncActiveSession();
    writeSingletonSession("local", PK_B, { [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"blob":"b"}' });
    syncActiveSession();

    expect(switchAccount(PK_A)).toBe(true);
    expect(getActiveAccountPubkey()).toBe(PK_A);
    expect(localStorage.getItem(SINGLETON_LOGIN_METHOD_KEY)).toBe("bunker");
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBe(PK_A);
    expect(localStorage.getItem(SINGLETON_BUNKER_KEY)).toBe("bunker://a");
    // No cross-account residue in the singleton credential slots.
    expect(localStorage.getItem(SINGLETON_LOCAL_ACCOUNT_KEY)).toBeNull();
    // Deliberate full reload for zero state bleed.
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // B's stash is intact for switching back.
    expect(localStorage.getItem(namespacedKey(SINGLETON_LOCAL_ACCOUNT_KEY, PK_B))).toBe('{"blob":"b"}');
  });

  it("switching to an encrypted-blob local account without the opt-in secret leaves the secret slot empty (unlock re-prompt)", () => {
    writeSingletonSession("local", PK_A, { [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"blob":"a"}' });
    syncActiveSession();
    writeSingletonSession("bunker", PK_B, { [SINGLETON_BUNKER_KEY]: "bunker://b" });
    syncActiveSession();

    switchAccount(PK_A);
    expect(localStorage.getItem(SINGLETON_LOCAL_ACCOUNT_KEY)).toBe('{"blob":"a"}');
    expect(localStorage.getItem(SINGLETON_LOCAL_SECRET_KEY)).toBeNull();
  });

  it("switchAccount to an unknown pubkey is a safe no-op", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://a" });
    syncActiveSession();
    expect(switchAccount(PK_C)).toBe(false);
    expect(getActiveAccountPubkey()).toBe(PK_A);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("queues a post-reload toast that can be consumed exactly once", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://a" });
    syncActiveSession();
    writeSingletonSession("local", PK_B, { [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"blob":"b"}' });
    syncActiveSession();
    switchAccount(PK_A, { toastMessage: "Switched to Alice" });
    expect(consumePendingAccountToast()).toBe("Switched to Alice");
    expect(consumePendingAccountToast()).toBeNull();
  });
});

describe("at most one extension entry", () => {
  it("re-recording an extension login with a new pubkey replaces the stale entry", () => {
    writeSingletonSession("extension", PK_A);
    syncActiveSession();
    // Extension now exposes a different identity — re-verify on restore.
    writeSingletonSession("extension", PK_B);
    syncActiveSession();

    const extEntries = listAccounts().filter((a) => a.method === "extension");
    expect(extEntries).toHaveLength(1);
    expect(extEntries[0].pubkey).toBe(PK_B);
    expect(getActiveAccountPubkey()).toBe(PK_B);
    // The stale extension identity's namespaced slots are gone.
    expect(localStorage.getItem(namespacedKey(SINGLETON_LOGIN_METHOD_KEY, PK_A))).toBeNull();
  });

  it("does not disturb non-extension accounts when the extension identity changes", () => {
    writeSingletonSession("local", PK_C, { [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"blob":"c"}' });
    syncActiveSession();
    writeSingletonSession("extension", PK_A);
    syncActiveSession();
    writeSingletonSession("extension", PK_B);
    syncActiveSession();

    expect(listAccounts().map((a) => a.pubkey).sort()).toEqual([PK_B, PK_C].sort());
    expect(localStorage.getItem(namespacedKey(SINGLETON_LOCAL_ACCOUNT_KEY, PK_C))).toBe('{"blob":"c"}');
  });
});

describe("removeAccount", () => {
  function seedThree() {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://a" });
    syncActiveSession();
    writeSingletonSession("local", PK_B, { [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"blob":"b"}' });
    syncActiveSession();
    writeSingletonSession("extension", PK_C);
    syncActiveSession();
    // Active is now C.
  }

  it("removing a NON-active account deletes only that account's entry and creds", () => {
    seedThree();
    const res = removeAccount(PK_A);
    expect(res).toEqual({ removed: true, wasActive: false, nextPubkey: PK_B });
    expect(listAccounts().map((a) => a.pubkey)).toEqual([PK_B, PK_C]);
    expect(getActiveAccountPubkey()).toBe(PK_C);
    expect(localStorage.getItem(namespacedKey(SINGLETON_BUNKER_KEY, PK_A))).toBeNull();
    // Other accounts' credentials untouched.
    expect(localStorage.getItem(namespacedKey(SINGLETON_LOCAL_ACCOUNT_KEY, PK_B))).toBe('{"blob":"b"}');
    // Active singleton session untouched.
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBe(PK_C);
  });

  it("removing the ACTIVE account clears its singleton session and offers the next account", () => {
    seedThree();
    const res = removeAccount(PK_C);
    expect(res.removed).toBe(true);
    expect(res.wasActive).toBe(true);
    expect(res.nextPubkey).toBe(PK_A);
    expect(getActiveAccountPubkey()).toBeNull();
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBeNull();
    expect(localStorage.getItem(SINGLETON_LOGIN_METHOD_KEY)).toBeNull();

    // Sign-out flow then activates the next account instead of full logout.
    expect(activateAccount(res.nextPubkey!)).toBe(true);
    expect(getActiveAccountPubkey()).toBe(PK_A);
    expect(localStorage.getItem(SINGLETON_BUNKER_KEY)).toBe("bunker://a");
    expect(localStorage.getItem(SINGLETON_LOGIN_METHOD_KEY)).toBe("bunker");
  });

  it("removing the LAST account leaves a fully logged-out device", () => {
    writeSingletonSession("local", PK_A, {
      [SINGLETON_LOCAL_ACCOUNT_KEY]: '{"blob":"a"}',
      [SINGLETON_LOCAL_SECRET_KEY]: "nsec1secret",
    });
    syncActiveSession();
    const res = removeAccount(PK_A);
    expect(res.nextPubkey).toBeNull();
    expect(listAccounts()).toEqual([]);
    expect(getActiveAccountPubkey()).toBeNull();
    expect(localStorage.getItem(SINGLETON_LOCAL_SECRET_KEY)).toBeNull();
    expect(localStorage.getItem(namespacedKey(SINGLETON_LOCAL_SECRET_KEY, PK_A))).toBeNull();
    // Boot after that stays logged out (no resurrection).
    ensureRegistryBoot();
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBeNull();
  });

  it("removing an unknown pubkey reports removed: false", () => {
    seedThree();
    const res = removeAccount("f".repeat(64));
    expect(res.removed).toBe(false);
    expect(listAccounts()).toHaveLength(3);
  });
});

describe("boot fallback after the singleton session vanished", () => {
  it("activates the recorded active account when the singletons were wiped (failed add-account)", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://a" });
    syncActiveSession();
    // A failed bunker add-account attempt clears the singleton session.
    localStorage.removeItem(SINGLETON_LOGIN_METHOD_KEY);
    localStorage.removeItem(SINGLETON_PUBKEY_KEY);
    localStorage.removeItem(SINGLETON_BUNKER_KEY);

    ensureRegistryBoot();
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBe(PK_A);
    expect(localStorage.getItem(SINGLETON_BUNKER_KEY)).toBe("bunker://a");
  });
});

describe("labels and display", () => {
  it("caches label/picture on the entry (no secrets) and falls back to a pubkey handle", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://a" });
    syncActiveSession();
    updateAccountProfile(PK_A, { label: "Alice", picture: "https://x/a.png" });
    const entry = listAccounts()[0];
    expect(entry.label).toBe("Alice");
    expect(entry.picture).toBe("https://x/a.png");
    expect(accountDisplayName(entry)).toBe("Alice");
    expect(accountDisplayName({ ...entry, label: undefined })).toContain("…");
    // Ignores unknown pubkeys.
    updateAccountProfile(PK_B, { label: "Nope" });
    expect(listAccounts()).toHaveLength(1);
  });
});

// Regression (2026-07): after an EXPLICIT sign-out, refreshing the landing page
// silently logged the user back in — boot's self-heal saw empty singletons +
// a surviving registry entry and resurrected the session. Sign-out must stick:
// the explicit-sign-out marker blocks boot resurrection until a real login /
// activation happens.
describe("explicit sign-out marker", () => {
  it("boot does NOT resurrect a registry account after an explicit sign-out", () => {
    // A signed-in bunker session that boot has adopted…
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://uri-a" });
    ensureRegistryBoot();
    // …user signs out: singletons cleared, marker set — but simulate a registry
    // entry surviving (the exact failure mode of the bug).
    markExplicitSignOut();
    localStorage.removeItem(SINGLETON_LOGIN_METHOD_KEY);
    localStorage.removeItem(SINGLETON_PUBKEY_KEY);
    localStorage.removeItem(SINGLETON_BUNKER_KEY);

    // Refresh → boot must NOT log them back in.
    ensureRegistryBoot();
    expect(localStorage.getItem(SINGLETON_LOGIN_METHOD_KEY)).toBeNull();
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBeNull();
    expect(localStorage.getItem(SINGLETON_BUNKER_KEY)).toBeNull();
  });

  it("boot still heals an aborted flow when there was NO explicit sign-out", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://uri-a" });
    ensureRegistryBoot();
    // Aborted flow wipes the singletons WITHOUT a sign-out marker…
    localStorage.removeItem(SINGLETON_LOGIN_METHOD_KEY);
    localStorage.removeItem(SINGLETON_PUBKEY_KEY);
    localStorage.removeItem(SINGLETON_BUNKER_KEY);
    // …boot self-heal restores the session (existing behavior preserved).
    ensureRegistryBoot();
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBe(PK_A);
    expect(localStorage.getItem(SINGLETON_BUNKER_KEY)).toBe("bunker://uri-a");
  });

  it("an explicit activation (login / switch / logout's switch-to-next) clears the marker", () => {
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://uri-a" });
    ensureRegistryBoot();
    markExplicitSignOut();
    // The deliberate switch path activates an account explicitly…
    expect(activateAccount(PK_A)).toBe(true);
    localStorage.removeItem(SINGLETON_LOGIN_METHOD_KEY);
    localStorage.removeItem(SINGLETON_PUBKEY_KEY);
    localStorage.removeItem(SINGLETON_BUNKER_KEY);
    // …so a later aborted-flow heal works again (marker gone).
    ensureRegistryBoot();
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBe(PK_A);
  });

  it("a live singleton session at boot clears any stale marker", () => {
    markExplicitSignOut();
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://uri-a" });
    ensureRegistryBoot();
    // Signed in fine, and the stale marker no longer blocks future heals.
    localStorage.removeItem(SINGLETON_LOGIN_METHOD_KEY);
    localStorage.removeItem(SINGLETON_PUBKEY_KEY);
    localStorage.removeItem(SINGLETON_BUNKER_KEY);
    ensureRegistryBoot();
    expect(localStorage.getItem(SINGLETON_PUBKEY_KEY)).toBe(PK_A);
  });
});

describe("beginAddAccount snapshots the outgoing session", () => {
  it("a credential rotated after boot survives the incoming login's overwrite", () => {
    // Boot: A signs in with a bunker URI; boot sync namespaces it.
    writeSingletonSession("bunker", PK_A, { [SINGLETON_BUNKER_KEY]: "bunker://old" });
    ensureRegistryBoot();
    // Mid-session the bunker session ROTATES — only the singleton knows.
    localStorage.setItem(SINGLETON_BUNKER_KEY, "bunker://rotated");
    // User opens Add account, then B's login clobbers the singletons.
    beginAddAccount();
    writeSingletonSession("local", PK_B, { [SINGLETON_LOCAL_ACCOUNT_KEY]: "blob-b" });
    localStorage.removeItem(SINGLETON_BUNKER_KEY);
    syncActiveSession();
    // Switching back to A must restore the ROTATED credential, not boot's.
    expect(activateAccount(PK_A)).toBe(true);
    expect(localStorage.getItem(SINGLETON_BUNKER_KEY)).toBe("bunker://rotated");
  });
});
