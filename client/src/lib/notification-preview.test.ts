/**
 * The line of text under an Activity row says names, never addresses (owner,
 * 2026-10-07: a repost of a note that opened by tagging someone showed
 * "nostr:npub10qdp2fc9…" where the name belonged).
 */
import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { notificationPreview } from "./notification-preview";

const VITOR = "460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c";
const npub = nip19.npubEncode(VITOR);
const names = (pk: string) => (pk === VITOR ? "Vitor Pamplona" : null);

describe("notificationPreview", () => {
  it("a repost shows the reposted note with the people it tags named", () => {
    const content = JSON.stringify({ content: `nostr:${npub} what a week for relays` });
    expect(notificationPreview("repost", content, names)).toBe("@Vitor Pamplona what a week for relays");
  });
  it("a reply or mention names the people it tags too", () => {
    expect(notificationPreview("reply", `thanks nostr:${npub}!`, names)).toBe("thanks @Vitor Pamplona!");
    expect(notificationPreview("mention", `nostr:${npub} look`, names)).toBe("@Vitor Pamplona look");
  });
  it("a shared post reads as words, not as its address", () => {
    const note = nip19.noteEncode("a".repeat(64));
    expect(notificationPreview("reply", `see nostr:${note}`, names)).toBe("see a post");
  });
  it("someone we have no name for yet is 'someone', never the address", () => {
    const other = nip19.npubEncode("b".repeat(64));
    expect(notificationPreview("reply", `hi nostr:${other}`, names)).toBe("hi @someone");
  });
  it("keeps a long preview short", () => {
    const long = "word ".repeat(60);
    const out = notificationPreview("reply", long, names)!;
    expect(out.length).toBeLessThanOrEqual(121);
    expect(out.endsWith("…")).toBe(true);
  });
  it("shortens AFTER naming, so a name is never cut into an address", () => {
    const content = `${"x".repeat(100)} nostr:${npub}`;
    expect(notificationPreview("reply", content, names)).not.toMatch(/npub1|nostr:/);
  });
  it("has nothing to show for follows, tickets, or a repost with no copy of the note", () => {
    expect(notificationPreview("follow", "anything", names)).toBeNull();
    expect(notificationPreview("ticket", "anything", names)).toBeNull();
    expect(notificationPreview("repost", "", names)).toBeNull();
    expect(notificationPreview("repost", "not json", names)).toBeNull();
  });
});
