/**
 * The pages a signed-out visitor can read, and what each says about itself:
 * its title and a description. One table for the server (what a search engine
 * or a link preview is told, and the sitemap: server/page-meta.ts) and for the
 * app (the browser tab's title), so the title a crawler is served is the title
 * the page then shows.
 *
 * A page is here only if a visitor sees its own content. The signed-out Live,
 * Images, Videos and Audio addresses show the landing, so they are not.
 */

/** The one address the site is known by: canonical links, the sitemap and share images all use it. */
export const SITE_ORIGIN = "https://relayop.xyz";
export const SITE_NAME = "Relay Outpost";
/** The share image for every page that has no picture of its own (client/public/og-image.png). */
export const SHARE_IMAGE = { path: "/og-image.png", width: 1200, height: 630, alt: "Relay Outpost: the next phase of the internet" } as const;

export interface PageMeta {
  /** The whole <title>, at most about 60 characters. */
  title: string;
  /** One or two plain sentences, at most about 155 characters. */
  description: string;
  /** How often the page changes and how much it matters, for the sitemap. */
  changefreq: "daily" | "weekly" | "monthly";
  priority: string;
}

const page = (title: string, description: string, changefreq: PageMeta["changefreq"], priority: string): PageMeta => ({ title, description, changefreq, priority });
const named = (name: string) => `${name} | ${SITE_NAME}`;

export const PUBLIC_PAGES: Readonly<Record<string, PageMeta>> = {
  "/": page(
    "Relay Outpost: the next phase of the internet",
    "Post, chat, go live and bring your people together, all in one place that belongs to you. Free and open source. No email or phone number.",
    "daily", "1.0",
  ),
  "/discover": page(named("Discover"), "A look at what is on Relay Outpost right now: news, articles and communities, open to read without an account.", "daily", "0.8"),
  "/articles": page(named("Articles"), "Long-form writing published on the open network: essays, guides and stories you can read without an account.", "daily", "0.7"),
  "/outposts": page(named("Communities"), "Find a community to join or start your own: public spaces, and private ones that are end-to-end encrypted.", "weekly", "0.7"),
  "/whats-new": page(named("What's new"), "What changed in each release of Relay Outpost, in plain words.", "weekly", "0.6"),
  "/help": page(named("Help and guides"), "Plain guides to Relay Outpost: your first ten minutes, your key, private messages, communities, and why it works the way it does.", "weekly", "0.7"),
  "/help/first-10-minutes": page(named("Your first 10 minutes"), "Sign in, set up your profile, follow people and make your first post: your first ten minutes, step by step.", "monthly", "0.5"),
  "/help/setting-up-outpost": page(named("Setting up your community"), "Find and join your first community, post to it, and set up one of your own if you want to.", "monthly", "0.5"),
  "/help/connecting-wallet": page(named("Connecting a Lightning wallet"), "Choose a Lightning wallet and connect it, so you can send and receive tips. Your money stays in your own wallet.", "monthly", "0.5"),
  "/help/content-calendar": page(named("Using the content calendar"), "Find and follow events, RSVP, set reminders and create your own: a guide to the calendar.", "monthly", "0.5"),
  "/help/encrypted-messages": page(named("Encrypted direct messages"), "How private messages work on Relay Outpost: what is encrypted, who can read it, and what that means for you.", "monthly", "0.5"),
  "/help/publishing-privacy": page(named("Publishing and privacy"), "What is public when you post, what is removed from your photos automatically, and how to choose who each post reaches.", "monthly", "0.5"),
  "/help/managing-crew": page(named("Your people"), "Following, your contact list and the people you trust: how to manage who you hear from.", "monthly", "0.5"),
  "/help/why-decentralization": page(named("Why decentralization matters"), "On most platforms you do not own your account or your audience. Here is the problem, and what changes when you do.", "monthly", "0.4"),
  "/help/wot-vs-algorithms": page(named("Web of Trust vs. algorithms"), "How feed algorithms work and who they serve, and how a web of trust built from people you know does it differently.", "monthly", "0.4"),
  "/help/relay-communities": page(named("Relay communities vs. platforms"), "Why communities built on platforms get trapped there, and what is different about a community on a relay.", "monthly", "0.4"),
  "/help/data-sovereignty": page(named("Owning your data and keys"), "A password is permission from a company. A key is yours. What it means to hold your own account.", "monthly", "0.4"),
  "/help/where-nostr-is-heading": page(named("Where Nostr is heading"), "AI agents, open marketplaces and organisations built on relays: what is being built on the open network next.", "monthly", "0.4"),
  "/help/nostr-vs-alternatives": page(named("Nostr vs. the alternatives"), "How Nostr compares with other open social protocols, the real differences between them, and why we chose it.", "monthly", "0.4"),
  "/privacy": page(named("Privacy"), "What Relay Outpost knows about you and what it does not, in plain words.", "monthly", "0.3"),
  "/terms": page(named("Terms"), "The terms for using Relay Outpost.", "monthly", "0.3"),
  "/child-safety": page(named("Child safety standards"), "Relay Outpost's standards against child sexual abuse and exploitation, and how to report it.", "monthly", "0.3"),
};

/** The page's place in the table: its path without a trailing slash, or null if it is not a public page. */
export function publicPagePath(path: string): string | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return Object.prototype.hasOwnProperty.call(PUBLIC_PAGES, clean) ? clean : null;
}

/** A public page's title for the browser tab: the same words a crawler is served. */
export function publicPageTitle(path: keyof typeof PUBLIC_PAGES | string): string {
  const key = publicPagePath(path);
  return key ? PUBLIC_PAGES[key].title : SITE_NAME;
}
