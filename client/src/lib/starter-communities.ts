/**
 * Curated starter communities for the Outposts hub — good rooms a new person
 * can join without knowing what to search for. Every entry was verified on
 * the wire (NIP-11 answered with a name and operator) before it earned a
 * place here; never add one you haven't probed.
 */

export interface StarterCommunity {
  url: string;
  name: string;
  /** Our one-line human pitch — NOT the relay's own description. */
  tagline: string;
}

// Order is deliberate (owner-curated, 2026-08-27) — not alphabetical.
export const STARTER_COMMUNITIES: StarterCommunity[] = [
  { url: "wss://relay.ditto.pub", name: "Ditto", tagline: "The Ditto community's home relay" },
  { url: "wss://relay.primal.net", name: "Primal", tagline: "The busiest public square on the network" },
  { url: "wss://pyramid.fiatjaf.com", name: "fiatjaf's Pyramid", tagline: "Invite-only room run by nostr's original builder" },
  { url: "wss://spatia-arcana.com", name: "Spatia Arcana", tagline: "\"I contain multitudes\" — an eclectic gathering place" },
  { url: "wss://nostr21.com", name: "nostr21", tagline: "West-coast original — a paid, spam-free room" },
  { url: "wss://theforest.nostr1.com", name: "The Forest", tagline: "A calm, actively moderated community" },
];

function canon(url: string): string {
  return url.trim().toLowerCase().replace(/^wss?:\/\//, "").replace(/\/+$/, "");
}

/** The curated list minus anything the user already joined. */
export function starterSuggestions(joinedUrls: string[]): StarterCommunity[] {
  const joined = new Set(joinedUrls.map(canon));
  return STARTER_COMMUNITIES.filter((c) => !joined.has(canon(c.url)));
}
