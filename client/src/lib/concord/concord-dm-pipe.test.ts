// Group-chat messages that ride the DM gift-wrap pipe must never become DM
// text: a direct invite carries the group's secret keys, and a report is for
// the moderators only. Every unwrap path routes through one helper so no path
// can forget a kind (the Messages page alone has four).
import { describe, it, expect, beforeEach, vi } from "vitest";

const __store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (__store.has(k) ? __store.get(k)! : null),
  setItem: (k: string, v: string) => { __store.set(k, String(v)); },
  removeItem: (k: string) => { __store.delete(k); },
});
vi.stubGlobal("window", { dispatchEvent: () => true });

import { routeGroupRumor } from "./concord-dm-pipe";
import { listPendingInvites } from "./concord-invites";
import { listReports, reportTags } from "./concord-reports";
import { listJoinRequests } from "./concord-join-requests";

const hex = (c: string) => c.repeat(64);
const ME = hex("a"), SENDER = hex("b");
const base = { senderPubkey: SENDER, recipientPubkey: ME, timestamp: 100, rumorId: hex("1") };

beforeEach(() => __store.clear());

describe("what rides the DM pipe but isn't a DM", () => {
  it("a direct invite goes to pending invites", () => {
    const bundle = { community_id: hex("c"), owner: hex("d"), owner_salt: hex("e"), community_root: hex("f"), root_epoch: 0, channels: [], relays: [], name: "Book Club" };
    expect(routeGroupRumor(ME, { ...base, rumorKind: 3313, content: JSON.stringify(bundle), tags: [] })).toMatchObject({ kind: "invite", isNew: true, name: "Book Club" });
    expect(listPendingInvites(ME)[0].bundle.name).toBe("Book Club");
  });

  it("a report goes to the moderator's reports", () => {
    // As the gift wrap builds it: the recipient's `p` first, then the report's own tags.
    const tags = [["p", ME], ...reportTags({ communityId: hex("c"), channelId: hex("d"), msgId: hex("e"), author: hex("4"), reason: "spam", snippet: "x" })];
    expect(routeGroupRumor(ME, { ...base, rumorKind: 1984, content: "", tags })).toMatchObject({ kind: "report", isNew: true });
    expect(listReports(ME, hex("c"))).toHaveLength(1);
    expect(listReports(ME, hex("c"))[0].author).toBe(hex("4"));
  });

  it("keeps a malformed invite or report out of the DMs all the same", () => {
    expect(routeGroupRumor(ME, { ...base, rumorKind: 1984, content: "hi", tags: [] })).toMatchObject({ kind: "report", isNew: false });
    expect(routeGroupRumor(ME, { ...base, rumorKind: 3313, content: "not json", tags: [] })).toMatchObject({ kind: "invite", isNew: false });
  });

  it("a request to join goes to the moderator's waiting list, and a malformed one is still no DM", () => {
    const tags = [["p", ME], ["concord", hex("c")]];
    expect(routeGroupRumor(ME, { ...base, rumorKind: 9021, content: "hi, I'm from the meetup", tags })).toMatchObject({ kind: "request", isNew: true });
    expect(listJoinRequests(ME, hex("c"))[0].note).toBe("hi, I'm from the meetup");
    expect(routeGroupRumor(ME, { ...base, rumorId: hex("2"), rumorKind: 9021, content: "x", tags: [] })).toMatchObject({ kind: "request", isNew: false });
  });

  it("leaves an ordinary DM for the DM thread", () => {
    expect(routeGroupRumor(ME, { ...base, rumorKind: 14, content: "hey", tags: [] })).toBeNull();
    expect(routeGroupRumor(ME, { ...base, rumorKind: 15, content: "https://x", tags: [] })).toBeNull();
  });
});
