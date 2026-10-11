/**
 * The quick tours (owner, 2026-10-10): one per page, replayed from Help &
 * Guides, in the order a new account meets the app — Chats first, since
 * that is where it lands. Words for people, not operators: no missions,
 * no orientation, no plumbing.
 *
 * A step with a `testId` points at a control on the page; a step the page
 * can't show (the control isn't there) is dropped, so a tour never promises
 * a count it can't keep — the intro's "{steps}" is filled with the steps
 * that will play. lib/tours.test.ts checks every anchor exists in the app.
 */
export interface TourStep {
  /** The control this step points at, or null for a step about the page itself. */
  testId: string | null;
  title: string;
  /** "**Name**" renders bold; "{steps}" becomes the number of steps that play. */
  body: string;
}

export interface Tour {
  label: string;
  path: string;
  steps: TourStep[];
}

export const TOUR_ORDER = ["chats", "home", "communities", "account", "trust", "wallet", "articles", "live"] as const;
export type TourId = (typeof TOUR_ORDER)[number];

export const TOURS: Record<TourId, Tour> = {
  chats: {
    label: "Chats",
    path: "/messages",
    steps: [
      { testId: null, title: "Your chats", body: "A quick tour, {steps} short steps. Private messages and your communities' group chats live here, in one list. Everything is end-to-end encrypted: only the people in a chat can read it." },
      { testId: "button-new-chat", title: "Start one", body: "**New** starts a private message or a group chat. Invites you receive appear at the top of this list." },
      { testId: null, title: "Honest about what it knows", body: "While the app asks your relays for new messages it says **Checking for messages…** and, if it can't reach them, it says so, instead of pretending the list is empty." },
    ],
  },
  home: {
    label: "Home feed",
    path: "/",
    steps: [
      { testId: null, title: "Your space", body: "A quick tour, {steps} short steps. The feed is posts from the people you follow and your communities. The wider network stays off until you turn it on, in Settings › Your space." },
      { testId: null, title: "Following, For you, Trending", body: "The tabs up top. **Following** is just your people. **For you** and **Trending** open up once the wider network is on." },
      { testId: "button-fab-compose", title: "New post", body: "The round **New post** button at the bottom right. Photos, hashtags and mentions all work." },
      { testId: "mobile-nav-create", title: "New post", body: "The **centre button** in the bottom bar. Photos, hashtags and mentions all work." },
    ],
  },
  communities: {
    label: "Communities",
    path: "/outposts",
    steps: [
      { testId: null, title: "Your communities", body: "A quick tour, {steps} short steps. A community is a private place for your people: group chats with rooms, end-to-end encrypted. You pick who's in it." },
      { testId: null, title: "Name your community", body: "Make one in a minute from **Welcome** or your **Account** page, then send the invite link. Only people with the link can join." },
      { testId: "wider-network-door-communities", title: "The wider network", body: "Public communities from across the network appear here once you turn the wider network on. Until then, this page is your space." },
    ],
  },
  account: {
    label: "Your account",
    path: "/account/menu",
    steps: [
      { testId: null, title: "Your account", body: "A quick tour, {steps} short steps. Everything about you and this app, in one list." },
      { testId: "account-key-backup", title: "Save your key", body: "Your key is the only way back into this account on another phone or computer. Save the file, then **Check it works**." },
      { testId: "account-trust-safety", title: "Trust & safety", body: "How careful the app is with people you don't know: **Careful**, **Balanced** or **See everything**." },
      { testId: "account-theme", title: "Theme", body: "Light, dark or black. The theme has one home, in Settings; this row opens it." },
      { testId: "account-settings", title: "App settings", body: "Your space, calls, notifications and the rest." },
    ],
  },
  trust: {
    label: "Trust & safety",
    path: "/account?tab=shield",
    steps: [
      { testId: null, title: "Trust & safety", body: "A quick tour, {steps} short steps. The app ranks people by how close they are to the people you already trust, so strangers' posts and pictures don't reach you first." },
      { testId: "trust-choice", title: "How careful", body: "Pick **Careful**, **Balanced** or **See everything**. New accounts start on Balanced; the first time you open the wider network it goes to Careful." },
      { testId: null, title: "Mutes and reports", body: "Below: the people you've muted, the words you've blocked, and the reports you've sent." },
    ],
  },
  wallet: {
    label: "Wallet",
    path: "/account?tab=wallet",
    steps: [
      { testId: null, title: "Zaps and your wallet", body: "A quick tour, {steps} short steps. Zaps are optional tips in bitcoin, sent straight to the person. Relay Outpost never holds money: your own wallet does, and you approve every payment." },
      { testId: "card-wallet-connect", title: "Connect a wallet", body: "The **Connect Wallet** card takes a connection link from a wallet app such as Alby, Coinos, Zeus or LNbits. Your money stays in that wallet." },
      { testId: "card-wallet-balance", title: "Your balance", body: "Once connected, your **balance and recent activity** show at the top. The eye icon hides them." },
      { testId: "tab-wallet-send", title: "Send", body: "The **Send** tab pays an address, an invoice or a QR code." },
      { testId: "tab-wallet-receive", title: "Receive", body: "The **Receive** tab makes an invoice or shares your address. Tips people send you land here." },
    ],
  },
  articles: {
    label: "Articles",
    path: "/search?tab=media&type=articles",
    steps: [
      { testId: null, title: "Articles", body: "A quick tour, {steps} short steps. Articles are full-length posts, published under the writer's name, that travel with them to any app." },
      { testId: "wider-network-door-search", title: "The wider network is off", body: "Articles come from across the network. Turn the wider network on to read them; until then, this is your space." },
      { testId: "articles-tab-switcher", title: "Trending, Latest, Following", body: "**Trending** is what's gaining readers, **Latest** is everything newest first, **Following** is people you follow." },
      { testId: "button-topics-dropdown", title: "Topics", body: "**Topics** narrows the list by subject; the search bar finds writers and titles." },
      { testId: "button-write-article", title: "Write your own", body: "**Write** publishes an article under your name. It stays yours wherever you take it." },
    ],
  },
  live: {
    label: "Live",
    path: "/search?tab=live",
    steps: [
      { testId: null, title: "Live", body: "A quick tour, {steps} short steps. Live video from people across the network, happening now and scheduled for later." },
      { testId: "wider-network-door-search", title: "The wider network is off", body: "Live video comes from across the network. Turn the wider network on to watch; until then, this is your space." },
      { testId: "container-live-results", title: "What's on", body: "Each card is a stream. Tap one to watch, join the chat, and tip the host if you like." },
    ],
  },
};

/** The steps a page can play: every step about the page itself, and every step whose control is there. */
export function playableSteps(steps: TourStep[], present: (testId: string) => boolean): TourStep[] {
  return steps.filter((s) => s.testId === null || present(s.testId));
}

/** "{steps}" in a body becomes the number of steps that play, so a tour never promises more than it shows. */
export function fillStepCount(body: string, count: number): string {
  return body.replace(/\{steps\}/g, String(count));
}

export function stepCounter(index: number, count: number): string {
  return `Step ${index + 1} of ${count}`;
}

/** The next tour after `id` that hasn't been seen, in TOUR_ORDER; null when they've all been seen. */
export function nextTour(id: string, seen: (tourId: string) => boolean): TourId | null {
  for (const t of TOUR_ORDER) {
    if (t === id || seen(t)) continue;
    return t;
  }
  return null;
}

export function toursDone(id: string, seen: (tourId: string) => boolean): number {
  return TOUR_ORDER.filter((t) => t === id || seen(t)).length;
}
