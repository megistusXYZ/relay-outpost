// QA of the content-creation pipeline (the logic behind "posting across all login
// methods"). Every login resolves to one ISigner; all content flows through the same
// signWithTimeout(signer, template) seam, then the tag builders shape each kind. These
// tests prove that pipeline is signer-agnostic and produces spec-correct, verifiable
// events — independent of how the user logged in. (UI/viewing/mobile is out of scope:
// not unit-testable in this node harness.)

import { describe, it, expect } from "vitest";
import { PrivateKeySigner } from "applesauce-signers";
import { verifyEvent, generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import type { Event } from "nostr-tools";
import { signWithTimeout } from "./signer-timeout";
import { buildReplyTags, buildReactionTags, buildRepostTags, extractHashtags } from "./nostr-helpers";

const makeEvent = (over: Partial<Event> = {}): Event => ({
  id: "a".repeat(64), pubkey: "b".repeat(64), kind: 1, created_at: 1_700_000_000,
  tags: [], content: "", sig: "s".repeat(128), ...over,
});
const eTags = (tags: string[][]) => tags.filter((t) => t[0] === "e");
const pTags = (tags: string[][]) => tags.filter((t) => t[0] === "p");
const AUTHOR = "a1".padEnd(64, "0");

const FIXED_TS = 1_700_000_000;

describe("signing is signer-agnostic (login method doesn't matter)", () => {
  it("a note signed via a local key (nsec/local login) is a valid, verifiable event", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const signed = await signWithTimeout(signer, {
      kind: 1,
      created_at: FIXED_TS,
      tags: [],
      content: "gm from a local key",
    });
    expect(signed.pubkey).toBe(pubkey);
    expect(signed.kind).toBe(1);
    expect(verifyEvent(signed)).toBe(true);
  });

  it("a note signed via a mock NIP-07 extension signer is also valid (extension login)", async () => {
    const sk = generateSecretKey();
    const extensionSigner = {
      async getPublicKey() { return getPublicKey(sk); },
      async signEvent(t: { kind: number; created_at: number; tags: string[][]; content: string }) {
        return finalizeEvent(t, sk);
      },
    };
    const signed = await signWithTimeout(extensionSigner as never, {
      kind: 1,
      created_at: FIXED_TS,
      tags: [],
      content: "gm from an extension",
    });
    expect(signed.pubkey).toBe(getPublicKey(sk));
    expect(verifyEvent(signed)).toBe(true);
  });
});

describe("content tagging is spec-correct (cross-client threading/reactions)", () => {
  it("reply to a ROOT note → single e-tag marked 'root' + author p-tag (NIP-10)", () => {
    const parent = makeEvent({ id: "r".repeat(64), pubkey: AUTHOR });
    const tags = buildReplyTags(parent, "wss://relay.example");
    const es = eTags(tags);
    expect(es).toHaveLength(1);
    expect(es[0]).toEqual(["e", "r".repeat(64), "wss://relay.example", "root"]);
    expect(pTags(tags).some((t) => t[1] === AUTHOR)).toBe(true);
  });

  it("reply to a REPLY → preserves the root, adds a reply marker (NIP-10 threading)", () => {
    const root = "r".repeat(64);
    const parent = makeEvent({ id: "p".repeat(64), pubkey: AUTHOR, tags: [["e", root, "", "root"]] });
    const es = eTags(buildReplyTags(parent));
    expect(es.find((t) => t[3] === "root")?.[1]).toBe(root);
    expect(es.find((t) => t[3] === "reply")?.[1]).toBe("p".repeat(64));
  });

  it("reaction carries e + p + k(=reacted kind) (NIP-25)", () => {
    const tags = buildReactionTags(makeEvent({ id: "x".repeat(64), pubkey: "c".repeat(64), kind: 1 }));
    expect(eTags(tags).some((t) => t[1] === "x".repeat(64))).toBe(true);
    expect(pTags(tags).some((t) => t[1] === "c".repeat(64))).toBe(true);
    expect(tags.find((t) => t[0] === "k")?.[1]).toBe("1");
  });

  it("repost carries e + p with relay hints (NIP-18)", () => {
    const tags = buildRepostTags(makeEvent({ id: "y".repeat(64), pubkey: "d".repeat(64) }), "wss://hint.example");
    expect(eTags(tags)[0]).toEqual(["e", "y".repeat(64), "wss://hint.example"]);
    expect(pTags(tags)[0]).toEqual(["p", "d".repeat(64), "wss://hint.example"]);
  });

  it("hashtags: lowercased, de-duped, URL fragments excluded", () => {
    const tags = extractHashtags("GM #Nostr #nostr #Bitcoin see https://x.com/p#notatag");
    expect(tags).toEqual([["t", "nostr"], ["t", "bitcoin"]]);
  });
});
