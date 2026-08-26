// Locks the Event Console deep-link contract: the URL the Feedback hand-offs
// (FeedbackDrawer / relay-ops FeedbackTab) and the contextual entry points
// (post / relay / profile) build must round-trip through the parser that
// EventConsole runs on mount. Guards the two silent-failure footguns this
// parser exists to prevent: a stripped query string and an un-read filter.

import { describe, it, expect } from "vitest";
import { parseConsoleQueryParams } from "./console-query-params";

describe("parseConsoleQueryParams", () => {
  it("returns nulls for an empty / bare search", () => {
    expect(parseConsoleQueryParams("")).toEqual({ filter: null, relay: null });
    expect(parseConsoleQueryParams("?")).toEqual({ filter: null, relay: null });
  });

  it("decodes a url-encoded filter JSON object", () => {
    const filter = { kinds: [1], limit: 100 };
    const search = `?filter=${encodeURIComponent(JSON.stringify(filter))}`;
    expect(parseConsoleQueryParams(search).filter).toEqual(filter);
  });

  it("decodes the relay and filter together (Feedback hand-off shape)", () => {
    const filter = { kinds: [1621, 1111, 1622], "#a": ["30617:abc:repo"] };
    const relay = "wss://relay.damus.io";
    const search = `?filter=${encodeURIComponent(JSON.stringify(filter))}&relay=${encodeURIComponent(relay)}`;
    const out = parseConsoleQueryParams(search);
    expect(out.filter).toEqual(filter);
    expect(out.relay).toBe(relay);
  });

  it("reads params regardless of the tab= prefix the redirect adds", () => {
    const filter = { authors: ["deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"] };
    const search = `?tab=console&filter=${encodeURIComponent(JSON.stringify(filter))}&relay=${encodeURIComponent("wss://a.example")}`;
    const out = parseConsoleQueryParams(search);
    expect(out.filter).toEqual(filter);
    expect(out.relay).toBe("wss://a.example");
  });

  it("handles the post 'Inspect raw event' shape ({ids:[...]})", () => {
    const filter = { ids: ["1111111111111111111111111111111111111111111111111111111111111111"] };
    const search = `?filter=${encodeURIComponent(JSON.stringify(filter))}`;
    expect(parseConsoleQueryParams(search).filter).toEqual(filter);
  });

  it("ignores malformed filter JSON without throwing", () => {
    expect(parseConsoleQueryParams("?filter=not-json").filter).toBeNull();
    expect(parseConsoleQueryParams("?filter=%7Bbroken").filter).toBeNull();
  });

  it("rejects a filter that is an array or primitive", () => {
    expect(parseConsoleQueryParams(`?filter=${encodeURIComponent("[1,2,3]")}`).filter).toBeNull();
    expect(parseConsoleQueryParams(`?filter=${encodeURIComponent("42")}`).filter).toBeNull();
    expect(parseConsoleQueryParams(`?filter=${encodeURIComponent('"hello"')}`).filter).toBeNull();
  });

  it("rejects a non-wss/ws relay (no http, no bare host)", () => {
    expect(parseConsoleQueryParams("?relay=http://evil.example").relay).toBeNull();
    expect(parseConsoleQueryParams("?relay=relay.damus.io").relay).toBeNull();
    expect(parseConsoleQueryParams("?relay=").relay).toBeNull();
  });

  it("accepts ws:// as well as wss://", () => {
    expect(parseConsoleQueryParams("?relay=ws://localhost:7777").relay).toBe("ws://localhost:7777");
    expect(parseConsoleQueryParams("?relay=wss://relay.nostr.band").relay).toBe("wss://relay.nostr.band");
  });
});
