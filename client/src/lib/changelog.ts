// In-app changelog ("What's New"). Newest first — add a new entry object to the
// TOP of CHANGELOG each release.
//
// OWNER, 2026-10-06: "we are giving too much away … condense in larger
// rollouts … only add what's of value, they don't need to know all the extra
// jazz." So:
//   - One entry per ROLLOUT (about a week), not per deploy. Fixes deploy
//     under the current version; the next rollout's entry sums them up.
//   - Up to 5 lines, each one short sentence of what people can now do or
//     will notice. Lead with the most valuable.
//   - Say what works now, never what was broken, how, or why. No vendor,
//     protocol or internal names, no tester quotes.
// changelog.test.ts holds every entry to this.

export type ChangeType = "new" | "improved" | "fixed";

export interface ChangelogFeedback {
  quote: string;
  attribution: string;
}

export interface ChangelogEntry {
  /** Semver release version, e.g. "1.6.0". The TOP entry's version IS the app's
   *  current version (see APP_VERSION) — so writing a release note is the bump.
   *  Convention: minor for feature releases, patch for fix/polish releases. */
  version: string;
  /** ISO date, e.g. "2026-06-18". Used for ordering + the "unseen" indicator. */
  date: string;
  /** Optional short headline for the release. */
  title?: string;
  changes: { type: ChangeType; text: string }[];
  /** Optional "community voice": short, representative beta/user feedback that
   *  motivated the release — the human reason behind the work. One quote, or a
   *  few for a broad release. Illustrative of real reports, not named endorsements. */
  feedback?: ChangelogFeedback | ChangelogFeedback[];
  /** Optional single call-to-action for the release (e.g. the open-source
   *  repo). Rendered as a real link, because change text is plain prose. */
  link?: { label: string; url: string };
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.19.0",
    date: "2026-10-11",
    title: "Calls that find you",
    changes: [
      { type: "new", text: "Calls ring now: \"Ana started a call in Bali crew\", with Join or Not now, and they can reach you even when the app is closed." },
      { type: "new", text: "Turn on notifications in Settings › Chats to hear about calls and new messages. They never say who wrote or what." },
      { type: "improved", text: "Call friends who use Armada: you all meet in the same call, and you are asked before another app's call service is used." },
      { type: "new", text: "Badges: design your own, give them to people who earned them, and choose which ones show on your profile." },
      { type: "improved", text: "Trust settings are simpler: three plain choices for how careful the app should be with people you don't know." },
    ],
  },
  {
    version: "1.18.0",
    date: "2026-10-06",
    title: "Smoother, quicker, more private",
    changes: [
      { type: "improved", text: "Scrolling on iPhone is smooth again: photos and videos stay put on long profiles, threads and feeds." },
      { type: "improved", text: "Private mode protects your chats from the moment you sign in, on any device." },
      { type: "improved", text: "Faster to open, quicker search, and your read chats and saved stories catch up across devices in a moment." },
      { type: "new", text: "Run your community from here: Relay Control with a setup checklist, one Inbox for your team, and an Ideas board for members." },
      { type: "improved", text: "Replies read like a conversation, the reply box is always at hand on a phone, and a half-written reply waits for you." },
    ],
  },
  {
    version: "1.15.0",
    date: "2026-10-02",
    title: "Private chats grew up",
    changes: [
      { type: "new", text: "Private chats for more than two people, with replies, reactions and search." },
      { type: "new", text: "Name, pin or mute any chat, or make its messages disappear. Your choices follow you to your other devices." },
      { type: "improved", text: "The feed has four plain tabs: For you, Following, Trending and Feeds, with one Filter button." },
      { type: "improved", text: "Messages kept on your device are stored encrypted, and requests from strangers list the most trusted first." },
    ],
  },
  {
    version: "1.13.0",
    date: "2026-10-01",
    title: "Notes in the margin, a shop on the profile",
    changes: [
      { type: "new", text: "On a wide screen, the post someone is answering sits in the margin beside their reply." },
      { type: "new", text: "Sellers get a Shop tab on their profile with their whole catalog." },
      { type: "improved", text: "Replies and their context load much faster on busy profiles." },
    ],
  },
  {
    version: "1.12.0",
    date: "2026-09-30",
    title: "Opens faster, stays put, talks to more apps",
    changes: [
      { type: "new", text: "Group chats with polls, pins, disappearing messages, photos, roles and invite links, working with other apps too." },
      { type: "new", text: "A first day that makes sense: a welcome, a safe home for your key, and real people to follow. Visitors can look around first." },
      { type: "improved", text: "The app opens instantly, updates itself at a quiet moment, and keeps your place when you come back." },
      { type: "improved", text: "A calmer News with a Listen lane for your shows, and a Discover front page drawn from trusted accounts." },
    ],
  },
  {
    version: "1.11.0",
    date: "2026-08-27",
    title: "Curated by the people who run the place",
    changes: [
      { type: "new", text: "Communities can curate Featured feeds of posts, articles, videos and streams from anyone on the network." },
      { type: "new", text: "Feature any post or person in two taps from its menu." },
      { type: "new", text: "Marketplace sellers show who in your circle vouches for them." },
      { type: "improved", text: "Streamers' profiles show past broadcasts, and podcast links play right in the conversation." },
    ],
  },
  {
    version: "1.10.0",
    date: "2026-08-27",
    title: "Open source, open market, open mic",
    link: { label: "Read the code on GitHub", url: "https://github.com/megistusXYZ/relay-outpost" },
    changes: [
      { type: "new", text: "Relay Outpost is open source under the MIT license: read it, check it, build on it." },
      { type: "new", text: "A marketplace of real things for sale. Buying happens with the seller, never through us." },
      { type: "new", text: "Live audio rooms open inside the app, and an endless video feed leads with what you haven't seen." },
      { type: "improved", text: "A simpler zap wallet, a deep black theme, and your posts no longer name the app you used unless you want them to." },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-08-15",
    title: "Your names for people, a home for Live",
    changes: [
      { type: "new", text: "Give anyone your own name and photo. Only you see it." },
      { type: "new", text: "Community pages with a banner, who runs it, and Join front and center." },
      { type: "new", text: "Live has its own page, and Discover shows what's new since your last visit." },
      { type: "new", text: "Hide your chats in one tap before you share your screen." },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-07-31",
    title: "Four places instead of eight",
    changes: [
      { type: "new", text: "Four places to go: Chats, Activity, Discover and You. Your feed lives in Discover." },
      { type: "new", text: "Communities you've joined sit in your Chats list with their real names and icons." },
      { type: "improved", text: "Profiles on a phone show who someone is, how to reach them, and the people who actually know them." },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-07-23",
    title: "Profiles that feel like someone's place",
    changes: [
      { type: "new", text: "Profiles open with what someone makes: their photos, videos and music." },
      { type: "improved", text: "Their circle shows the people you follow who follow them back." },
      { type: "improved", text: "Zap straight from a profile, and links to posts open into the post itself." },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-07-20",
    title: "Steadier media, a cleaner canvas",
    changes: [
      { type: "new", text: "Report a problem in a tap from the feedback menu." },
      { type: "improved", text: "Photos and videos keep a backup copy and recover by themselves." },
      { type: "improved", text: "A cleaner post layout, and shared links arrive as cards with a headline and image." },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-07-18",
    title: "A new menu, all your accounts, smarter news",
    changes: [
      { type: "new", text: "An all-new menu with the whole app laid out, live previews and search built in." },
      { type: "new", text: "Add several accounts and switch between them instantly." },
      { type: "new", text: "Find podcasts by category, trend and creator without leaving the app." },
      { type: "improved", text: "Alerts count what matters and group related updates together." },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-07-16",
    title: "Right where you left off",
    changes: [
      { type: "improved", text: "Back lands you exactly where you left off." },
      { type: "improved", text: "Open a reply to see the whole conversation it belongs to." },
      { type: "new", text: "Add events to your calendar and RSVP Going or Maybe." },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-07-13",
    title: "Chats in one place, a steadier feed",
    changes: [
      { type: "new", text: "Messages and group chats together in one Chats tab." },
      { type: "improved", text: "The feed holds still while you read: new posts wait behind a button." },
      { type: "improved", text: "Trust scores show everywhere automatically, and polls open into their full conversation." },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-07-02",
    title: "Smoother scrolling",
    changes: [
      { type: "improved", text: "Long feeds stay smooth however far you scroll, and busy channels keep up." },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-28",
    title: "Vouching and a real news reader",
    changes: [
      { type: "new", text: "Vouch for the people you trust, right on their profile." },
      { type: "new", text: "News is a real reader, and podcasts play like a podcast app: speed, skip and Up Next." },
      { type: "improved", text: "Choose Posts, Replies or All, and set your feed to Open, Balanced or Strict." },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-27",
    title: "Calmer light mode, trust filters",
    changes: [
      { type: "improved", text: "Light mode got a full refresh with one consistent look." },
      { type: "new", text: "Apply your trust filter to a whole community." },
      { type: "improved", text: "A simpler Trust & Safety page, and Messages in the bottom bar on phones." },
    ],
  },
  {
    version: "1.0.2",
    date: "2026-06-20",
    title: "Steadier messages",
    changes: [
      { type: "improved", text: "Private messages arrive more reliably, and your history is kept safe on your device." },
      { type: "improved", text: "Quicker to open on a phone." },
    ],
  },
  {
    version: "1.0.1",
    date: "2026-06-18",
    title: "Reliability and polish",
    changes: [
      { type: "improved", text: "Post, reply and vote with any sign-in method." },
      { type: "new", text: "Turn off feed ranking or trust checks anytime in Settings." },
      { type: "new", text: "This What's New page, so you can see what we ship." },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-06-11",
    title: "Public beta",
    changes: [
      { type: "new", text: "Chat rooms that feel like the chat apps you know." },
      { type: "improved", text: "Feeds for Latest, Trending, Most Zapped and Top Engaged." },
      { type: "improved", text: "A friendly welcome, with quick links to the FAQ, Terms and Privacy." },
    ],
  },
];

export const LATEST_CHANGELOG_DATE = CHANGELOG[0]?.date ?? "";

/** The app's current release version — the newest changelog entry's semver.
 *  This is the SINGLE SOURCE OF TRUTH for the human-facing version: adding a
 *  release note here bumps it everywhere it shows (Settings footer, the version
 *  row, crash tickets, the update check). No separate bump to remember. The
 *  precise build (git hash + timestamp) rides alongside it as APP_BUILD. */
export const APP_VERSION: string = CHANGELOG[0]?.version ?? "0.0.0";

const SEEN_KEY = "relay-outpost-changelog-seen";

/** True when there's a release newer than the last one the user viewed. */
export function hasUnseenChangelog(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY) ?? "";
    return LATEST_CHANGELOG_DATE > seen;
  } catch {
    return false;
  }
}

export function markChangelogSeen(): void {
  try { localStorage.setItem(SEEN_KEY, LATEST_CHANGELOG_DATE); } catch {}
}
