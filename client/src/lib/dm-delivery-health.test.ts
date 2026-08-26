// Locks the DM delivery-health truth table: the banner is problem-only (never
// warns while the contact's kind-10050 answer is still loading), the self
// variant (own inbox unpublished + auto-publish failed) outranks the contact
// variant, dismissals persist per (myPubkey, contactPubkey) and are scoped to
// the level they silenced, and a healthy observation clears the marker so the
// NEXT unhealthy episode warns again.

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeDeliveryHealth,
  isDeliveryWarningDismissed,
  dismissDeliveryWarning,
  clearDeliveryDismissalOnHealthy,
  deliveryDismissKey,
  formatRelayHost,
  type KVStorage,
} from "./dm-delivery-health";

const ME = "me-pubkey";
const ALICE = "alice-pubkey";
const BOB = "bob-pubkey";

function memStorage(): KVStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

const HEALTHY = {
  contactHas10050: true,
  contactListLoaded: true,
  selfHas10050: true,
  selfAutopubFailed: false,
};

describe("computeDeliveryHealth", () => {
  it("never warns while the contact's list is still loading", () => {
    const h = computeDeliveryHealth({
      ...HEALTHY,
      contactHas10050: false,
      contactListLoaded: false, // no definitive answer yet
    });
    expect(h.level).toBe("ok");
    expect(h.showBanner).toBe(false);
  });

  it("triggers contact-no-inbox once a definitive empty answer exists", () => {
    const h = computeDeliveryHealth({
      ...HEALTHY,
      contactHas10050: false,
      contactListLoaded: true,
    });
    expect(h.level).toBe("contact-no-inbox");
    expect(h.showBanner).toBe(true);
  });

  it("renders nothing for a healthy thread", () => {
    const h = computeDeliveryHealth(HEALTHY);
    expect(h.level).toBe("ok");
    expect(h.showBanner).toBe(false);
  });

  it("self variant takes precedence when both self and contact are broken", () => {
    const h = computeDeliveryHealth({
      contactHas10050: false,
      contactListLoaded: true,
      selfHas10050: false,
      selfAutopubFailed: true,
    });
    expect(h.level).toBe("self-no-inbox");
    expect(h.showBanner).toBe(true);
  });

  it("shows the self variant even while the contact answer is still loading", () => {
    const h = computeDeliveryHealth({
      contactHas10050: false,
      contactListLoaded: false,
      selfHas10050: false,
      selfAutopubFailed: true,
    });
    expect(h.level).toBe("self-no-inbox");
  });

  it("self variant requires BOTH no own list AND a failed auto-publish", () => {
    // Auto-publish failed but we DO have a list (e.g. published elsewhere): ok.
    expect(
      computeDeliveryHealth({ ...HEALTHY, selfAutopubFailed: true }).level,
    ).toBe("ok");
    // No list cached but auto-publish hasn't conclusively failed: ok (it may
    // still be running, or the fetch errored transiently).
    expect(
      computeDeliveryHealth({ ...HEALTHY, selfHas10050: false }).level,
    ).toBe("ok");
  });
});

describe("dismissal", () => {
  let storage: ReturnType<typeof memStorage>;

  beforeEach(() => {
    storage = memStorage();
  });

  it("dismiss persists per contact — and only for that contact", () => {
    dismissDeliveryWarning(ME, ALICE, "contact-no-inbox", storage);
    expect(isDeliveryWarningDismissed(ME, ALICE, "contact-no-inbox", storage)).toBe(true);
    // A different contact of the same account is untouched.
    expect(isDeliveryWarningDismissed(ME, BOB, "contact-no-inbox", storage)).toBe(false);
    // A different account viewing the same contact is untouched.
    expect(isDeliveryWarningDismissed("other-me", ALICE, "contact-no-inbox", storage)).toBe(false);
  });

  it("dismissal is scoped to the level it silenced", () => {
    dismissDeliveryWarning(ME, ALICE, "contact-no-inbox", storage);
    // A later SELF banner in the same thread must still show.
    expect(isDeliveryWarningDismissed(ME, ALICE, "self-no-inbox", storage)).toBe(false);
  });

  it("a healthy observation clears the marker so the next episode re-shows", () => {
    dismissDeliveryWarning(ME, ALICE, "contact-no-inbox", storage);
    expect(isDeliveryWarningDismissed(ME, ALICE, "contact-no-inbox", storage)).toBe(true);

    // Alice publishes an inbox → the thread is observed healthy → episode over.
    clearDeliveryDismissalOnHealthy(ME, ALICE, storage);

    // She later loses the inbox: the old dismissal must NOT silence the new episode.
    expect(isDeliveryWarningDismissed(ME, ALICE, "contact-no-inbox", storage)).toBe(false);
  });

  it("never dismisses the 'ok' level and survives a missing storage", () => {
    dismissDeliveryWarning(ME, ALICE, "ok", storage);
    expect(storage.map.size).toBe(0);
    expect(isDeliveryWarningDismissed(ME, ALICE, "ok", storage)).toBe(false);
    // Null storage (SSR / storage blocked): everything no-ops safely.
    expect(isDeliveryWarningDismissed(ME, ALICE, "contact-no-inbox", null)).toBe(false);
    expect(() => dismissDeliveryWarning(ME, ALICE, "contact-no-inbox", null)).not.toThrow();
    expect(() => clearDeliveryDismissalOnHealthy(ME, ALICE, null)).not.toThrow();
  });

  it("ignores a corrupted stored marker", () => {
    storage.setItem(deliveryDismissKey(ME, ALICE), "{not json");
    expect(isDeliveryWarningDismissed(ME, ALICE, "contact-no-inbox", storage)).toBe(false);
  });
});

describe("formatRelayHost", () => {
  it("strips wss:// and trailing slashes down to a hostname", () => {
    expect(formatRelayHost("wss://relay.damus.io/")).toBe("relay.damus.io");
    expect(formatRelayHost("wss://nos.lol")).toBe("nos.lol");
  });

  it("handles ws://, https:// and bare hostnames", () => {
    expect(formatRelayHost("ws://localhost:7777")).toBe("localhost:7777");
    expect(formatRelayHost("https://relay.example.com/")).toBe("relay.example.com");
    expect(formatRelayHost("relay.example.com")).toBe("relay.example.com");
  });

  it("keeps a meaningful path but trims whitespace and empty input", () => {
    expect(formatRelayHost("wss://relay.example.com/inbox")).toBe("relay.example.com/inbox");
    expect(formatRelayHost("  wss://relay.snort.social  ")).toBe("relay.snort.social");
    expect(formatRelayHost("")).toBe("");
  });
});
