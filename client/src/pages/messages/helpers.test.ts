import { describe, it, expect } from "vitest";
import { mergeChatEntries, orderRequests, sectionChatEntries, orderCommunitiesByActivity, needsSynthesizedPeopleSection, communitiesForTab, formatGroupTeaser, looksLikeOpaquePayload, chatFilterOptions, applyChatFilter, resolveChatFilter, firstUnreadChat, chatHomeMenu, type ChatEntry, type GroupPreview, keepNewerPreviews, type ConversationPreview } from "./helpers";
import type { ConversationPreview } from "./helpers";

const dm = (pubkey: string, lastTimestamp: number, unread = false): ConversationPreview =>
  ({ pubkey, lastMessage: "hi", lastTimestamp, unread });

// lastActivity is in MS (concord-unread's clock); DM lastTimestamp is seconds.
const group = (communityId: string, lastActivityMs: number, name = "Group"): GroupPreview =>
  ({ communityId, name, channelCount: 1, lastActivity: lastActivityMs, unread: false, members: [] });

const ids = (entries: ReturnType<typeof mergeChatEntries>) =>
  entries.map((e) => (e.kind === "dm" ? e.conv.pubkey : e.group.communityId));

describe("mergeChatEntries", () => {
  it("interleaves DMs and groups by recency, newest first", () => {
    const dms = [dm("dm-new", 3000), dm("dm-old", 1000)];
    const groups = [group("grp-mid", 2000 * 1000)]; // ms
    expect(ids(mergeChatEntries(dms, groups, { tab: "primary" }))).toEqual([
      "dm-new", "grp-mid", "dm-old",
    ]);
  });

  it("compares group ms clocks against DM second clocks correctly", () => {
    // A group active at t=5000s must beat a DM at t=4999s despite the ms unit.
    const merged = mergeChatEntries([dm("dm", 4999)], [group("grp", 5_000_000)], { tab: "primary" });
    expect(ids(merged)).toEqual(["grp", "dm"]);
  });

  it("excludes groups from the Requests tab", () => {
    const merged = mergeChatEntries([dm("dm", 100)], [group("grp", 999_999_000)], { tab: "requests" });
    expect(ids(merged)).toEqual(["dm"]);
  });

  it("search filter matches group names (case-insensitive)", () => {
    const groups = [group("grp-a", 2000_000, "Design Crew"), group("grp-b", 1000_000, "Family")];
    const merged = mergeChatEntries([], groups, { tab: "primary", searchFilter: "crew" });
    expect(ids(merged)).toEqual(["grp-a"]);
  });

  it("search filter also matches any member display name", () => {
    // A group must stay findable by BOTH its shared name and any member's name
    // (a member searching for who they're talking to still lands on it).
    const named: GroupPreview = { ...group("grp-p", 2000_000, "Secret HQ"), memberNames: ["Alice Wonder", "Carol"] };
    const plain = group("grp-g", 1000_000, "Family");
    expect(ids(mergeChatEntries([], [named, plain], { tab: "primary", searchFilter: "alice" }))).toEqual(["grp-p"]);
    expect(ids(mergeChatEntries([], [named, plain], { tab: "primary", searchFilter: "secret" }))).toEqual(["grp-p"]);
    expect(ids(mergeChatEntries([], [named, plain], { tab: "primary", searchFilter: "bob" }))).toEqual([]);
  });

  it("does not re-filter DMs by search (they arrive pre-filtered)", () => {
    // Caller already filtered DMs by name/preview — the DM survives any query.
    const merged = mergeChatEntries([dm("dm", 100)], [group("grp", 50_000, "Family")], { tab: "primary", searchFilter: "zzz" });
    expect(ids(merged)).toEqual(["dm"]);
  });

  it("a never-active group (0) sorts to the bottom, not the top", () => {
    const merged = mergeChatEntries([dm("dm", 100)], [group("grp", 0)], { tab: "primary" });
    expect(ids(merged)).toEqual(["dm", "grp"]);
  });

  it("empty inputs produce an empty list", () => {
    expect(mergeChatEntries([], [], { tab: "primary" })).toEqual([]);
  });
});

describe("formatGroupTeaser", () => {
  const msg = (content: string, extra: Partial<{ media: { mime: string }[]; deleted: boolean }> = {}) =>
    ({ content, ...extra });

  it("renders sender first name + text", () => {
    expect(formatGroupTeaser(msg("testing from amethyst"), "Vitor Pamplona")).toBe("Vitor: testing from amethyst");
  });

  it("collapses whitespace/newlines into one line", () => {
    expect(formatGroupTeaser(msg("hi\n\nthere   friend"), "Alice")).toBe("Alice: hi there friend");
  });

  it("media-only message becomes its placeholder", () => {
    expect(formatGroupTeaser(msg("", { media: [{ mime: "image/jpeg" }] }), "Vitor")).toBe("Vitor: 📷 Photo");
    expect(formatGroupTeaser(msg("", { media: [{ mime: "video/mp4" }] }), "Vitor")).toBe("Vitor: 🎬 Video");
    expect(formatGroupTeaser(msg("", { media: [{ mime: "audio/ogg" }] }), "Vitor")).toBe("Vitor: 🎵 Audio");
    expect(formatGroupTeaser(msg("", { media: [{ mime: "application/pdf" }] }), "Vitor")).toBe("Vitor: 📎 File");
  });

  it("media + caption combine", () => {
    expect(formatGroupTeaser(msg("look at this", { media: [{ mime: "image/png" }] }), "Bob")).toBe("Bob: 📷 Photo · look at this");
  });

  it("a bare public GIF URL (picker GIFs) reads as a photo, not a URL", () => {
    expect(formatGroupTeaser(msg("https://media.tenor.com/x/dance.gif"), "Carol")).toBe("Carol: 📷 Photo");
  });

  it("returns null for deleted or empty messages (caller falls back to the generic line)", () => {
    expect(formatGroupTeaser(msg("hello", { deleted: true }), "Vitor")).toBeNull();
    expect(formatGroupTeaser(msg("   "), "Vitor")).toBeNull();
  });

  it("NEVER renders JSON payloads or ciphertext-shaped blobs", () => {
    expect(formatGroupTeaser(msg('{"kind":9,"content":"x"}'), "Vitor")).toBeNull();
    expect(formatGroupTeaser(msg('["a","b"]'), "Vitor")).toBeNull();
    expect(formatGroupTeaser(msg("A".repeat(40) + "b64+/=".repeat(12)), "Vitor")).toBeNull();
    // ...but ordinary text that merely starts with a brace still shows.
    expect(formatGroupTeaser(msg("{not json at all"), "Vitor")).toBe("Vitor: {not json at all");
  });

  it("falls back to 'Someone' when the sender has no resolvable name", () => {
    expect(formatGroupTeaser(msg("hi"), "  ")).toBe("Someone: hi");
  });

  it("caps very long messages", () => {
    const out = formatGroupTeaser(msg("hello world ".repeat(50)), "Al");
    expect(out!.length).toBeLessThanOrEqual("Al: ".length + 160);
  });
});

describe("looksLikeOpaquePayload", () => {
  it("flags JSON objects and arrays", () => {
    expect(looksLikeOpaquePayload('{"a":1}')).toBe(true);
    expect(looksLikeOpaquePayload("[1,2]")).toBe(true);
  });
  it("flags long unbroken base64/hex-ish runs", () => {
    expect(looksLikeOpaquePayload("deadbeef".repeat(12))).toBe(true);
  });
  it("passes normal chat text", () => {
    expect(looksLikeOpaquePayload("see you at 9, bring snacks")).toBe(false);
    expect(looksLikeOpaquePayload("short b64 QUJD")).toBe(false);
    expect(looksLikeOpaquePayload("")).toBe(false);
  });
});

describe("sectionChatEntries", () => {
  const dm = (pubkey: string, t: number): ChatEntry =>
    ({ kind: "dm", conv: { pubkey, lastMessage: "", lastTimestamp: t, unread: false } }) as ChatEntry;
  const group = (id: string, t: number): ChatEntry =>
    ({ kind: "group", group: { community_id: id, name: id, lastActivity: t } }) as unknown as ChatEntry;

  it("splits people from groups", () => {
    const out = sectionChatEntries([dm("a", 3), group("g", 2), dm("b", 1)]);
    expect(out.map((s) => s.title)).toEqual(["People", "Groups"]);
    expect(out[0].entries).toHaveLength(2);
    expect(out[1].entries).toHaveLength(1);
  });

  it("preserves recency order within a section", () => {
    const out = sectionChatEntries([dm("newest", 9), dm("middle", 5), dm("oldest", 1)]);
    expect(out[0].entries.map((e) => (e as { conv: { pubkey: string } }).conv.pubkey))
      .toEqual(["newest", "middle", "oldest"]);
  });

  it("omits a section rather than titling an empty one", () => {
    // A heading over nothing reads as a bug. This is also why "Communities" is
    // absent until relay outposts become chat entries.
    expect(sectionChatEntries([dm("a", 1)]).map((s) => s.title)).toEqual(["People"]);
    expect(sectionChatEntries([group("g", 1)]).map((s) => s.title)).toEqual(["Groups"]);
    expect(sectionChatEntries([])).toEqual([]);
  });

  it("loses no entries", () => {
    const input = [dm("a", 3), group("g", 2), dm("b", 1), group("h", 4)];
    const total = sectionChatEntries(input).reduce((n, s) => n + s.entries.length, 0);
    expect(total).toBe(input.length);
  });

  // A COMMUNITY IS A PLACE WITH A PUBLIC FRONT DOOR.
  //
  // The first rule shipped here was "more than one channel", taken from the
  // plan's line "a community is a row that opens into its channels". Real data
  // killed it: a space literally named "Test Community" filed under GROUPS
  // because it had one room, while another sat under COMMUNITIES because it had
  // two — and any space silently changed section the moment someone added a
  // channel. The reader can't see channel counts, so the split looked arbitrary.
  //
  // The honest axis is whether a stranger could get in: a Group is private and
  // invite-only with no address, a Community is relay-backed and joinable by
  // link. That is also what makes NIP-29 / Buzz rooms communities when they
  // become chat entries — it keys off what the thing IS to a person, not which
  // protocol implements it, so no user ever has to learn the word "Concord".
  const community = (id: string, t: number, relayUrl = "wss://relay.example"): ChatEntry =>
    ({ kind: "group", group: { community_id: id, name: id, lastActivity: t, relayUrl } }) as unknown as ChatEntry;

  it("files a relay-backed space under Communities, an invite-only one under Groups", () => {
    const out = sectionChatEntries([community("buzz", 5), group("just-us", 4)]);
    expect(out.map((s) => s.title)).toEqual(["Groups", "Communities"]);
    expect(out[0].entries).toHaveLength(1);
    expect(out[1].entries).toHaveLength(1);
  });

  it("orders sections People → Groups → Communities", () => {
    const out = sectionChatEntries([dm("a", 9), group("g", 8), community("c", 7)]);
    expect(out.map((s) => s.title)).toEqual(["People", "Groups", "Communities"]);
  });

  it("keeps Communities out of the list until one exists", () => {
    // Same rule as the other two: a heading over nothing reads as a bug.
    expect(sectionChatEntries([group("g", 1)]).map((s) => s.title)).toEqual(["Groups"]);
    expect(sectionChatEntries([community("c", 1)]).map((s) => s.title)).toEqual(["Communities"]);
  });

  it("does not promote a space on channel count — that was the old, wrong rule", () => {
    // Ten rooms and no address is still a private group chat. This is the
    // regression that the shipped behaviour got backwards.
    const manyRooms = ({ kind: "group", group: { community_id: "big", name: "big", lastActivity: 1, channelCount: 10 } }) as unknown as ChatEntry;
    expect(sectionChatEntries([manyRooms]).map((s) => s.title)).toEqual(["Groups"]);
  });

  it("treats an absent or empty relayUrl as a group, never a community", () => {
    // Absent metadata must not promote a private chat into a public-sounding
    // heading. The affirmative evidence is a real address, nothing less.
    // Built inline rather than via the fixture: passing `undefined` to a
    // defaulted parameter applies the default, which would have quietly tested
    // the opposite of the intent.
    const noKey = ({ kind: "group", group: { community_id: "unset", name: "unset", lastActivity: 1 } }) as unknown as ChatEntry;
    expect(sectionChatEntries([noKey]).map((s) => s.title)).toEqual(["Groups"]);
    expect(sectionChatEntries([community("blank", 1, "")]).map((s) => s.title)).toEqual(["Groups"]);
    expect(sectionChatEntries([community("spaces", 1, "   ")]).map((s) => s.title)).toEqual(["Groups"]);
  });

  it("preserves recency order inside Communities", () => {
    const out = sectionChatEntries([community("new", 9), community("old", 1)]);
    expect(out[0].entries.map((e) => (e as { group: { community_id: string } }).group.community_id))
      .toEqual(["new", "old"]);
  });

  // A JOINED RELAY OUTPOST is a community you are in. Until now none of them
  // appeared in this list at all — a user in a dozen communities saw an empty
  // Communities heading and had to go through the create drawer to reach any of
  // them. They arrive as their own entry kind because they carry NO clock:
  // OutpostRelay is {url,label,access} with no lastActivity and no unread, so
  // they cannot be interleaved into the recency sort without inventing a
  // recency signal that does not exist. They keep the user's own saved order
  // instead — the one they already control by dragging on the Outposts page.
  const outpost = (url: string, label = url) => ({ url, label });

  it("lists joined relay outposts under Communities, in the given order", () => {
    const out = sectionChatEntries([dm("a", 1)], [outpost("wss://b.example", "Bee"), outpost("wss://a.example", "Ay")]);
    expect(out.map((s) => s.title)).toEqual(["People", "Communities"]);
    expect(out[1].entries.map((e) => (e as { outpost: { label: string } }).outpost.label))
      .toEqual(["Bee", "Ay"]); // saved order, NOT alphabetical and NOT recency
  });

  it("does not list an outpost twice when a Concord space already backs it", () => {
    // relayUrl is exactly the marker for "this encrypted space provides the
    // channels for that relay-backed outpost" — the same place. The Concord row
    // wins because it carries real activity, unread and a teaser; the bare
    // outpost row carries none of those.
    const backed = community("soapbox", 5, "wss://relay.example");
    const out = sectionChatEntries([backed], [outpost("wss://relay.example", "Soapbox")]);
    expect(out.map((s) => s.title)).toEqual(["Communities"]);
    expect(out[0].entries).toHaveLength(1);
    expect((out[0].entries[0] as { kind: string }).kind).toBe("group");
  });

  it("matches a backing space despite trailing-slash and case differences", () => {
    const backed = community("x", 5, "WSS://Relay.Example/");
    const out = sectionChatEntries([backed], [outpost("wss://relay.example", "Dup")]);
    expect(out[0].entries).toHaveLength(1);
  });

  it("keeps an unrelated outpost alongside a backed one", () => {
    const backed = community("x", 5, "wss://a.example");
    const out = sectionChatEntries([backed], [outpost("wss://a.example", "Same"), outpost("wss://b.example", "Other")]);
    expect(out[0].entries).toHaveLength(2);
  });

  it("still omits Communities when there are neither backed spaces nor outposts", () => {
    expect(sectionChatEntries([dm("a", 1), group("g", 2)], []).map((s) => s.title)).toEqual(["People", "Groups"]);
  });

  it("still loses no entries once three sections exist", () => {
    const input = [dm("a", 6), community("c", 5), group("g", 4), dm("b", 3), community("d", 2)];
    const total = sectionChatEntries(input).reduce((n, s) => n + s.entries.length, 0);
    expect(total).toBe(input.length);
  });
});

describe("orderCommunitiesByActivity", () => {
  const NOW = 1_700_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const outpost = (url: string): ChatEntry =>
    ({ kind: "outpost", outpost: { url, label: url } }) as ChatEntry;
  const concord = (id: string, at: number): ChatEntry =>
    ({ kind: "group", group: { communityId: id, name: id, lastActivity: at, relayUrl: `wss://${id}` } }) as unknown as ChatEntry;
  const names = (out: ChatEntry[]) =>
    out.map((e) => (e.kind === "outpost" ? e.outpost.url : (e as { group: { communityId: string } }).group.communityId));

  it("floats recently active communities, newest first", () => {
    const out = orderCommunitiesByActivity(
      [outpost("a"), outpost("b"), outpost("c")],
      new Map([["a", NOW - DAY], ["c", NOW - 60_000]]),
      NOW,
    );
    expect(names(out)).toEqual(["c", "a", "b"]);
  });

  it("does NOT float a community that was last active months ago", () => {
    // The rule the first version of this got wrong: sorting everything we know
    // about put a long-dead community above the order the user set by hand.
    // "Updated activity" has to mean recent, or the float means nothing.
    const out = orderCommunitiesByActivity(
      [outpost("hand-placed-first"), outpost("stale")],
      new Map([["stale", NOW - 90 * DAY]]),
      NOW,
    );
    expect(names(out)).toEqual(["hand-placed-first", "stale"]);
  });

  it("treats a relay we never reached exactly like a quiet one — neither is moved", () => {
    // Absent means "we did not get to ask". It must not be read as activity of
    // zero, and it must not be punished relative to a community we DID reach
    // and found quiet. Both simply keep their place.
    const saved = [outpost("unreachable"), outpost("quiet")];
    const out = orderCommunitiesByActivity(saved, new Map([["quiet", NOW - 200 * DAY]]), NOW);
    expect(names(out)).toEqual(["unreachable", "quiet"]);
  });

  it("preserves saved order among everything that does not float", () => {
    const out = orderCommunitiesByActivity([outpost("x"), outpost("y"), outpost("z")], new Map(), NOW);
    expect(names(out)).toEqual(["x", "y", "z"]);
  });

  it("lets a Concord space compete on its own clock", () => {
    const out = orderCommunitiesByActivity(
      [concord("space", NOW - 2 * DAY), outpost("busy")],
      new Map([["busy", NOW - 60_000]]),
      NOW,
    );
    expect(names(out)).toEqual(["busy", "space"]);
  });

  it("matches a relay url regardless of trailing slash or case", () => {
    const out = orderCommunitiesByActivity(
      [outpost("wss://A.example/"), outpost("wss://b.example")],
      new Map([["wss://a.example", NOW - 60_000]]),
      NOW,
    );
    expect(names(out)[0]).toBe("wss://A.example/");
  });
});

describe("needsSynthesizedPeopleSection", () => {
  const peopleSection = { title: "People", entries: [] };
  const groupsOnly = [{ title: "Groups", entries: [] }, { title: "Communities", entries: [] }];

  it("shows PEOPLE for requests when every primary DM is gone", () => {
    // The reported bug: demote your last primary conversation and the PEOPLE
    // heading disappears — taking the only route to Requests with it, while the
    // conversation is still sitting in Requests.
    expect(needsSynthesizedPeopleSection(groupsOnly, "primary", 5)).toBe(true);
  });

  it("does not duplicate PEOPLE when the section is already there", () => {
    expect(needsSynthesizedPeopleSection([peopleSection, ...groupsOnly], "primary", 5)).toBe(false);
  });

  it("shows nothing when there are no requests", () => {
    expect(needsSynthesizedPeopleSection(groupsOnly, "primary", 0)).toBe(false);
  });

  it("does not offer the entry from inside the Requests view itself", () => {
    expect(needsSynthesizedPeopleSection(groupsOnly, "requests", 5)).toBe(false);
  });

  it("holds when the inbox contains NOTHING but requests", () => {
    // Otherwise the empty state claims 'no conversations yet' over five people
    // trying to reach you.
    expect(needsSynthesizedPeopleSection([], "primary", 3)).toBe(true);
  });
});

describe("the chat-home filter", () => {
  const person = (id: string, unread = false): ChatEntry => ({ kind: "dm", conv: { ...dm(id, 5), unread } });
  const severalPeople = (unread = false): ChatEntry => ({ kind: "dm", conv: { ...dm("group:" + "b".repeat(64) + "," + "c".repeat(64), 6), unread } });
  const encryptedGroup = (unread = false): ChatEntry => ({ kind: "group", group: { ...group("g1", 9), unread } });
  const community = (): ChatEntry => ({ kind: "group", group: { ...group("c1", 9), relayUrl: "wss://relay.example" } });
  const keys = (opts: ReturnType<typeof chatFilterOptions>) => opts.map((o) => o.key);

  it("offers nothing when there is only one kind of chat", () => {
    // A filter row over a single category is a control that cannot change
    // anything — the exact "dead control" shape, and pure clutter on a phone.
    expect(chatFilterOptions([person("a"), person("b")], 0)).toEqual([]);
  });

  it("leads with All once there are two kinds to choose between", () => {
    expect(keys(chatFilterOptions([person("a"), encryptedGroup()], 0))).toEqual(["all", "people", "groups"]);
  });

  it("a private chat with several people is a group, not a person", () => {
    // Before, it sat under People with a generic icon; to anyone but a
    // developer a chat with Bob and Carol is a group.
    const opts = chatFilterOptions([person("a"), severalPeople()], 0);
    expect(keys(opts)).toEqual(["all", "people", "groups"]);
    expect(opts.find((o) => o.key === "groups")!.count).toBe(1);
    expect(applyChatFilter([person("a"), severalPeople()], "groups")).toEqual([severalPeople()]);
    expect(applyChatFilter([person("a"), severalPeople()], "people")).toEqual([person("a")]);
  });

  it("offers Unread when something is unread, right after All", () => {
    const opts = chatFilterOptions([person("a", true), encryptedGroup()], 0);
    expect(keys(opts)).toEqual(["all", "unread", "people", "groups"]);
    expect(opts.find((o) => o.key === "unread")!.count).toBe(1);
    expect(keys(chatFilterOptions([person("a"), encryptedGroup()], 0))).not.toContain("unread");
  });

  it("Unread shows only what is unread, of any kind", () => {
    const list = [person("a"), person("b", true), severalPeople(true), encryptedGroup(), community()];
    expect(applyChatFilter(list, "unread")).toEqual([person("b", true), severalPeople(true)]);
  });

  it("never offers a chip for a category you have none of", () => {
    expect(keys(chatFilterOptions([person("a"), encryptedGroup()], 0))).not.toContain("communities");
  });

  it("counts the rows behind each chip, and All counts everything", () => {
    const opts = chatFilterOptions([person("a"), encryptedGroup(), community()], 0);
    expect(opts.find((o) => o.key === "all")!.count).toBe(3);
    expect(opts.find((o) => o.key === "people")!.count).toBe(1);
    expect(opts.find((o) => o.key === "communities")!.count).toBe(1);
  });

  it("keeps People reachable when its only content is requests", () => {
    // Requests are people: with nothing else from people, the chip must still
    // exist, or a pending request has no door.
    const opts = chatFilterOptions([encryptedGroup()], 2);
    expect(keys(opts)).toContain("people");
    expect(opts.find((o) => o.key === "people")!.count).toBe(2);
  });

  it("does not invent a People chip when there are no requests and no DMs", () => {
    expect(keys(chatFilterOptions([encryptedGroup(), community()], 0))).not.toContain("people");
  });

  it("shows only the chosen category, in the order given", () => {
    const list = [person("a"), encryptedGroup(), community(), severalPeople()];
    expect(applyChatFilter(list, "groups")).toEqual([encryptedGroup(), severalPeople()]);
    expect(applyChatFilter(list, "communities")).toEqual([community()]);
  });

  it("shows everything under All", () => {
    const all = [person("a"), encryptedGroup(), community()];
    expect(applyChatFilter(all, "all")).toEqual(all);
  });

  it("falls back to All when the chosen category disappears underneath you", () => {
    const opts = chatFilterOptions([person("a"), encryptedGroup()], 0);
    expect(resolveChatFilter("communities", opts)).toBe("all");
    expect(resolveChatFilter("unread", opts)).toBe("all");
  });

  it("keeps a still-valid choice", () => {
    const opts = chatFilterOptions([person("a"), encryptedGroup()], 0);
    expect(resolveChatFilter("groups", opts)).toBe("groups");
  });

  it("falls back to All when the filter row itself goes away", () => {
    expect(resolveChatFilter("groups", [])).toBe("all");
  });
});

describe("communitiesForTab", () => {
  const outposts = [{ url: "wss://a.test", label: "A" }, { url: "wss://b.test", label: "B" }];

  it("keeps communities out of Requests", () => {
    // Requests is a SAFETY slice — DMs from people outside your web of trust.
    // `entries` is already tab-scoped, but joined communities reach
    // sectionChatEntries on a SEPARATE argument, so they bypassed that scoping
    // entirely and a COMMUNITIES heading rendered under a list of strangers.
    expect(communitiesForTab("requests", outposts)).toEqual([]);
  });

  it("leaves the primary list alone", () => {
    expect(communitiesForTab("primary", outposts)).toEqual(outposts);
  });
});

/**
 * A second tap on the Chats tab, already at the top, opens your first unread
 * chat (owner, 2026-09-30): the first one in the order the list shows them,
 * opened exactly as tapping its row would.
 */
describe("firstUnreadChat", () => {
  const person = (pubkey: string, unread: boolean): ChatEntry =>
    ({ kind: "dm", conv: { pubkey, lastMessage: "hi", lastTimestamp: 1, unread } });
  const groupChat = (communityId: string, over: Partial<GroupPreview> = {}): ChatEntry =>
    ({ kind: "group", group: { communityId, name: communityId, channelCount: 1, lastActivity: 1, unread: false, mentions: 0, muted: false, members: [], ...over } as GroupPreview });
  const community: ChatEntry = { kind: "outpost", outpost: { url: "wss://relay.example", label: "Relay" } as any };

  it("is the first unread row from the top, whatever kind it is", () => {
    expect(firstUnreadChat([person("alice", false), person("bob", true), groupChat("g1", { unread: true })]))
      .toEqual({ kind: "dm", pubkey: "bob" });
    expect(firstUnreadChat([person("alice", false), groupChat("g1", { unread: true }), person("bob", true)]))
      .toEqual({ kind: "group", communityId: "g1", channelId: undefined });
  });

  it("a group opens where tapping its row would: the previewed room, else its first unread room", () => {
    expect(firstUnreadChat([groupChat("g1", { unread: true, teaserChannelId: "teased", firstUnreadChannelId: "first" })]))
      .toEqual({ kind: "group", communityId: "g1", channelId: "teased" });
    expect(firstUnreadChat([groupChat("g1", { unread: true, firstUnreadChannelId: "first" })]))
      .toEqual({ kind: "group", communityId: "g1", channelId: "first" });
  });

  it("a muted group is never what it opens", () => {
    expect(firstUnreadChat([groupChat("quiet", { unread: true, muted: true }), person("bob", true)]))
      .toEqual({ kind: "dm", pubkey: "bob" });
  });

  it("joined communities have no unread of their own to open", () => {
    expect(firstUnreadChat([community, person("bob", true)])).toEqual({ kind: "dm", pubkey: "bob" });
  });

  it("nothing unread: nothing to open", () => {
    expect(firstUnreadChat([person("alice", false), groupChat("g1"), community])).toBeNull();
    expect(firstUnreadChat([])).toBeNull();
  });
});

describe("the chat home's ⋯ menu", () => {
  const base = { isMobile: false, privateMasked: false, hasPetnames: false, showingRealNames: false, deletedCount: 0 };

  it("desktop, nothing renamed, nothing deleted: hide chats, then check for new messages", () => {
    expect(chatHomeMenu(base).map((i) => i.key)).toEqual(["private", "refresh"]);
  });

  it("touch has no refresh item: pulling the list is the refresh", () => {
    expect(chatHomeMenu({ ...base, isMobile: true }).map((i) => i.key)).toEqual(["private"]);
  });

  it("real names only exists for someone with petnames, and flips its wording", () => {
    expect(chatHomeMenu({ ...base, hasPetnames: true }).find((i) => i.key === "real-names")?.label).toBe("Show real names");
    expect(chatHomeMenu({ ...base, hasPetnames: true, showingRealNames: true }).find((i) => i.key === "real-names")?.label).toBe("Show your names");
  });

  it("the deleted folder appears only once something is in it, last, with its count", () => {
    expect(chatHomeMenu({ ...base, deletedCount: 0 }).some((i) => i.key === "deleted")).toBe(false);
    const full = chatHomeMenu({ ...base, hasPetnames: true, deletedCount: 3 });
    expect(full.map((i) => i.key)).toEqual(["private", "refresh", "real-names", "deleted"]);
    expect(full[3].label).toBe("Deleted (3)");
  });

  it("while chats are hidden the first item is the way back", () => {
    expect(chatHomeMenu({ ...base, privateMasked: true })[0].label).toBe("Show chats");
  });
});

// Measured in the history rig (2026-10-02): a long first load finished with a
// list built before the newest message arrived by the notification path, and
// the chat's preview showed its second-newest message.
describe("keepNewerPreviews — a finished load doesn't roll a chat's preview back", () => {
  const c = (pubkey: string, lastTimestamp: number, lastMessage: string, extra: Partial<ConversationPreview> = {}): ConversationPreview =>
    ({ pubkey, lastTimestamp, lastMessage, unread: false, ...extra });

  it("the newer message already on screen is kept over the load's older one", () => {
    const out = keepNewerPreviews([c("alice", 200, "recent 0", { unread: true })], [c("alice", 140, "recent 1")]);
    expect(out).toEqual([c("alice", 200, "recent 0", { unread: true })]);
  });

  it("the load's message wins when it is the newer (or the same) one", () => {
    expect(keepNewerPreviews([c("alice", 100, "old")], [c("alice", 300, "new")])[0].lastMessage).toBe("new");
    expect(keepNewerPreviews([c("alice", 100, "same")], [c("alice", 100, "reloaded")])[0].lastMessage).toBe("reloaded");
  });

  it("the list is exactly the load's chats: a chat no longer in it is not brought back", () => {
    expect(keepNewerPreviews([c("alice", 100, "a"), c("deleted", 999, "gone")], [c("alice", 100, "a")]).map((x) => x.pubkey)).toEqual(["alice"]);
  });

  it("a chat the screen didn't have is simply added, newest chat first", () => {
    expect(keepNewerPreviews([c("alice", 100, "a")], [c("alice", 100, "a"), c("carol", 500, "c")]).map((x) => x.pubkey)).toEqual(["carol", "alice"]);
  });

  it("the newer chat NAME is kept whichever side has it", () => {
    const shown = [c("g", 200, "hi", { subject: "Old name", subjectAt: 50 })];
    const next = [c("g", 100, "earlier", { subject: "New name", subjectAt: 90 })];
    expect(keepNewerPreviews(shown, next)[0]).toMatchObject({ lastMessage: "hi", subject: "New name", subjectAt: 90 });
  });

  it("a name already on screen survives a load that brings the chat without one", () => {
    // The naming message arrived live; the load's list was read from the store
    // before that message was written to it, so its copy of the chat is unnamed.
    const shown = [c("g", 100, "trip planning", { subject: "Lisbon trip", subjectAt: 100 })];
    expect(keepNewerPreviews(shown, [c("g", 300, "count me in")])[0]).toMatchObject({ lastMessage: "count me in", subject: "Lisbon trip", subjectAt: 100 });
    expect(keepNewerPreviews(shown, [c("g", 100, "trip planning")])[0]).toMatchObject({ subject: "Lisbon trip" });
  });

  it("a chat with no name on either side gains none", () => {
    expect("subject" in keepNewerPreviews([c("alice", 100, "a")], [c("alice", 300, "b")])[0]).toBe(false);
  });
});

describe("mergeChatEntries — pinned chats lead the list", () => {
  const dm = (pubkey: string, lastTimestamp: number): ConversationPreview => ({ pubkey, lastTimestamp, lastMessage: "x", unread: false });
  const keys = (entries: ReturnType<typeof mergeChatEntries>) => entries.map((e) => (e.kind === "dm" ? e.conv.pubkey : "group"));
  const dms = [dm("newest", 300), dm("middle", 200), dm("oldest", 100)];

  it("a pinned chat comes first however old its last message", () => {
    expect(keys(mergeChatEntries(dms, [], { tab: "primary", pinned: ["oldest"] }))).toEqual(["oldest", "newest", "middle"]);
  });

  it("several pins keep the order they were pinned in (newest pin first), not recency", () => {
    expect(keys(mergeChatEntries(dms, [], { tab: "primary", pinned: ["oldest", "newest"] }))).toEqual(["oldest", "newest", "middle"]);
  });

  it("without pins the list is purely by recency, as before", () => {
    expect(keys(mergeChatEntries(dms, [], { tab: "primary" }))).toEqual(["newest", "middle", "oldest"]);
    expect(keys(mergeChatEntries(dms, [], { tab: "primary", pinned: [] }))).toEqual(["newest", "middle", "oldest"]);
  });

  it("a pin for a chat that isn't in the list changes nothing", () => {
    expect(keys(mergeChatEntries(dms, [], { tab: "primary", pinned: ["gone"] }))).toEqual(["newest", "middle", "oldest"]);
  });

  it("while searching, results are not reordered by pins", () => {
    expect(keys(mergeChatEntries(dms, [], { tab: "primary", pinned: ["oldest"], searchFilter: "x" }))).toEqual(["newest", "middle", "oldest"]);
  });
});

describe("orderRequests — requests from strangers, most trusted first", () => {
  const c = (pubkey: string, lastTimestamp: number): ConversationPreview => ({ pubkey, lastTimestamp, lastMessage: pubkey, unread: false });
  const standing: Record<string, { rank: number; flagged: boolean }> = {
    known: { rank: 2, flagged: false },
    faint: { rank: 1, flagged: false },
    nobody: { rank: 0, flagged: false },
    nobody2: { rank: 0, flagged: false },
    bad: { rank: 2, flagged: true },
  };
  const of = (key: string) => standing[key];

  it("puts the people your network knows something about above the ones it knows nothing about", () => {
    const out = orderRequests([c("nobody", 900), c("faint", 100), c("known", 50)], of);
    expect(out.open.map((x) => x.pubkey)).toEqual(["known", "faint", "nobody"]);
  });

  it("orders people of the same standing by their newest message", () => {
    const out = orderRequests([c("nobody", 100), c("nobody2", 500)], of);
    expect(out.open.map((x) => x.pubkey)).toEqual(["nobody2", "nobody"]);
  });

  it("sets apart the senders your network has flagged, however they score", () => {
    const out = orderRequests([c("bad", 999), c("known", 1)], of);
    expect(out.open.map((x) => x.pubkey)).toEqual(["known"]);
    expect(out.flagged.map((x) => x.pubkey)).toEqual(["bad"]);
  });

  it("does not show what a flagged sender wrote in the list", () => {
    const out = orderRequests([c("bad", 999)], of);
    expect(out.flagged[0].lastMessage).not.toContain("bad");
    expect(out.flagged[0].lastMessage).toBe("Message hidden");
  });

  it("with no requests there is nothing in either part", () => {
    expect(orderRequests([], of)).toEqual({ open: [], flagged: [] });
  });
});

describe("mergeChatEntries — the Requests view keeps the order it is given", () => {
  const c = (pubkey: string, lastTimestamp: number): ConversationPreview => ({ pubkey, lastTimestamp, lastMessage: "", unread: false });
  it("does not re-sort requests by recency: they arrive ordered by trust", () => {
    const out = mergeChatEntries([c("trusted-old", 10), c("stranger-new", 999)], [], { tab: "requests" });
    expect(out.map((e) => (e.kind === "dm" ? e.conv.pubkey : ""))).toEqual(["trusted-old", "stranger-new"]);
  });
  it("still sorts the chat list itself by recency", () => {
    const out = mergeChatEntries([c("old", 10), c("new", 999)], [], { tab: "primary" });
    expect(out.map((e) => (e.kind === "dm" ? e.conv.pubkey : ""))).toEqual(["new", "old"]);
  });
});
