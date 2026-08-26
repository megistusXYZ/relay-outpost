import { nip19 } from "nostr-tools";
import { classifyUrl } from "@/lib/media-utils";

// Pure helpers + types shared between Messages.tsx (the page/thread) and the
// extracted conversation list (ChatList / ChatListRow). Moved verbatim from
// Messages.tsx — no behavior changes.

export interface ConversationPreview {
  pubkey: string;
  lastMessage: string;
  lastTimestamp: number;
  unread: boolean;
}

export type DmTab = "primary" | "requests";

/** A Concord group chat as the conversation list sees it. */
export interface GroupPreview {
  communityId: string;
  /** The SHARED group name — same for every member (folded/record/member-join). */
  name: string;
  /** Custom group image (metadata.picture); absent ⇒ facepile of members. */
  icon?: string;
  channelCount: number;
  /** Newest known activity, ms since epoch (concord-unread's clock). */
  lastActivity: number;
  unread: boolean;
  /** Unread MENTIONS of you across the group's channels — the only number a
   *  group row ever shows (calm rule: plain activity is just a dot/bold). */
  mentions: number;
  /** Community-level mute — the row renders quiet and contributes no counts. */
  muted: boolean;
  /** Where a tap should land while the group is unread: the first
   *  mention-bearing channel, else the first plain-unread one. */
  firstUnreadChannelId?: string;
  /** The channel the last-message teaser is from — a tap opens THAT channel (so
   *  you land on exactly what the row previewed), taking priority over
   *  firstUnreadChannelId. */
  teaserChannelId?: string;
  /** Member pubkeys (roster snapshot) — drives the facepile avatar. */
  members: string[];
  /** Resolved member display names — kept on the item so search matches them. */
  memberNames?: string[];
  /**
   * Locally-decrypted last-message teaser ("Vitor: testing from amethyst"),
   * sourced ONLY from the already-decrypted IDB message cache — absent until
   * a channel stream has been opened once (falls back to the encrypted line).
   */
  teaser?: string;
  /**
   * The relay this space is backed by, when it has one — i.e. it has a public
   * address a stranger could arrive at. Present ⇒ Community, absent ⇒ Group.
   * See isCommunityEntry; this is the whole basis of that split.
   */
  relayUrl?: string;
}

/**
 * A relay outpost the user has joined, as the conversation list sees it.
 * Deliberately thin: this is everything OutpostRelay actually knows. There is
 * no lastActivity and no unread anywhere in that record, which is exactly why
 * these rows keep the user's saved order instead of joining the recency sort.
 */
export interface OutpostPreview {
  url: string;
  label: string;
  /** NIP-11 icon when one resolved; the row falls back to a glyph without it. */
  icon?: string;
  /** Mirrors the lock on the Outposts card so one community reads the same in
   *  both places. */
  private?: boolean;
}

/** One conversation-list entry: a 1:1 DM, a group chat, or a joined community. */
export type ChatEntry =
  | { kind: "dm"; conv: ConversationPreview }
  | { kind: "group"; group: GroupPreview }
  | { kind: "outpost"; outpost: OutpostPreview };

/** Sort key in SECONDS (DM previews carry seconds, group activity carries ms). */
function entryTime(e: ChatEntry): number {
  if (e.kind === "dm") return e.conv.lastTimestamp;
  if (e.kind === "group") return Math.floor(e.group.lastActivity / 1000);
  // Outposts never reach here: they are passed to sectionChatEntries directly,
  // NOT through mergeChatEntries, precisely because they have no clock to sort
  // by. If one ever does arrive, 0 sinks it rather than letting an invented
  // timestamp float it to the top.
  return 0;
}

/**
 * Merge DM previews with group chats into one recency-sorted (desc) list.
 * Groups only ever join the Primary tab — membership is explicit, so a group
 * has no "request" state — and the conversation search filter matches the
 * group name AND any member display name, so neither handle makes a chat
 * unfindable (DMs arrive already search-filtered by the caller).
 */
export function mergeChatEntries(
  dms: ConversationPreview[],
  groups: GroupPreview[],
  opts: { tab: DmTab; searchFilter?: string },
): ChatEntry[] {
  const q = (opts.searchFilter ?? "").trim().toLowerCase();
  const matches = (g: GroupPreview) =>
    !q
    || g.name.toLowerCase().includes(q)
    || (g.memberNames ?? []).some((n) => n.toLowerCase().includes(q));
  const groupEntries: ChatEntry[] = opts.tab === "primary"
    ? groups.filter(matches).map((g) => ({ kind: "group", group: g }))
    : [];
  const dmEntries: ChatEntry[] = dms.map((conv) => ({ kind: "dm", conv }));
  return [...dmEntries, ...groupEntries].sort((a, b) => entryTime(b) - entryTime(a));
}

export interface ProfileInfo {
  name?: string;
  display_name?: string;
  picture?: string;
  /**
   * The claimed NIP-05 address. ChatListRow has been passing this to Nip05Badge
   * since it was written, but the field was never on the type — so the badge
   * received undefined and has never once rendered, and the impersonation chip
   * beside it has always run without its strongest signal.
   */
  nip05?: string;
}

export const URL_REGEX = /(https?:\/\/[^\s<>"]+)/g;

function stripEventPayload(text: string): string {
  const idx = text.indexOf("---OUTPOST_EVENT---");
  return idx !== -1 ? text.slice(0, idx).trimEnd() : text;
}

export function formatConversationPreview(text: string): string {
  const cleaned = stripEventPayload(text);
  const regex = new RegExp(URL_REGEX.source, "g");
  let hasMedia = false;
  let mediaLabel = "";
  let textOnly = cleaned;
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const url = match[1];
    const mt = classifyUrl(url);
    if (mt === "image") { hasMedia = true; mediaLabel = "📷 Photo"; }
    else if (mt === "video") { hasMedia = true; mediaLabel = "🎬 Video"; }
    else if (mt === "audio") { hasMedia = true; mediaLabel = "🎵 Audio"; }
  }
  if (hasMedia) {
    textOnly = cleaned.replace(URL_REGEX, "").trim();
    if (!textOnly) return mediaLabel;
    return `${mediaLabel} · ${textOnly}`;
  }
  return cleaned;
}

// ── Encrypted-group teaser (pure) ────────────────────────────────────────────
/**
 * Ciphertext/JSON guard for the chat list: the teaser must NEVER render an
 * opaque payload. Catches JSON objects/arrays (event payloads) and long
 * unbroken base64/hex-ish blobs (ciphertext-shaped strings).
 */
export function looksLikeOpaquePayload(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^[{[]/.test(t)) {
    try { JSON.parse(t); return true; } catch { /* not valid JSON — fall through */ }
  }
  return t.length >= 80 && /^[A-Za-z0-9+/=_-]+$/.test(t);
}

function mediaPlaceholder(mime: string): string {
  if (mime.startsWith("image/")) return "📷 Photo";
  if (mime.startsWith("video/")) return "🎬 Video";
  if (mime.startsWith("audio/")) return "🎵 Audio";
  return "📎 File";
}

/**
 * One-line teaser for an encrypted group row: "Vitor: testing from amethyst"
 * (sender's first name + text). Media-only messages become their placeholder
 * ("Vitor: 📷 Photo"); media + caption combine ("Vitor: 📷 Photo · nice").
 * Returns null (⇒ caller falls back to the generic encrypted line) for
 * deleted messages, empty content, and anything opaque-looking — the list
 * must never show ciphertext or raw JSON.
 */
export function formatGroupTeaser(
  msg: { content: string; media?: { mime: string }[]; deleted?: boolean },
  senderName: string,
): string | null {
  if (msg.deleted) return null;
  const name = (senderName || "").trim().split(/\s+/)[0] || "Someone";
  const text = (msg.content || "").replace(/\s+/g, " ").trim();
  if (looksLikeOpaquePayload(text)) return null;
  // formatConversationPreview turns bare media URLs (public GIFs) into "📷 Photo".
  const pretty = text ? formatConversationPreview(text) : "";
  const media = msg.media?.[0];
  const body = media
    ? (pretty ? `${mediaPlaceholder(media.mime)} · ${pretty}` : mediaPlaceholder(media.mime))
    : pretty;
  if (!body) return null;
  return `${name}: ${body.slice(0, 160)}`;
}

export function getDMDisplayName(profile: ProfileInfo | null, pubkey: string): string {
  if (profile?.display_name) return profile.display_name;
  if (profile?.name) return profile.name;
  try {
    const npub = nip19.npubEncode(pubkey);
    return npub.slice(0, 8) + "..." + npub.slice(-4);
  } catch {
    return pubkey.slice(0, 8) + "...";
  }
}

export function formatMessageTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** A titled run of chat entries, for the sectioned (collapsed-IA) list. */
export interface ChatSection {
  title: string;
  entries: ChatEntry[];
}

/**
 * Is this space a COMMUNITY rather than a group chat?
 *
 * A COMMUNITY IS A PLACE WITH A PUBLIC FRONT DOOR. A Group is private and
 * invite-only and has no address; a Community is relay-backed, so a stranger
 * holding a link can arrive at it.
 *
 * The first rule here was "more than one channel", read straight off the plan's
 * line *"a community is a row that opens into its channels"*. Real data killed
 * it: a space literally named "Test Community" filed under GROUPS because it
 * had one room, while another sat under COMMUNITIES because it had two — and
 * any space silently changed section the moment someone added a channel. A
 * reader cannot see channel counts, so the split read as arbitrary, which is
 * the one thing a section heading must never be.
 *
 * Keying on the address fixes all three faults at once: it is visible (you got
 * in by a link, or you were invited), it is stable (adding a room changes
 * nothing), and it is protocol-agnostic. That last part matters most — it is
 * what will let NIP-29 / Buzz rooms land in Communities when they become chat
 * entries, without anyone ever having to learn the word "Concord". The nav says
 * what a thing IS to a person, never which spec implements it.
 *
 * Absent, empty, or whitespace-only stays a Group. The affirmative evidence is
 * a real address, nothing less — the same positive-only discipline the
 * verification check uses on people.
 */
export function isCommunityEntry(entry: ChatEntry): boolean {
  return entry.kind === "group" && !!entry.group.relayUrl?.trim();
}

/**
 * Group the merged chat list into People / Groups / Communities.
 *
 * Sections carry the membership information a flat recency list throws away — a
 * DM from one person and a 500-member community are genuinely different things
 * to scan for, even though they were never different OBJECTS (which is why they
 * share one list rather than one tab each).
 *
 * Recency order is preserved WITHIN each section, so nothing jumps relative to
 * its neighbours; only the grouping is new. Empty sections are omitted rather
 * than rendered as headings over nothing — a heading with nothing under it
 * reads as a bug.
 */
/** Relay-URL identity: trailing slashes and case are not differences. */
function sameRelay(a: string): string {
  return a.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Group the merged list into People / Groups / Communities.
 *
 * `joinedCommunities` arrives SEPARATELY from `entries`, and that separation is
 * the honest part. A joined relay outpost carries no clock — OutpostRelay is
 * {url, label, access} with no lastActivity and no unread — so it cannot be
 * interleaved into the recency sort without inventing a recency signal that
 * does not exist. It keeps the user's own saved order instead, the one they
 * already control by dragging on the Outposts page. Two different orderings in
 * one list is a real cost, but it is the truth: the rows above are "what just
 * happened", these are "the places you're in".
 *
 * Before this, a user in a dozen communities saw an EMPTY Communities heading
 * and had to go through the create drawer to reach any of them, because joined
 * outposts were never chat entries at all.
 *
 * Dedup matters: a Concord space with `relayUrl` provides the encrypted
 * channels FOR one of these outposts — the same place, reachable two ways. The
 * Concord row wins, because it carries real activity, unread and a teaser while
 * the bare outpost row carries none of those.
 */
/**
 * Float the RECENTLY active communities; leave everything else where the user
 * put it.
 *
 * Two kinds of row share this section. A Concord space carries a real clock
 * (`lastActivity`). A joined relay outpost carries none — `OutpostPreview` is
 * {url,label,icon,private} — which is why these rows have always kept the order
 * the user set by dragging on the Outposts page.
 *
 * `activityByUrl` closes that gap, and it holds an entry ONLY for a relay we
 * actually heard back from. Unreachable, or opened-then-refused, is ABSENT —
 * never zero. The caller gets that distinction from `withReach`.
 *
 * WHY A WINDOW, and not simply "sort everything we know about". Sorting all
 * known rows above all unknown ones ranks a community last active in March above
 * one we merely failed to reach — which is both arbitrary and not what "updated
 * activity" means. So only activity inside RECENT_ACTIVITY_WINDOW earns the
 * float. A quiet community and an unreachable one are then treated the same way,
 * which is the honest answer: in neither case do we have a reason to move it.
 *
 * That also means an absent entry and a stale one behave identically. Worth
 * stating plainly, because it means the reachability contract here is about not
 * INVENTING a timestamp — it is not load-bearing for the sort, and a test that
 * claims to prove it by ordering alone proves nothing.
 */
export const RECENT_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function orderCommunitiesByActivity(
  entries: ChatEntry[],
  activityByUrl: Map<string, number> = new Map(),
  now: number = Date.now(),
): ChatEntry[] {
  const clockOf = (e: ChatEntry): number | undefined => {
    if (e.kind === "group") return e.group.lastActivity;
    if (e.kind === "outpost") return activityByUrl.get(sameRelay(e.outpost.url));
    return undefined;
  };
  const recent: { e: ChatEntry; t: number }[] = [];
  const rest: ChatEntry[] = [];
  for (const e of entries) {
    const t = clockOf(e);
    if (typeof t === "number" && now - t <= RECENT_ACTIVITY_WINDOW_MS) recent.push({ e, t });
    else rest.push(e);
  }
  recent.sort((a, b) => b.t - a.t);
  return [...recent.map((r) => r.e), ...rest];
}

/**
 * Requests are people, so PEOPLE must exist whenever there are requests.
 *
 * This encodes a regression rather than a preference. When the Primary/Requests
 * tab row was replaced by a row inside the PEOPLE section, requests inherited
 * that section's emptiness: PEOPLE is omitted when you have no primary DMs —
 * correctly, a heading over nothing reads as a bug — so demoting your last
 * primary conversation made Requests unreachable, with the conversation still
 * sitting in it. The tab it replaced was always on screen.
 *
 * Pure because the alternative was a boolean buried in JSX, which is exactly
 * where the first version hid.
 */
export function needsSynthesizedPeopleSection(
  sections: ChatSection[],
  dmTab: DmTab,
  totalRequests: number,
): boolean {
  if (dmTab !== "primary" || totalRequests <= 0) return false;
  return !sections.some((s) => s.title === "People");
}

// ── The chat-home filter ─────────────────────────────────────────────────────
/**
 * Which slice of the chat home is on screen.
 *
 * This is the axis the OLD Primary/Requests tab row got wrong. That row put a
 * SAFETY boundary (requests are DMs from outside your web of trust) on the same
 * rail as a taxonomy, and named neither of the three things the body was
 * actually sectioned into. These chips are the sections — one control, one
 * meaning, and requests stay where they belong: a row inside People.
 */
export type ChatFilter = "all" | "people" | "groups" | "communities";

export interface ChatFilterOption {
  key: ChatFilter;
  label: string;
  /** Rows behind this chip. Shown, because "Groups" and "Groups 12" are
   *  different pieces of information when you are deciding where to look. */
  count: number;
  /** Rows behind it that are unread — what actually decides where you tap. */
  unread: number;
}

const FILTER_BY_TITLE: Record<string, ChatFilter> = {
  People: "people",
  Groups: "groups",
  Communities: "communities",
};

const LABELS: Record<ChatFilter, string> = {
  all: "All",
  people: "People",
  groups: "Groups",
  communities: "Communities",
};

/** An outpost row carries no unread state at all — see the ChatEntry union. */
function unreadCount(entries: ChatEntry[]): number {
  return entries.filter((e) => (e.kind === "dm" ? e.conv.unread : e.kind === "group" ? e.group.unread : false)).length;
}

/**
 * The chips to offer — derived from what is actually there, never a fixed set.
 *
 * TWO RULES, both of which are the difference between a filter and a liability:
 *
 * 1. **Never offer a category you have none of.** A "Communities" chip for
 *    someone in no communities filters to a blank screen, which reads as a bug
 *    in the app rather than as an empty set.
 * 2. **Never render the row at all below two categories.** One chip plus All
 *    cannot change what you see; it is a dead control taking a row of vertical
 *    space, which is expensive on a phone.
 *
 * `requestCount` is passed separately rather than read off `sections` for the
 * reason `needsSynthesizedPeopleSection` exists: requests live inside PEOPLE,
 * and PEOPLE is omitted when you have no primary DMs. Deriving the chips from
 * the rendered sections alone would hide the only door to a pending request —
 * the same regression, one layer up.
 */
export function chatFilterOptions(sections: ChatSection[], requestCount: number): ChatFilterOption[] {
  const present: ChatFilterOption[] = [];
  for (const s of sections) {
    const key = FILTER_BY_TITLE[s.title];
    if (!key) continue;
    present.push({ key, label: LABELS[key], count: s.entries.length, unread: unreadCount(s.entries) });
  }
  if (requestCount > 0 && !present.some((o) => o.key === "people")) {
    // People exists as a destination even with no primary DM rows, because the
    // requests row is rendered into it.
    present.unshift({ key: "people", label: LABELS.people, count: requestCount, unread: 0 });
  }
  if (present.length < 2) return [];
  const total = present.reduce((n, o) => n + o.count, 0);
  const totalUnread = present.reduce((n, o) => n + o.unread, 0);
  return [{ key: "all", label: LABELS.all, count: total, unread: totalUnread }, ...present];
}

/**
 * The filter to actually apply, given what is on offer right now.
 *
 * Guards against being stranded: filter to Communities, leave your last
 * community, and the chosen filter now selects nothing — while the chip you
 * would click to escape has disappeared along with it. Falling back to All
 * costs a filter nobody can see the effect of, and saves an empty page with no
 * way out.
 */
export function resolveChatFilter(filter: ChatFilter, options: ChatFilterOption[]): ChatFilter {
  return options.some((o) => o.key === filter) ? filter : "all";
}

export function applyChatFilter(sections: ChatSection[], filter: ChatFilter): ChatSection[] {
  if (filter === "all") return sections;
  return sections.filter((s) => FILTER_BY_TITLE[s.title] === filter);
}

/**
 * Communities never belong in Requests.
 *
 * `entries` is tab-scoped — in Requests it holds only DMs from outside your web
 * of trust, and `mergeChatEntries` drops groups outright — but joined
 * communities are handed to `sectionChatEntries` on a separate argument, so
 * they bypassed that scoping entirely and a COMMUNITIES heading rendered
 * underneath a list of strangers.
 *
 * Requests is a SAFETY slice, not a view of everything-minus-groups. Places you
 * have deliberately joined are the opposite of an unvouched stranger asking for
 * your attention, and listing them there both misdescribes them and buries the
 * requests you opened the screen to triage.
 */
export function communitiesForTab(dmTab: DmTab, communities: OutpostPreview[]): OutpostPreview[] {
  return dmTab === "requests" ? [] : communities;
}

export function sectionChatEntries(
  entries: ChatEntry[],
  joinedCommunities: OutpostPreview[] = [],
  /** Relay url → newest activity, for relays we genuinely heard back from. */
  activityByUrl: Map<string, number> = new Map(),
): ChatSection[] {
  const people = entries.filter((e) => e.kind === "dm");
  const backed = entries.filter(isCommunityEntry);
  const groups = entries.filter((e) => e.kind === "group" && !isCommunityEntry(e));
  const claimed = new Set(
    backed.map((e) => sameRelay((e as { group: GroupPreview }).group.relayUrl ?? "")),
  );
  const bare: ChatEntry[] = joinedCommunities
    .filter((o) => !claimed.has(sameRelay(o.url)))
    .map((outpost) => ({ kind: "outpost", outpost }));
  // Newest-first for everything whose activity we actually know; saved order
  // underneath for everything we do not. See orderCommunitiesByActivity.
  const communities = orderCommunitiesByActivity([...backed, ...bare], activityByUrl);
  const sections: ChatSection[] = [];
  if (people.length) sections.push({ title: "People", entries: people });
  if (groups.length) sections.push({ title: "Groups", entries: groups });
  if (communities.length) sections.push({ title: "Communities", entries: communities });
  return sections;
}
