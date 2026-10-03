/**
 * The ways to get a community space of your own, as the Relays welcome
 * offers them (owner, 2026-10-03: talk about the person and their community,
 * not the protocol or the software).
 *
 * Plain links only — no referral codes, no tracking, nothing routed through
 * us: we're the interface, the provider is the provider, and money moves
 * between the person and them.
 *
 * nostr1.com isn't listed separately: it now serves relay.tools' own page
 * (checked 2026-10-03), so it would be the same door twice. Relays already on
 * nostr1.com connect like any other.
 */
export interface StartOption {
  id: "hosted" | "self";
  title: string;
  /** Who it suits, as one sentence. */
  forWho: string;
  /** Short facts, each checked against the provider's own page. */
  points: string[];
  cta: string;
  href: string;
  recommended?: boolean;
}

export const START_OPTIONS: readonly StartOption[] = [
  {
    id: "hosted",
    title: "Hosted for you",
    forWho: "The easy way: someone else keeps it running while you look after your people.",
    // relay.tools Feeds, checked 2026-10-03: "14-day free trial · pay with lightning".
    points: ["Ready in minutes", "Free 14-day trial", "Every tool here works with it"],
    cta: "Start on relay.tools",
    href: "https://feeds.relay.tools",
    recommended: true,
  },
  {
    id: "self",
    title: "Run it yourself",
    forWho: "For technical folks with a server of their own.",
    points: ["Free, open-source software", "Full control of where it lives", "Every tool here works with it"],
    cta: "See how",
    href: "https://github.com/fiatjaf/pyramid",
  },
];
