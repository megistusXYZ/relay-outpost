/**
 * Writing a room's Pin List (CORD-04 §7): replaced entire on every edit, so a
 * write starts from the list as read. Unpinning is the next list without the
 * entry. A list this device can't read is never written over, and the caps
 * refuse a pin up front rather than publish a list every reader empties.
 */
import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey, getEventHash } from "nostr-tools";
import { v2 as nip44v2 } from "nostr-tools/nip44";
import { makePinEntry, readPinList, nextPinList, type PinEntry, type PinListView } from "./concord-pins";
import { buildMessageRumor, type RumorTemplate } from "./concord-events";
import { buildEncryptedSeal, planeConvKey, groupKey, LABEL_CHANNEL } from "./concord-crypto";

const sk = generateSecretKey();
const author = getPublicKey(sk);
const room = "c3".repeat(32);
const conv = planeConvKey(groupKey(LABEL_CHANNEL, generateSecretKey(), room, 4n));
const pinOf = (text: string, at: number): PinEntry => {
  const r: RumorTemplate = buildMessageRumor(author, room, 4n, text, 1, at);
  const s = buildEncryptedSeal(author, JSON.stringify({ ...r, id: getEventHash(r as never) }), conv, at);
  return makePinEntry(finalizeEvent({ kind: s.kind, created_at: s.created_at, tags: s.tags, content: s.content }, sk), conv);
};
const PUBLIC = { private: false } as const;
const view = (entries: PinEntry[]): PinListView => readPinList(JSON.stringify({ entries }), room, { foldLoaded: true });
const entriesOf = (content: string) => (JSON.parse(content) as { entries: PinEntry[] }).entries;

const first = pinOf("Meet at 6", 1_789_000_000);
const second = pinOf("Bring snacks", 1_789_000_001);

describe("writing a room's pins", () => {
  it("pinning adds the message; pinning it again changes nothing", () => {
    const next = nextPinList(view([first]), { pin: second }, PUBLIC);
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(entriesOf(next.content)).toEqual([first, second]);
    const again = nextPinList(view([first, second]), { pin: second }, PUBLIC);
    expect(again.ok && entriesOf(again.content)).toEqual([first, second]);
  });

  it("unpinning is the next list without it", () => {
    const v = view([first, second]);
    const id = v.status === "ok" ? v.pins[0].id : "";
    const next = nextPinList(v, { unpin: id }, PUBLIC);
    expect(next.ok && entriesOf(next.content)).toEqual([second]);
  });

  it("a list this device can't read is never written over", () => {
    expect(nextPinList({ status: "unavailable" }, { pin: first }, PUBLIC)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("a room with 25 pins refuses another", () => {
    const full = Array.from({ length: 25 }, (_, i) => pinOf(`pin ${i}`, 1_789_000_100 + i));
    expect(nextPinList(view(full), { pin: first }, PUBLIC)).toEqual({ ok: false, reason: "full" });
  });

  it("a pin that would take the list past 32,768 bytes is refused", () => {
    const long = pinOf("x".repeat(30_000), 1_789_000_200);
    expect(nextPinList(view([first]), { pin: long }, PUBLIC)).toEqual({ ok: false, reason: "too-big" });
  });

  it("a private room's list is sealed under the room's key at its epoch", () => {
    const next = nextPinList(view([]), { pin: first }, { private: true, epoch: 4, convKey: conv });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    const body = JSON.parse(next.content) as { epoch: string; sealed: string };
    expect(body.epoch).toBe("4");
    expect(JSON.parse(nip44v2.decrypt(body.sealed, conv)).entries).toEqual([first]);
  });

  it("what another app added to an entry rides along", () => {
    const withHint = { ...first, wrap: "ab".repeat(32) };
    const next = nextPinList(view([withHint]), { pin: second }, PUBLIC);
    expect(next.ok && entriesOf(next.content)[0]).toEqual(withHint);
  });
});
