// @vitest-environment jsdom
/**
 * Badges on a profile can be opened (owner, 2026-10-07: "should users be able
 * to see and click on badges, and are they displayed nicely?"). Each badge is
 * a button; tapping it shows the badge large, its whole description (the list
 * cuts it at two lines), who gave it and when. The section wears the same
 * title bar as Circle and Details.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createElement } from "react";

// Environment only: no relay pool, no profile lookups.
vi.mock("@/lib/nostr", () => ({ eventStore: {} }));
vi.mock("applesauce-react/hooks", () => ({ use$: () => undefined }));
vi.mock("@/lib/nip58-badges", () => ({ showBadgeOnProfile: async () => "shown", acceptBadges: async () => {} }));
vi.mock("@/hooks/use-badges", () => ({ useAcceptedBadgesCached: () => [] }));
vi.mock("@/contexts/NostrAuthContext", () => ({ useNostrAuth: () => ({ pubkey: null, signer: null }) }));

type Act = (cb: () => void | Promise<void>) => Promise<void>;
let act: Act;
let createRoot: typeof import("react-dom/client").createRoot;
let ProfileBadgesSection: typeof import("./BadgeDisplay").ProfileBadgesSection;
beforeAll(async () => {
  if (typeof navigator === "undefined") vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (jsdom)" });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = (await import("react")) as unknown as { act: Act });
  ({ ProfileBadgesSection } = await import("./BadgeDisplay"));
});
afterEach(() => { document.body.innerHTML = ""; });

const GIVER = "a".repeat(64);
const LONG = "Awarded to the first Nostriches who helped seed and shape the Shaving Kiwi Web of Trust Relay on Nostr. Thank you for being early, for testing everything twice, and for telling us when it broke.";
const badge = {
  badgeRef: `30009:${GIVER}:kiwi`,
  awardEventId: "e".repeat(64),
  definition: { id: "d".repeat(64), pubkey: GIVER, dTag: "kiwi", name: "Shaving Kiwi WoT Pioneer", description: LONG, image: "https://img.example/kiwi.png", thumb: "https://img.example/kiwi-thumb.png", createdAt: 1 },
  awarderPubkey: GIVER,
  awardedAt: Math.floor(Date.now() / 1000) - 86400 * 330,
  isAccepted: true,
};

async function profileWithBadge() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    createRoot(host).render(createElement(ProfileBadgesSection, { badges: [badge] as never, pubkey: "b".repeat(64) }));
  });
  return host;
}

describe("a badge on a profile", () => {
  it("is a button you can tap, named for the badge", async () => {
    const host = await profileWithBadge();
    const open = host.querySelector<HTMLButtonElement>('button[aria-label="About Shaving Kiwi WoT Pioneer"]');
    expect(open).not.toBeNull();
  });

  it("opens to the badge large, its whole description, who gave it and when", async () => {
    const host = await profileWithBadge();
    const open = host.querySelector<HTMLButtonElement>('button[aria-label="About Shaving Kiwi WoT Pioneer"]')!;
    await act(async () => { open.click(); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Shaving Kiwi WoT Pioneer");
    expect(dialog!.textContent).toContain(LONG);
    expect(dialog!.querySelector("[class*=line-clamp]")).toBeNull();
    expect(dialog!.querySelector('img[src="https://img.example/kiwi.png"]')).not.toBeNull();
    expect(dialog!.textContent).toMatch(/Given by/);
    expect(dialog!.textContent).toMatch(/ago/);
  });

  it("sits under a 'Badges' title bar like Circle and Details", async () => {
    const host = await profileWithBadge();
    const heading = [...host.querySelectorAll("h2")].map((h) => h.textContent);
    expect(heading).toContain("Badges");
  });
});
