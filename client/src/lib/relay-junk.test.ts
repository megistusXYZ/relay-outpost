/**
 * Authors' relay lists decide which sockets we open to fetch their posts.
 * The performance QA (2026-09-28) found a session connected to
 * wss://top.testrelay.top and wss://relay.staging.dvines.org, taken straight
 * from someone's list. Test, staging and local relays never hold anything a
 * reader needs, and each one is a socket, a TLS handshake and a timeout.
 */
import { describe, it, expect } from "vitest";
import { isJunkRelay, selectRelaysByMode } from "./relay-prefs";

describe("isJunkRelay", () => {
  it("test and staging relays are skipped", () => {
    expect(isJunkRelay("wss://top.testrelay.top/")).toBe(true);
    expect(isJunkRelay("wss://relay.staging.dvines.org/")).toBe(true);
    expect(isJunkRelay("wss://staging.nostr.example")).toBe(true);
    expect(isJunkRelay("wss://dev.relay.example")).toBe(true);
  });

  it("local and private addresses are skipped", () => {
    expect(isJunkRelay("ws://localhost:7777")).toBe(true);
    expect(isJunkRelay("wss://127.0.0.1")).toBe(true);
    expect(isJunkRelay("wss://192.168.1.20:4848")).toBe(true);
    expect(isJunkRelay("wss://relay.local")).toBe(true);
    expect(isJunkRelay("wss://abc.onion")).toBe(true);
  });

  it("plain ws:// can't be opened from our https page, so it's skipped", () => {
    expect(isJunkRelay("ws://relay.damus.io")).toBe(true);
  });

  it("anything that isn't a relay address is skipped", () => {
    expect(isJunkRelay("https://relay.damus.io")).toBe(true);
    expect(isJunkRelay("not a url")).toBe(true);
  });

  it("real relays pass, including names that merely contain the words", () => {
    for (const url of [
      "wss://relay.damus.io/", "wss://nos.lol", "wss://relay.primal.net",
      "wss://nostr.wine", "wss://relay.divine.video", "wss://relay.devnostr.com",
      "wss://latestnews.nostr1.com", "wss://monitorlizard.nostr1.com/",
    ]) expect(isJunkRelay(url), url).toBe(false);
  });
});

describe("selectRelaysByMode skips junk from an author's list", () => {
  it("keeps the author's real relays, drops test/staging/local, still at most 5", () => {
    const prefs = [
      { url: "wss://top.testrelay.top/", mode: "write" as const },
      { url: "wss://relay.damus.io/", mode: "write" as const },
      { url: "ws://localhost:4869", mode: "both" as const },
      { url: "wss://nos.lol/", mode: "both" as const },
      { url: "wss://relay.staging.dvines.org/", mode: "write" as const },
      { url: "wss://relay.primal.net/", mode: "write" as const },
    ];
    expect(selectRelaysByMode(prefs, "write")).toEqual(["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"]);
  });
});

describe("your own relay list is left as you wrote it", () => {
  // Your list is where YOU publish: a relay operator may list their own
  // staging relay on purpose. Only other people's lists get cleaned.
  it("keeps test and staging relays when the list is the viewer's own", () => {
    const prefs = [
      { url: "wss://relay.staging.myrelay.com/", mode: "write" as const },
      { url: "wss://relay.damus.io/", mode: "write" as const },
    ];
    expect(selectRelaysByMode(prefs, "write", 5, { dropJunk: false })).toEqual([
      "wss://relay.staging.myrelay.com/", "wss://relay.damus.io/",
    ]);
  });
});
