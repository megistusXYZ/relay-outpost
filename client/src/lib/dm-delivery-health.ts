// DM delivery health — pure decision logic for the problem-only banner in the
// DM thread (Messages page / DmDeliveryHealth component).
//
// The silent-failure case this exists for: NIP-17 gift wraps are routed to the
// recipient's published kind-10050 DM inbox relays. When a contact has never
// published one, we can only "best guess" (their NIP-65 relays + fallbacks) and
// the message may never be seen. Healthy threads must render NOTHING — this is
// a problem-only surface, never a status badge.
//
// Deliberately dependency-free (no relay graph, no React) so the truth table is
// unit-testable. The caller feeds it cache-derived booleans from @/lib/outbox.

export type DeliveryHealthLevel = "ok" | "contact-no-inbox" | "self-no-inbox";

export interface DeliveryHealthInput {
  /** Contact has a cached kind-10050 with at least one relay. */
  contactHas10050: boolean;
  /**
   * A DEFINITIVE answer exists for the contact: either a cached list, or a
   * query that succeeded and confirmed "no kind-10050 published". While this
   * is false (still loading / transient fetch error) we must never warn.
   */
  contactListLoaded: boolean;
  /** We have a cached kind-10050 of our own. */
  selfHas10050: boolean;
  /**
   * Our own-inbox auto-publish (the existing ensure-own-10050 routine) ran to
   * completion and did NOT leave us with a published inbox — signer refused,
   * publish failed, etc. A transient fetch error alone must not set this.
   */
  selfAutopubFailed: boolean;
}

export interface DeliveryHealth {
  level: DeliveryHealthLevel;
  showBanner: boolean;
}

export function computeDeliveryHealth(input: DeliveryHealthInput): DeliveryHealth {
  // Self variant takes precedence: it's rarer, actionable in one tap ("Publish
  // inbox"), and it breaks delivery on EVERY thread, not just this one. It
  // requires BOTH "no list" and "auto-publish conclusively failed".
  if (!input.selfHas10050 && input.selfAutopubFailed) {
    return { level: "self-no-inbox", showBanner: true };
  }
  // Never warn while loading: a "no inbox" verdict needs a definitive answer.
  if (!input.contactListLoaded) {
    return { level: "ok", showBanner: false };
  }
  if (!input.contactHas10050) {
    return { level: "contact-no-inbox", showBanner: true };
  }
  return { level: "ok", showBanner: false };
}

// ---------------------------------------------------------------------------
// Dismissal — per (myPubkey, contactPubkey), remembered in localStorage.
//
// Episode semantics: a dismissal silences the CURRENT unhealthy episode only.
// Whenever a healthy state is later observed for the pair, the stored marker
// is cleared (clearDeliveryDismissalOnHealthy) — so if the contact publishes
// an inbox and then loses it again, the new episode warns again. The marker
// also stores WHICH level was dismissed, so dismissing the contact banner
// never silences a later self banner (and vice versa).
// ---------------------------------------------------------------------------

/** Minimal storage surface so tests can inject an in-memory map. */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DISMISS_KEY_PREFIX = "relay_outpost_dm_delivery_dismiss_";

export function deliveryDismissKey(myPubkey: string, contactPubkey: string): string {
  return `${DISMISS_KEY_PREFIX}${myPubkey}_${contactPubkey}`;
}

function safeLocalStorage(): KVStorage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {}
  return null;
}

export function isDeliveryWarningDismissed(
  myPubkey: string,
  contactPubkey: string,
  level: DeliveryHealthLevel,
  storage: KVStorage | null = safeLocalStorage(),
): boolean {
  if (!storage || level === "ok") return false;
  try {
    const raw = storage.getItem(deliveryDismissKey(myPubkey, contactPubkey));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.level === level;
  } catch {
    return false;
  }
}

export function dismissDeliveryWarning(
  myPubkey: string,
  contactPubkey: string,
  level: DeliveryHealthLevel,
  storage: KVStorage | null = safeLocalStorage(),
): void {
  if (!storage || level === "ok") return;
  try {
    storage.setItem(
      deliveryDismissKey(myPubkey, contactPubkey),
      JSON.stringify({ level, at: Date.now() }),
    );
  } catch {}
}

/**
 * Re-show-on-transition: call whenever a HEALTHY state is observed for the
 * pair. Clears any stored dismissal so it only ever covers the episode it was
 * made in — a later regression (inbox published, then lost) warns again.
 */
export function clearDeliveryDismissalOnHealthy(
  myPubkey: string,
  contactPubkey: string,
  storage: KVStorage | null = safeLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(deliveryDismissKey(myPubkey, contactPubkey));
  } catch {}
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Plain-language relay display: strip the protocol + trailing slashes so the
 * sheet lists read as hostnames ("relay.damus.io"), one line each. A
 * non-trivial path is kept (some inbox relays are path-scoped).
 */
export function formatRelayHost(url: string): string {
  let s = (url || "").trim();
  s = s.replace(/^wss?:\/\//i, "").replace(/^https?:\/\//i, "");
  s = s.replace(/\/+$/, "");
  return s;
}
