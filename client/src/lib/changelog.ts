// In-app changelog ("What's New"). Newest first — add a new entry object to the
// TOP of CHANGELOG each release.
//
// CURATION — this is user-facing communication, NOT a git log. Per line, ask:
// "would a user notice or care?"
//   ✅ Include: new features, meaningful improvements (faster / easier / now
//      works on mobile), and bugs users actually hit.
//   ❌ Leave out: refactors, dependency bumps, CI/build, type/test fixes, repo
//      hygiene, dev tooling, and internal perf with no visible effect.
// Write benefit-first ("Your DMs send instantly" — not "optimistic sendMessage"),
// merge many small commits into one clear bullet, keep it to ~5–8 lines per
// release, lead with the most impactful, and stay plain-spoken and honest.

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
    version: "1.10.0",
    date: "2026-08-27",
    title: "Open source, open market, open mic",
    link: { label: "Read the code on GitHub", url: "https://github.com/megistusXYZ/relay-outpost" },
    changes: [
      { type: "new", text: "Relay Outpost is open source. The entire app — everything in this list and everything before it — is now public code under the MIT license, for anyone to read, audit, fork, or build on. A client that touches your keys and your sats should be one you can check for yourself. Now you can." },
      { type: "new", text: "There's a marketplace. Real things for sale across the open network — coffee, art, electronics, thousands of listings — with search, categories in the sellers' own words, and every listing opening into photos, a price, and the actual person behind it. Your trust circle marks the sellers it vouches for right on the price tag, and buying happens with the seller or their marketplace — never through us." },
      { type: "new", text: "Live audio rooms open inside the app. When someone shares a Corny Chat space, it's a Join button now, not a link to somewhere else — tap it and you're listening; allow the mic and you're on stage." },
      { type: "new", text: "Videos became endless. The feed draws from the whole network's catalog — including the resurrected Vine archive — and always leads with what you haven't seen. Tap a creator's face to fall into their reel; when their videos run out it flows on into everyone else's. A small toggle above the actions swaps trending for newest." },
      { type: "improved", text: "Threads stopped losing replies. Some apps recently changed how replies are written under the hood; we read both dialects now, so a conversation shows everyone who actually spoke — and the post a reply answers loads reliably, because we ask the relay the reply came from instead of only the usual suspects." },
      { type: "improved", text: "The zap wallet speaks human: one number, one \"Send to my wallet\" button, plain words at every step — and you can send straight to a Lightning address like you@primal.net instead of hunting your wallet for an invoice. Sats you already collected are never counted as waiting again." },
      { type: "improved", text: "Three looks instead of two: light, dark, and a deeper black that suits OLED screens and late nights. Switching also settles contrast and performance to sensible defaults, so a theme is one decision, not three." },
      { type: "improved", text: "Your posts no longer advertise which app you used. The tiny \"posted with Relay Outpost\" tag is opt-in now — flip it on in Settings if you'd like to rep us; say nothing otherwise. A choice you already made, either way, still stands." },
      { type: "fixed", text: "Small things you'll feel: the video player's buttons stay out of the picture and fade while you watch, a creator's photos use your whole screen on desktop, and the Activity page's confusing \"couldn't reach relays\" line now says what it actually means — and nothing more." },
    ],
    feedback: [
      {
        quote: "Stoked to see NIP-99 listings — is there a way to add this to profile views? Can't find a way to display people's listings unless I find it in feed.",
        attribution: "Community member — the ask that became seller shelves on profiles",
      },
      {
        quote: "Message to all other nostr devs: Amethyst now replies to all kind 1s with NIP-22 comments instead of NIP-10.",
        attribution: "The migration we made sure wouldn't break your threads",
      },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-08-15",
    title: "Your names for people, a home for Live",
    changes: [
      { type: "new", text: "Rename anyone. Give a person your own name and photo — tap the pencil on their profile or long-press them in Chats — and that becomes who you see everywhere: their posts, your chats, their page. Their real name sits one tap away, and your names never leave your account. Nobody knows what you call them." },
      { type: "new", text: "A community page finally looks like somewhere you'd want to be: a banner, the community's face lifted over it, who runs it, \"Active today\", and Join front and center — the same treatment a person's profile gets, because a place deserves one too. The plumbing (moderation, policies, fees) stays tucked in About where it belongs." },
      { type: "new", text: "Live has a home again. The Live tile in Discover opens a real streams page — what's on now, what's coming, what you missed — and every stream has its own link you can send to anyone. Streams that already ended play their recording instead of spinning forever." },
      { type: "new", text: "Discover grew new doors — Podcasts, Events, Videos, Live, and what your network is talking about — and it greets you with what actually happened while you were away: tiles with something new wear a small \"+N new\" and a glow that fades once you've looked. The counts are real or they don't appear; nothing here ever pretends." },
      { type: "new", text: "An eye button in Chats blurs every name and message in one tap — for screen shares, coffee shops, and shoulder surfers. Tap again to come back. It hides things from a glance, not from the wire." },
      { type: "improved", text: "Browsing is for members now. Signed-out visitors get a welcome instead of your feeds, communities, and searches — while anything shared by link (a post, an article, an invite, a stream) still opens for the person it was sent to." },
      { type: "improved", text: "One back arrow per screen, everywhere. Twenty-odd pages had grown a second one; they're gone, and a shared link's back button now climbs somewhere sensible instead of dumping you in your messages." },
      { type: "fixed", text: "Reactions in community chats land on the first tap again, even when the app has been sitting in your pocket — the same nudge that kept messages reliable now covers the emoji." },
      { type: "fixed", text: "The \"Resembles …\" lookalike warning no longer accuses short names: someone called mar is not impersonating mark. Actual disguised clones — swapped alphabets, copied names — still get caught." },
      { type: "fixed", text: "Feeds with strict trust filters scroll on and on like they should, instead of stalling at a loader every few posts." },
    ],
    feedback: [
      {
        quote: "My ended stream won't play. Can you add support for ended streams with the recording tag from Rumble and YouTube so it can play the replay?",
        attribution: "Community member, in a thread",
      },
      {
        quote: "Should users be able to change profile pics and names of chats, groups and people — only showing for them, with a simple way to reveal the real name?",
        attribution: "The request that became renames",
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-07-31",
    title: "Four places instead of eight",
    changes: [
      { type: "new", text: "The app opens on your conversations now, and there are four places to go instead of eight: Chats, Activity, Discover, You. Your feed did not go anywhere — it lives in Discover, alongside your news — and a one-time note points at where everything moved. If you liked the old menu, one switch in Settings brings it back." },
      { type: "new", text: "The communities you have joined finally sit in your Chats list, under their own heading, wearing their real names and icons instead of a placeholder. They keep the order you set by dragging them on the Communities page, and \"Find a community\" is now one tap from the same list rather than something you had to go looking for." },
      { type: "improved", text: "Profiles on a phone now open the way they do on a desktop: who someone is, how to reach them, and the people who actually know them — mutual connections, which are far harder to fake than a follower count." },
      { type: "fixed", text: "Tapping someone's follower or following count does something. It had been plain text on every profile, so the obvious thing to press was the one thing that did nothing." },
      { type: "fixed", text: "A relay turning you away no longer takes the whole app down with it. Some communities only admit members, and being told \"no\" is an answer — it should not have been a crash." },
    ],
    feedback: {
      quote: "I am in a lot of communities and none of them showed up where I chat. I had to dig through a menu to reach a place I had already joined.",
      attribution: "Beta tester",
    },
  },
  {
    version: "1.7.0",
    date: "2026-07-23",
    title: "Profiles that feel like someone's place",
    changes: [
      { type: "new", text: "A profile feels like a place now, not a wall of text. A visit opens with what someone actually makes — their photos and videos in a row you can flip through like channels, a small player for their music — and a quiet line up top that tells you, at a glance, how long they've been here and what they tend to post about." },
      { type: "improved", text: "Their circle finally means something. It now shows the people you follow who follow them back — a real connection you share, not just names you both happen to follow. A day-old account can't borrow a crowd it hasn't earned." },
      { type: "improved", text: "Small things that add up: tap someone's Lightning address to zap them right there, and the links and details on a profile read clean and clickable instead of a tangle of raw text." },
      { type: "improved", text: "A link to a post now opens into the post itself — the words and the picture, right where you're reading — instead of a flat address to chase." },
      { type: "fixed", text: "Smoothed a couple of rough edges: a profile packed with videos no longer strains the browser into quitting, and the app opens cleanly again on iPhone right after an update." },
    ],
    feedback: {
      quote: "A brand-new account followed a stack of well-known people and suddenly looked established — that sat wrong with me.",
      attribution: "Beta tester",
    },
  },
  {
    version: "1.6.0",
    date: "2026-07-20",
    title: "Steadier media, a cleaner canvas, and a way to tell us when something breaks",
    changes: [
      { type: "new", text: "See something broken? Tell us in a tap. A “Report a problem” button now lives in the feedback menu, and — if you leave it on — the app can quietly send an anonymous note when it hits an error, so we can fix things before they pile up. It's never tied to you or your account, and you can switch it off in Settings anytime." },
      { type: "improved", text: "Your media just shows up. Photos and videos now carry a backup copy and heal themselves when a host goes down, so a post that used to load a broken box now loads the picture. There's also a one-tap “Sync my media” to mirror everything you've shared across servers." },
      { type: "improved", text: "The posts got a cleaner canvas. Share and Bookmark tuck into the ⋯ menu so the action row isn't crowded, the zap ₿ sits calmly in the corner, and the little menu on each comment stays out of the way until you reach for it — a thread reads as faces and words now, not a wall of icons." },
      { type: "improved", text: "Messages are honest about delivery. If the person you're writing to hasn't set up a private inbox — so your DM might not reach them — you'll get a gentle heads-up instead of wondering why it went quiet." },
      { type: "improved", text: "Share a link and it arrives as a proper card — headline, image, and source — instead of a bare URL." },
      { type: "improved", text: "A fresh launch moment: the app now opens on just the mark, focusing into view with a soft sweep of light. Small thing, but it sets the tone." },
      { type: "fixed", text: "Updates land more reliably on the installed app — when a new version ships you'll get a clear nudge to refresh, instead of being quietly stuck on yesterday's build." },
    ],
    feedback: [
      { quote: "I sent a photo to our group and my friend just saw a broken image icon.", attribution: "Beta tester" },
      { quote: "I kept hitting the same glitch but had no easy way to flag it.", attribution: "Beta tester" },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-07-18",
    title: "Our biggest release yet — a new menu, all your accounts & news that knows what matters",
    changes: [
      { type: "new", text: "The menu is all-new. Open it and the whole app is laid out in front of you — glowing rings light up wherever something's waiting, live cards preview your latest chat and the top headline, and search is built right in. “Jump back in” keeps your recent places one tap away." },
      { type: "new", text: "You can be more than one you. Add several accounts and hop between them straight from the menu, instantly — no signing out. Each account's keys stay separate and protected." },
      { type: "improved", text: "Alerts finally respect your attention. The unread counter scores what actually matters instead of counting everything, related updates arrive grouped (“Huberman Lab • New episode”), and you can switch to a digest or mute whole sources and keywords. News moved into the bottom bar, and a bell now lives up top — it glows when something's waiting for you." },
      { type: "improved", text: "News you can actually read here. We measured every source and swapped the tease-then-click-out wires for outlets that publish the whole story in the feed — ProPublica investigations, NASA's image-packed releases, Defector, 404 Media, The Intercept, Fortune and more. Full articles, real photos, no bouncing out to a website — and tapping the menu's top-headline tease now opens that exact story, not just the News page. The big wires are still one tap away if you want them." },
      { type: "new", text: "Finding your next podcast no longer means leaving the app. Browse official categories, see what's trending in each one, or start from picks led by creators you know — Rogan, Huberman, Lex, Acquired. Rich previews show episode lengths, and a ⚡ badge marks shows that take Lightning." },
      { type: "improved", text: "Encrypted group chats grew up. Sending images in encrypted rooms works now — including with friends on Amethyst and other apps, so cross-app encrypted communities are officially live. The chat list shows message previews (with a privacy toggle if you'd rather it didn't), timestamps are tidier, and everyone in a group gets their own name color." },
      { type: "improved", text: "And polish you'll feel everywhere: vertical videos now fill the whole display, Shorts-style; read something once and it's read on every device; any news story can carry its own portable discussion on Nostr, visible from other apps; videos mentioned in articles play right in the text; and you can save an event to your calendar without RSVPing." },
    ],
    feedback: [
      { quote: "I'd send a photo to our encrypted group and my friend on Amethyst just got a broken box.", attribution: "Beta tester" },
      { quote: "Forty unread and no clue which one was worth opening.", attribution: "Beta tester" },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-07-16",
    title: "Right where you left off — events, richer tools, and cross-app invites",
    changes: [
      { type: "fixed", text: "The back button lands you exactly where you left off — the same spot in the feed, with no shake and no reload — whether you swipe back or tap it." },
      { type: "improved", text: "Open a reply and you can now see the whole conversation it belongs to: the full chain up to the original post, each step showing its own replies and likes, so you never miss the bigger discussion." },
      { type: "new", text: "Event posts can go straight onto your calendar — Apple, Google, or a download — and you can RSVP with Going or Maybe and see how many are in. The cards are tidier too: one clean row of actions instead of buttons everywhere." },
      { type: "new", text: "A richer Tools page: recover your follow list from relays if it's ever wiped, see the vouches you've written next to the ones about you, manage your media servers and muted list, recalculate your trust network, and download an encrypted backup of your key. Anything that changes something now asks first." },
      { type: "improved", text: "Editing your profile is its own focused screen — a live preview of how you look to others as you type, a quick check that your verified name and Lightning address actually work, and a Save bar that only appears once you've changed something. Group chats now share one name and a stack of member faces for everyone in them, and trust levels are told apart by shape, not just color — a calm amber dot, a hollow ring, a clear red flag — so they read for everyone." },
      { type: "fixed", text: "Your DMs stay in Chats and out of Alerts, searching events no longer blanks the page when you're signed in, and group-chat invites you send now open correctly in other Nostr apps like Amethyst." },
    ],
    feedback: [
      { quote: "When I hit back it put me in the right place, but the feed shook and kept loading.", attribution: "Beta tester" },
      { quote: "Your group invites wouldn't load in our app — you were sending the wrong invite type.", attribution: "A fellow Nostr client" },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-07-13",
    title: "Chats in one place, and a steadier feed",
    changes: [
      { type: "new", text: "Direct messages and group chats now live together in one Chats tab — one list, one unread count. Starting a group chat is right there under the + button." },
      { type: "improved", text: "The feed holds still while you read. New posts wait behind a “new posts” button instead of pushing everything down, and the back button returns you to exactly where you left off." },
      { type: "improved", text: "Community spaces got a cleaner name, simpler pages, and a fresh icon." },
      { type: "improved", text: "Trust scores now show up for everyone in feeds and threads automatically — no more blank “no data” until you'd visited someone's profile." },
      { type: "new", text: "You can share a calendar event into your feed as a proper card, and pinned events now show more detail and load instantly." },
      { type: "improved", text: "Polls are easier to explore — tap one to open its full conversation, and sort by trending, latest, or ending soon." },
      { type: "improved", text: "In the media viewer, swipe up and down to move between photos and videos, and the sound toggle now works properly on phones." },
      { type: "improved", text: "Your font and text-size choices now apply everywhere and stay put, with a hand-picked set of fonts to choose from." },
    ],
  },
  {
    version: "1.2.1",
    date: "2026-07-02",
    title: "Smoother scrolling, a lighter app",
    changes: [
      { type: "improved", text: "Long feeds stay smooth no matter how far you scroll. We now only keep what's on screen loaded, so scrolling doesn't get heavier the further you go — a real difference on phones and older devices." },
      { type: "improved", text: "The whole app feels lighter — posts, reactions, and fast-moving channels do a lot less work behind the scenes, so things stay responsive when there's a lot going on." },
    ],
    feedback: [
      { quote: "After scrolling for a while the feed got choppy and my phone started to chug.", attribution: "Beta tester" },
      { quote: "Busy channels felt laggy when messages were flying in.", attribution: "Beta tester" },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-28",
    title: "Vouching, a real news reader & a lot of mobile love",
    changes: [
      { type: "new", text: "Vouch for the people you trust. Profiles now have Trust Reviews — write a short, public vouch for someone (a general endorsement, or “I personally know this is really them”). You'll see who's vouched, ranked by your own Web of Trust, and the person can publicly reply. Bad-faith ones can be reported or muted. It lives in a new Trust tab under Network. Think Google reviews, but for people — and weighted by who you actually trust." },
      { type: "new", text: "News is a real reader now. One search box finds podcasts (millions of them), blogs, or any feed you paste; articles track read/unread with a “Mark all read”; every source shows its icon and you can filter to just one; and new accounts start with a tighter, hand-picked set of feeds instead of a firehose." },
      { type: "new", text: "Podcasts play like a proper podcast app — speed (0.8×–2×), 15 / 30-second skip, and an Up Next queue you can add to, play next, and reorder, right from the player." },
      { type: "improved", text: "A clearer feed. Pick Posts, Replies, or All (we default to Posts, so it isn't wall-to-wall replies), and set how strict your feed is with one simple choice — Open, Balanced, or Strict — with the fine-grained trust controls tucked under Customize." },
      { type: "improved", text: "Invites finally work both ways. If you invite someone who's already here, they get a one-tap “Follow back?” prompt and a quick way to say hi — so you actually find out they joined. New folks land already following a small, friendly starter set." },
      { type: "improved", text: "Videos go full-screen, Shorts/X-style — edge-to-edge, no more buttons stacked on buttons, with an instant preview frame and the next clip pre-loaded so it doesn't make you wait." },
      { type: "improved", text: "On your phone, Articles open in a clean list by default (with a comfortable/compact toggle), and there's a dedicated Tools page — Wallet, Relays, Bookmarks, Analytics, Console, Flight Log — one tap from the menu." },
      { type: "fixed", text: "Light mode, fixed where it counted: your own chat and DM bubbles were dark-on-purple and nearly unreadable — now they're crisp. And when you @mention someone while writing a post, you can see what you're typing again." },
      { type: "fixed", text: "Profiles now actually show a person's relays (it used to always say “none”), the video player no longer double-stacks its controls, and Outpost headers are tidier — we dropped some confusing counts and hid an operator-only toggle from everyone else." },
    ],
    feedback: [
      { quote: "When someone vouched for a user it just showed a blob of raw code — I couldn't tell who said it or what they meant.", attribution: "Beta tester" },
      { quote: "The videos had buttons stacked on buttons — can it just be full-screen like Shorts?", attribution: "Beta tester" },
      { quote: "In light mode I literally couldn't read my own messages.", attribution: "Beta tester" },
      { quote: "We've been living in the app on our own phones — most of this came straight from that.", attribution: "The team" },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-27",
    title: "Calmer light mode, trust filters & mobile polish",
    changes: [
      { type: "improved", text: "Light mode got a full refresh. Everything now draws from one consistent color system, so text, buttons, filters, and toggles look calm and on-brand instead of a mix of washed-out blues and purples." },
      { type: "new", text: "You can now apply your Web-of-Trust filter to a whole Outpost — Posts, Discussions, Chat, and Articles at once — so you mostly see people your network vouches for. In Chat, filtered messages collapse into a “tap to show” note instead of quietly disappearing." },
      { type: "improved", text: "The Trust & Safety page is far easier to understand: one plain “How strict is your feed?” choice — Open, Balanced, or Strict — up front, with all the advanced trust controls tucked under Advanced." },
      { type: "improved", text: "On phones, Messages now has its own spot in the bottom bar with an unread count, so your DMs are always one tap away. Search moved to the top of the screen." },
      { type: "improved", text: "We renamed a few things in plain English so they're easier to follow — nothing moved, just clearer labels. An Outpost's tabs are now Posts, Discussions, Chat, and Articles; the home feed views are For You, Following, and Trending; your saved feeds live under “Saved”; and your dashboard is now “Account.”" },
      { type: "fixed", text: "Your profile picture now shows when you write a post, and the relay picker (“Manage”) opens where your post will go instead of dropping you on a page that made no sense." },
      { type: "fixed", text: "On mobile, tapping a link in the side menu now closes the menu and takes you straight to the page." },
      { type: "fixed", text: "Opening a members-only Outpost you're not part of now tells you so clearly, instead of spinning on “Authenticating…” forever." },
    ],
    feedback: [
      { quote: "In light mode the colors looked washed out and off-brand.", attribution: "Beta tester" },
      { quote: "My profile picture didn't show up when I went to write a post.", attribution: "Beta tester" },
      { quote: "On my phone, tapping a link in the menu left the menu covering the page.", attribution: "Beta tester" },
    ],
  },
  {
    version: "1.0.2",
    date: "2026-06-20",
    title: "Steadier DMs + mobile fixes",
    changes: [
      { type: "improved", text: "Direct messages now come through much more reliably when you — or the person writing to you — use a privacy-focused relay (the kind that only releases messages to their owner), which used to drop them silently. We're still hardening this, so tell us if one goes missing." },
      { type: "improved", text: "Your message history is sturdier — we ask your device not to clear it when storage runs low, so conversations are far less likely to disappear." },
      { type: "improved", text: "Command Post and Messages open noticeably faster when you launch the app on your phone." },
      { type: "fixed", text: "The mobile menu opens much more smoothly — no more flicker." },
      { type: "improved", text: "The mobile music & voice player is much steadier when you open it." },
    ],
    feedback: {
      quote: "Messages I sent from another app weren't reaching my friends here — but the other direction worked fine.",
      attribution: "Beta tester",
    },
  },
  {
    version: "1.0.1",
    date: "2026-06-18",
    title: "Reliability & polish",
    feedback: {
      quote: "I signed in with my private key and couldn't reply or vote — it only worked with the extension.",
      attribution: "Beta tester",
    },
    changes: [
      { type: "fixed", text: "Posting, replying, voting, and channel messages now work across more sign-in methods, not just browser extensions." },
      { type: "improved", text: "Channel invites and private invite DMs now send much more reliably." },
      { type: "improved", text: "Direct messages are better at reconnecting after the app has been idle, and the composer grows as you type so you can see everything you write." },
      { type: "improved", text: "Live people suggestions appear as you type in search." },
      { type: "improved", text: "Command Post is tidier — Articles now live under Media (Images · Videos · Articles · Audio)." },
      { type: "new", text: "Turn off feed ranking, engagement scores, or trust checks anytime in Settings → Feed & content." },
      { type: "improved", text: "Wallet, Edit profile, and the new Control panel are reachable straight from the account menu; Settings gained a quick jump-to on mobile." },
      { type: "fixed", text: "Your light/dark choice no longer flips on load." },
      { type: "new", text: "This “What's New” page, so you can see what we ship." },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-06-11",
    title: "Public beta",
    feedback: {
      quote: "Would love group chats like Discord, but on Nostr.",
      attribution: "Community request",
    },
    changes: [
      { type: "new", text: "Native channel rooms with a Discord/Signal-style chat experience." },
      { type: "improved", text: "Feeds rank more accurately across Latest, Trending, Most Zapped, and Top Engaged." },
      { type: "improved", text: "A friendly welcome brief explaining the beta, with quick links to the FAQ, Terms, and Privacy." },
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
