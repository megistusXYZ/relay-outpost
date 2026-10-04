import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { resolveWhen, resolveFilters, consoleLink } from "./console-query";
import { parseConsoleQueryParams } from "@/lib/console-query-params";

const NOW = 1_800_000_000;
const HEX = "a".repeat(64), HEX2 = "b".repeat(64);

describe("times people can type", () => {
  it("relative to now", () => {
    expect(resolveWhen("now", NOW)).toBe(NOW);
    for (const t of ["now-3h", "-3h", "3h", "3h ago", "3 hours ago", "now - 3 hours"]) expect(resolveWhen(t, NOW)).toBe(NOW - 3 * 3600);
    expect(resolveWhen("30m", NOW)).toBe(NOW - 1800);
    expect(resolveWhen("2d", NOW)).toBe(NOW - 2 * 86400);
    expect(resolveWhen("1w", NOW)).toBe(NOW - 7 * 86400);
  });
  it("a date, or a timestamp as is", () => {
    expect(resolveWhen("2026-10-01T00:00:00Z", NOW)).toBe(Date.UTC(2026, 9, 1) / 1000);
    expect(resolveWhen(1_700_000_000, NOW)).toBe(1_700_000_000);
    expect(resolveWhen("1700000000", NOW)).toBe(1_700_000_000);
  });
  it("anything else isn't a time", () => {
    expect(resolveWhen("soon", NOW)).toBeNull();
    expect(resolveWhen("", NOW)).toBeNull();
  });
});

describe("a filter as typed → what goes on the wire", () => {
  it("resolves times, and takes npub / note codes where hex is wanted", () => {
    const r = resolveFilters(JSON.stringify({ kinds: [1], since: "now-3h", authors: [nip19.npubEncode(HEX)], ids: [nip19.noteEncode(HEX2)], "#p": [nip19.npubEncode(HEX2)], limit: 50 }), NOW);
    expect(r).toEqual({ ok: true, filters: [{ kinds: [1], since: NOW - 10800, authors: [HEX], ids: [HEX2], "#p": [HEX2], limit: 50 }] });
  });

  it("several filters at once, as an array", () => {
    const r = resolveFilters(JSON.stringify([{ kinds: [0] }, { kinds: [3], limit: 1 }]), NOW);
    expect(r).toEqual({ ok: true, filters: [{ kinds: [0] }, { kinds: [3], limit: 1 }] });
  });

  it("says what's wrong in words", () => {
    expect(resolveFilters("{kinds: [1]}", NOW)).toEqual({ ok: false, error: "That isn't valid JSON" });
    expect(resolveFilters(JSON.stringify({ since: "soon" }), NOW)).toEqual({ ok: false, error: "“soon” isn't a time — try now-3h, 2d or a date" });
    expect(resolveFilters(JSON.stringify({ kinds: ["note"] }), NOW)).toEqual({ ok: false, error: "kinds must be numbers" });
    expect(resolveFilters(JSON.stringify({ authors: ["bob"] }), NOW)).toEqual({ ok: false, error: "“bob” in authors isn't a key or npub" });
    expect(resolveFilters(JSON.stringify({ colour: "red" }), NOW)).toEqual({ ok: false, error: "“colour” isn't a filter field" });
  });
});

describe("share links", () => {
  it("carry every relay and the filter as typed, so 'last 3 hours' stays relative", () => {
    const link = consoleLink(["wss://a.example", "wss://b.example"], '{"kinds":[1],"since":"now-3h"}');
    expect(link.startsWith("/my-relays/console?")).toBe(true);
    const p = parseConsoleQueryParams(link.slice(link.indexOf("?")));
    expect(p.relays).toEqual(["wss://a.example", "wss://b.example"]);
    expect(p.relay).toBe("wss://a.example");
    expect(p.filter).toEqual({ kinds: [1], since: "now-3h" });
  });
});
