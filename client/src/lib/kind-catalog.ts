/**
 * Every event kind the app knows, with its NIP — one list for the query
 * console, the Content filter and anywhere a kind needs a name. Searchable by
 * number, name, NIP, or the everyday word ("like", "thanks", "DM").
 */
export interface KindInfo { kind: number; label: string; nip?: string }

export const KIND_CATALOG: ReadonlyArray<KindInfo> = [
  { kind: 0, label: "User Metadata", nip: "NIP-01" },
  { kind: 1, label: "Short Text Note", nip: "NIP-10" },
  { kind: 2, label: "Recommend Relay (deprecated)", nip: "NIP-01" },
  { kind: 3, label: "Follows", nip: "NIP-02" },
  { kind: 4, label: "Encrypted Direct Messages", nip: "NIP-04" },
  { kind: 5, label: "Event Deletion Request", nip: "NIP-09" },
  { kind: 6, label: "Repost", nip: "NIP-18" },
  { kind: 7, label: "Reaction", nip: "NIP-25" },
  { kind: 8, label: "Badge Award", nip: "NIP-58" },
  { kind: 9, label: "Chat Message", nip: "NIP-C7" },
  { kind: 10, label: "Group Chat Threaded Reply (deprecated)", nip: "NIP-29" },
  { kind: 11, label: "Thread", nip: "NIP-7D" },
  { kind: 12, label: "Group Thread Reply (deprecated)", nip: "NIP-29" },
  { kind: 13, label: "Seal", nip: "NIP-59" },
  { kind: 14, label: "Direct Message", nip: "NIP-17" },
  { kind: 15, label: "File Message", nip: "NIP-17" },
  { kind: 16, label: "Generic Repost", nip: "NIP-18" },
  { kind: 17, label: "Reaction to a Website", nip: "NIP-25" },
  { kind: 20, label: "Picture", nip: "NIP-68" },
  { kind: 21, label: "Video Event", nip: "NIP-71" },
  { kind: 22, label: "Short-form Portrait Video", nip: "NIP-71" },
  { kind: 24, label: "Public Message", nip: "NIP-A4" },
  { kind: 40, label: "Channel Creation", nip: "NIP-28" },
  { kind: 41, label: "Channel Metadata", nip: "NIP-28" },
  { kind: 42, label: "Channel Message", nip: "NIP-28" },
  { kind: 43, label: "Channel Hide Message", nip: "NIP-28" },
  { kind: 44, label: "Channel Mute User", nip: "NIP-28" },
  { kind: 62, label: "Request to Vanish", nip: "NIP-62" },
  { kind: 64, label: "Chess (PGN)", nip: "NIP-64" },
  { kind: 818, label: "Merge Requests", nip: "NIP-54" },
  { kind: 1018, label: "Poll Response", nip: "NIP-88" },
  { kind: 1021, label: "Bid", nip: "NIP-15" },
  { kind: 1022, label: "Bid Confirmation", nip: "NIP-15" },
  { kind: 1040, label: "OpenTimestamps", nip: "NIP-03" },
  { kind: 1059, label: "Gift Wrap", nip: "NIP-59" },
  { kind: 1063, label: "File Metadata", nip: "NIP-94" },
  { kind: 1068, label: "Poll", nip: "NIP-88" },
  { kind: 1111, label: "Comment", nip: "NIP-22" },
  { kind: 1222, label: "Voice Message", nip: "NIP-A0" },
  { kind: 1311, label: "Live Chat Message", nip: "NIP-53" },
  { kind: 1337, label: "Code Snippet", nip: "NIP-C0" },
  { kind: 1617, label: "Patches", nip: "NIP-34" },
  { kind: 1618, label: "Pull Requests", nip: "NIP-34" },
  { kind: 1619, label: "Pull Request Updates", nip: "NIP-34" },
  { kind: 1621, label: "Issues", nip: "NIP-34" },
  { kind: 1984, label: "Reporting", nip: "NIP-56" },
  { kind: 1985, label: "Label", nip: "NIP-32" },
  { kind: 2003, label: "Torrent", nip: "NIP-35" },
  { kind: 2004, label: "Torrent Comment", nip: "NIP-35" },
  { kind: 4550, label: "Community Post Approval", nip: "NIP-72" },
  { kind: 5000, label: "Job Request (range 5000-5999)", nip: "NIP-90" },
  { kind: 6000, label: "Job Result (range 6000-6999)", nip: "NIP-90" },
  { kind: 7000, label: "Job Feedback", nip: "NIP-90" },
  { kind: 7375, label: "Cashu Wallet Tokens", nip: "NIP-60" },
  { kind: 7376, label: "Cashu Wallet History", nip: "NIP-60" },
  { kind: 9041, label: "Zap Goal", nip: "NIP-75" },
  { kind: 9321, label: "Nutzap", nip: "NIP-61" },
  { kind: 9734, label: "Zap Request", nip: "NIP-57" },
  { kind: 9735, label: "Zap", nip: "NIP-57" },
  { kind: 9802, label: "Highlights", nip: "NIP-84" },
  { kind: 10000, label: "Mute List", nip: "NIP-51" },
  { kind: 10001, label: "Pin List", nip: "NIP-51" },
  { kind: 10002, label: "Relay List Metadata", nip: "NIP-65" },
  { kind: 10003, label: "Bookmark List", nip: "NIP-51" },
  { kind: 10004, label: "Communities List", nip: "NIP-51" },
  { kind: 10005, label: "Public Chats List", nip: "NIP-51" },
  { kind: 10006, label: "Blocked Relays List", nip: "NIP-51" },
  { kind: 10007, label: "Search Relays List", nip: "NIP-51" },
  { kind: 10009, label: "User Groups", nip: "NIP-51" },
  { kind: 10015, label: "Interests List", nip: "NIP-51" },
  { kind: 10019, label: "Nutzap Mint Recommendation", nip: "NIP-61" },
  { kind: 10030, label: "User Emoji List", nip: "NIP-51" },
  { kind: 10050, label: "Relay List to Receive DMs", nip: "NIP-17" },
  { kind: 10063, label: "User Server List (Blossom)" },
  { kind: 10096, label: "File Storage Server List (deprecated)", nip: "NIP-96" },
  { kind: 10166, label: "Relay Monitor Announcement", nip: "NIP-66" },
  { kind: 13194, label: "Wallet Info", nip: "NIP-47" },
  { kind: 22242, label: "Client Authentication", nip: "NIP-42" },
  { kind: 23194, label: "Wallet Request", nip: "NIP-47" },
  { kind: 23195, label: "Wallet Response", nip: "NIP-47" },
  { kind: 24133, label: "Nostr Connect", nip: "NIP-46" },
  { kind: 27235, label: "HTTP Auth", nip: "NIP-98" },
  { kind: 30000, label: "Follow Sets", nip: "NIP-51" },
  { kind: 30001, label: "Bookmark Sets", nip: "NIP-51" },
  { kind: 30002, label: "Relay Sets", nip: "NIP-51" },
  { kind: 30003, label: "Bookmark Sets (alt)", nip: "NIP-51" },
  { kind: 30004, label: "Curation Sets", nip: "NIP-51" },
  { kind: 30008, label: "Profile Badges", nip: "NIP-58" },
  { kind: 30009, label: "Badge Definition", nip: "NIP-58" },
  { kind: 30017, label: "Stall", nip: "NIP-15" },
  { kind: 30018, label: "Product", nip: "NIP-15" },
  { kind: 30023, label: "Long-form Content", nip: "NIP-23" },
  { kind: 30024, label: "Draft Long-form Content", nip: "NIP-23" },
  { kind: 30030, label: "Emoji Sets", nip: "NIP-30" },
  { kind: 30063, label: "Release Artifact Sets", nip: "NIP-51" },
  { kind: 30078, label: "App-specific Data", nip: "NIP-78" },
  { kind: 30311, label: "Live Event", nip: "NIP-53" },
  { kind: 30315, label: "User Status", nip: "NIP-38" },
  { kind: 30382, label: "Classified Listing", nip: "NIP-99" },
  { kind: 30402, label: "Draft Classified Listing", nip: "NIP-99" },
  { kind: 30617, label: "Repository Announcement", nip: "NIP-34" },
  { kind: 30618, label: "Repository State", nip: "NIP-34" },
  { kind: 30818, label: "Wiki Article", nip: "NIP-54" },
  { kind: 30819, label: "Redirects", nip: "NIP-54" },
  { kind: 31337, label: "Zapstr Track" },
  { kind: 31922, label: "Date-based Calendar Event", nip: "NIP-52" },
  { kind: 31923, label: "Time-based Calendar Event", nip: "NIP-52" },
  { kind: 31924, label: "Calendar", nip: "NIP-52" },
  { kind: 31925, label: "Calendar Event RSVP", nip: "NIP-52" },
  { kind: 31989, label: "Handler Recommendation", nip: "NIP-89" },
  { kind: 31990, label: "Handler Information", nip: "NIP-89" },
  { kind: 32123, label: "Wavlake NOM" },
  { kind: 34235, label: "Video Event", nip: "NIP-71" },
  { kind: 34236, label: "Short-form Portrait Video", nip: "NIP-71" },
  { kind: 34237, label: "Video View", nip: "NIP-71" },
  { kind: 34550, label: "Community Definition", nip: "NIP-72" },
];

/** Everyday words → kinds, for people who don't know the numbers. */
const ALIASES: Array<[RegExp, number[]]> = [
  [/^(like|likes|reaction|reactions|emoji)$/, [7]],
  [/^(thanks|zap|zaps|tip|tips)$/, [9735, 9734]],
  [/^(dm|dms|message|messages|private)$/, [14, 1059, 4]],
  [/^(post|posts|note|notes)$/, [1]],
  [/^(article|articles|blog|long[- ]?form)$/, [30023]],
  [/^(photo|photos|picture|pictures|image|images)$/, [20]],
  [/^(video|videos)$/, [21, 22, 34235, 34236]],
  [/^(profile|profiles|metadata)$/, [0]],
  [/^(repost|reposts|boost|boosts)$/, [6, 16]],
  [/^(comment|comments|reply|replies)$/, [1111, 1]],
  [/^(report|reports|flag|flags)$/, [1984]],
  [/^(delete|deletion|deletions)$/, [5]],
  [/^(follow|follows|contacts)$/, [3]],
  [/^(live ?chat|stream chat)$/, [1311]],
  [/^(live|stream|streams)$/, [30311, 1311]],
  [/^(relay ?list|relays)$/, [10002]],
];

const BY_KIND = new Map(KIND_CATALOG.map((k) => [k.kind, k]));

/** The everyday name for the kinds people meet; the catalogue's name for the rest. */
const PLAIN: Record<number, string> = {
  0: "Profile", 1: "Note", 3: "Follow list", 4: "Old-style DM", 5: "Deletion", 6: "Repost", 7: "Reaction",
  14: "Private message", 16: "Repost", 20: "Picture", 21: "Video", 22: "Short video", 1059: "Sealed message",
  1111: "Comment", 1311: "Live chat", 1984: "Report", 9734: "Thanks request", 9735: "Thanks", 10000: "Mute list",
  10002: "Relay list", 30023: "Article", 30311: "Live stream",
};

export function plainKindName(kind: number): string {
  return PLAIN[kind] ?? kindName(kind);
}

export function kindName(kind: number): string {
  return BY_KIND.get(kind)?.label ?? `Kind ${kind}`;
}

export function findKinds(query: string, limit = 12): KindInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const exact = BY_KIND.get(n) ?? { kind: n, label: `Kind ${n}` };
    const prefix = KIND_CATALOG.filter((k) => k.kind !== n && String(k.kind).startsWith(q));
    return [exact, ...prefix].slice(0, limit);
  }
  const nip = /^nip[\s-]?([0-9a-z]{1,3})$/.exec(q);
  if (nip) {
    const want = `nip-${nip[1].padStart(2, "0")}`;
    return KIND_CATALOG.filter((k) => k.nip?.toLowerCase() === want).slice(0, limit);
  }
  const out: KindInfo[] = [];
  const add = (k?: KindInfo) => { if (k && !out.some((x) => x.kind === k.kind)) out.push(k); };
  for (const [re, kinds] of ALIASES) if (re.test(q)) kinds.forEach((n) => add(BY_KIND.get(n)));
  for (const k of KIND_CATALOG) if (k.label.toLowerCase().includes(q)) add(k);
  return out.slice(0, limit);
}
