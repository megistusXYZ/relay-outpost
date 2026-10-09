/**
 * What a newlay relay is used for (MANAGEMENT_API.md §3.11, setrelaymode):
 * Open, a private-messages inbox, or a community chat — in words a host
 * who has never heard of gift wraps can choose between. The policy objects
 * are shaped from the doc's getrelaymode example.
 */
import { describe, it, expect } from "vitest";
import { readRelayType, callToChoose, suggestRelayType, relayHostsOutpost, sameRelay } from "./relay-type";
import { canDo, readSupportedMethods, UNKNOWN_CAPABILITIES } from "./relay-capabilities";

const OPEN = { read_privacy: "open", giftwrap_deletion: "honor", giftwrap_kinds: [1059] };

describe("reading what it's used for", () => {
  it("open reads and ordinary deletion is Open", () => {
    expect(readRelayType(OPEN)).toBe("open");
  });
  it("messages shown only to the person they're for is a private-messages inbox", () => {
    expect(readRelayType({ ...OPEN, read_privacy: "recipient_gated" })).toBe("inbox");
  });
  it("chat history that can't be deleted by whoever holds the key is a community chat", () => {
    expect(readRelayType({ ...OPEN, giftwrap_deletion: "prevent" })).toBe("chat");
  });
  it("both at once is a mix the host set by hand — shown, never guessed into one of the three", () => {
    expect(readRelayType({ ...OPEN, read_privacy: "recipient_gated", giftwrap_deletion: "prevent" })).toBe("custom");
  });
  it("is unread for a refusal or a malformed answer", () => {
    expect(readRelayType(undefined)).toBeNull();
    expect(readRelayType({ read_privacy: "sometimes" })).toBeNull();
  });
});

describe("choosing", () => {
  it("each choice is one of newlay's presets, sent by name", () => {
    expect(callToChoose("open")).toEqual({ method: "setrelaymode", params: [{ mode: "open" }] });
    expect(callToChoose("inbox")).toEqual({ method: "setrelaymode", params: [{ mode: "nip17" }] });
    expect(callToChoose("chat")).toEqual({ method: "setrelaymode", params: [{ mode: "concord" }] });
  });
});

describe("a suggestion, from what the host already uses it for", () => {
  it("an outpost of yours lives here → community chat, so a leaked chat key can't erase the history", () => {
    expect(suggestRelayType({ current: "open", hostsOutpost: true, isMyInbox: false }))
      .toEqual({ choice: "chat", why: "One of your outposts lives here. Community chat keeps its history safe even if the chat key leaks." });
    expect(suggestRelayType({ current: "chat", hostsOutpost: true, isMyInbox: false })).toBeNull();
  });
  it("it's one of your private-message places → inbox, so only the person a message is for can read it", () => {
    expect(suggestRelayType({ current: "open", hostsOutpost: false, isMyInbox: true }))
      .toEqual({ choice: "inbox", why: "You receive private messages here. Private-messages inbox shows each one only to the person it's for." });
  });
  it("both at once can't be served by one setting: say so, and keep the chat working", () => {
    expect(suggestRelayType({ current: "open", hostsOutpost: true, isMyInbox: true }))
      .toEqual({ choice: "chat", why: "One of your outposts lives here and you receive private messages here too. An inbox would hide the outpost's chat, so choose Community chat and receive private messages somewhere else." });
  });
  it("nothing to suggest when it's not used for either, or already right", () => {
    expect(suggestRelayType({ current: "open", hostsOutpost: false, isMyInbox: false })).toBeNull();
    expect(suggestRelayType({ current: "inbox", hostsOutpost: false, isMyInbox: true })).toBeNull();
  });
});

describe("does an outpost of yours live here", () => {
  const ME = "ab".repeat(32), OTHER = "cd".repeat(32);
  const here = "wss://feed.qa.invalid";
  it("yes when you own it or hold its admin key, and its chat is kept on this relay", () => {
    expect(relayHostsOutpost([{ relays: ["wss://feed.qa.invalid/"], owner: ME }], ME, here)).toBe(true);
    expect(relayHostsOutpost([{ relays: ["WSS://FEED.QA.INVALID"], owner: OTHER, control_root: "x" }], ME, here)).toBe(true);
  });
  it("no for someone else's outpost, or one kept elsewhere", () => {
    expect(relayHostsOutpost([{ relays: [here], owner: OTHER }], ME, here)).toBe(false);
    expect(relayHostsOutpost([{ relays: ["wss://other.qa.invalid"], owner: ME }], ME, here)).toBe(false);
    expect(relayHostsOutpost([], ME, here)).toBe(false);
  });
  it("the same address allows for a trailing slash and case", () => {
    expect(sameRelay("wss://A.b/", "wss://a.B")).toBe(true);
    expect(sameRelay("wss://a.b", "wss://a.c")).toBe(false);
  });
});

describe("whether to offer it", () => {
  it("only on a relay that lists reading and setting it", () => {
    expect(canDo(readSupportedMethods({ result: ["supportedmethods", "getrelaymode", "setrelaymode"] }), "relayType")).toBe(true);
    expect(canDo(readSupportedMethods({ result: ["supportedmethods", "setrelaymode"] }), "relayType")).toBe(false);
    expect(canDo(UNKNOWN_CAPABILITIES, "relayType")).toBe(false);
  });
});
