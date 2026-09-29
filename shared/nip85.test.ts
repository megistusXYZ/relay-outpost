/**
 * Trust scores as NIP-85 score cards (2026-09-28): brainstorm.world's scores
 * API is gone, and NosFabrica publishes per-observer rank cards instead. An
 * observer's kind-10040 trust map names the rank services it trusts; each
 * service publishes a kind-30382 card per person (d = person, rank = 0-100).
 * Wire-checked: jack ranks 91-97 through the default lens's service.
 */
import { describe, it, expect } from "vitest";
import { rankServicesFromMap, scoresFromCards } from "./nip85";

const SVC_A = "a".repeat(64);
const SVC_B = "b".repeat(64);
const JACK = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2";
const FIATJAF = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const NEWBIE = "c".repeat(64);

const map = (tags: string[][]) => ({ kind: 10040, pubkey: "d".repeat(64), tags, content: "", created_at: 1, id: "x", sig: "y" });
const card = (service: string, subject: string, rank: string | null) => ({
  kind: 30382, pubkey: service, created_at: 1, id: service + subject, sig: "s", content: "",
  tags: [["d", subject], ...(rank === null ? [] : [["rank", rank]]), ["followers", "10"]],
});

describe("rankServicesFromMap", () => {
  it("reads the rank services in the order the observer listed them", () => {
    const m = map([
      ["30382:rank", SVC_A, "wss://scores.brainstorm.world"],
      ["30382:followers", SVC_A, "wss://scores.brainstorm.world"],
      ["30382:rank", SVC_B, "wss://nip85.nosfabrica.com"],
    ]);
    expect(rankServicesFromMap(m)).toEqual([
      { service: SVC_A, relay: "wss://scores.brainstorm.world" },
      { service: SVC_B, relay: "wss://nip85.nosfabrica.com" },
    ]);
  });

  it("keeps a service whose relay hint is local or junk, without the hint", () => {
    const m = map([["30382:rank", SVC_A, "ws://localhost:7778"], ["30382:rank", SVC_B, "wss://relay.staging.example.com"]]);
    expect(rankServicesFromMap(m)).toEqual([{ service: SVC_A, relay: null }, { service: SVC_B, relay: null }]);
  });

  it("ignores malformed keys and duplicate services", () => {
    const m = map([["30382:rank", "npub1nope"], ["30382:rank", SVC_A], ["30382:rank", SVC_A, "wss://nip85.nosfabrica.com"]]);
    expect(rankServicesFromMap(m)).toEqual([{ service: SVC_A, relay: null }]);
  });

  it("no map, no services", () => {
    expect(rankServicesFromMap(null)).toEqual([]);
  });
});

describe("scoresFromCards", () => {
  it("turns a card's 0-100 rank into the app's 0-1 score", () => {
    const s = scoresFromCards([JACK], [card(SVC_A, JACK, "91")], [SVC_A], true);
    expect(s.get(JACK)).toBe(0.91);
  });

  it("the first-listed service wins when two have a card", () => {
    const s = scoresFromCards([JACK], [card(SVC_B, JACK, "40"), card(SVC_A, JACK, "95")], [SVC_A, SVC_B], true);
    expect(s.get(JACK)).toBe(0.95);
  });

  it("once the relay finished answering, a person without a card is unranked (null)", () => {
    const s = scoresFromCards([JACK, NEWBIE], [card(SVC_A, JACK, "91")], [SVC_A], true);
    expect(s.get(NEWBIE)).toBeNull();
  });

  it("if the relay never finished answering, a missing card says nothing (unknown)", () => {
    const s = scoresFromCards([JACK, NEWBIE], [card(SVC_A, JACK, "91")], [SVC_A], false);
    expect(s.get(JACK)).toBe(0.91);
    expect(s.has(NEWBIE)).toBe(false);
  });

  it("cards from services the observer didn't list are ignored", () => {
    const s = scoresFromCards([FIATJAF], [card("e".repeat(64), FIATJAF, "99")], [SVC_A], true);
    expect(s.get(FIATJAF)).toBeNull();
  });

  it("a card without a usable rank counts as no card", () => {
    const s = scoresFromCards([JACK, FIATJAF], [card(SVC_A, JACK, null), card(SVC_A, FIATJAF, "lots")], [SVC_A], true);
    expect(s.get(JACK)).toBeNull();
    expect(s.get(FIATJAF)).toBeNull();
  });

  it("ranks outside 0-100 are clamped", () => {
    const s = scoresFromCards([JACK], [card(SVC_A, JACK, "140")], [SVC_A], true);
    expect(s.get(JACK)).toBe(1);
  });
});
