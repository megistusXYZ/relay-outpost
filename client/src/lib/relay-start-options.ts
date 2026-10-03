/**
 * The ways to get a community space of your own, as the Relays welcome
 * offers them (owner, 2026-10-03: talk about the person and their community,
 * not the protocol or the software).
 *
 * Plain links only — no referral codes, no tracking, nothing routed through
 * us: we're the interface, the provider is the provider, and money moves
 * between the person and them.
 *
 * Running it yourself names real software (owner, 2026-10-03: "advertise
 * multiple different real-life software"), each linking to its own project,
 * with what it's best for and — honestly — how much of Relays works with it
 * (researched 2026-10-03: pyramid, Newlay and haven take management requests;
 * strfry is configured on its server). khatru is a toolkit for building your
 * own, not something to install, so it's a footnote for developers.
 *
 * nostr1.com isn't listed separately: it now serves relay.tools' own page
 * (checked 2026-10-03), so it would be the same door twice. Relays already on
 * nostr1.com connect like any other.
 */
export interface Software {
  name: string;
  /** Two or three words: what it's the pick for. */
  bestFor: string;
  /** One sentence, ending in a full stop. */
  line: string;
  href: string;
}

export interface StartOption {
  id: "hosted" | "self";
  title: string;
  /** Who it suits, as one sentence. */
  forWho: string;
  /** Short facts, each checked against the provider's own page. */
  points: string[];
  /** A provider to go to… */
  cta?: string;
  href?: string;
  /** …or software to choose from. */
  software?: Software[];
  recommended?: boolean;
}

/** For developers who'd rather build their own relay. */
export const BUILD_YOUR_OWN = { name: "khatru", href: "https://khatru.nostr.technology" } as const;

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
    points: ["Free, open-source software", "Full control of where it lives"],
    software: [
      {
        name: "Pyramid",
        bestFor: "Easiest setup",
        line: "One command, no config files. Groups, invites and roles built in.",
        href: "https://github.com/fiatjaf/pyramid",
      },
      {
        name: "Newlay",
        bestFor: "Works fully here",
        line: "The engine relay.tools runs, on your server or an Android phone.",
        href: "https://code.relay.tools/opensauce/newlay",
      },
      {
        name: "strfry",
        bestFor: "Big, busy relays",
        line: "Fast and proven. Its rules are set on the server itself.",
        href: "https://github.com/hoytech/strfry",
      },
      {
        name: "Haven",
        bestFor: "Just for you",
        line: "Your own private relays, with backups built in.",
        href: "https://github.com/barrydeen/haven",
      },
    ],
  },
];
