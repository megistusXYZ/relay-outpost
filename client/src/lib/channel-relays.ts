import { fetchNip11, getSoftwareDisplay, type Nip11Document } from "@/lib/nip11";
import { getOutpostRelays } from "@/lib/outpost-relays";

// Creating a chat channel = publishing a NIP-29 group (kind 9007) to a relay.
// The relay must support NIP-29 AND let a joined member create groups (relay
// policy). We can't know "will it let ME" for certain without trying, but
// supported_nips advertising 29 is a reliable gate — verified live on pyramid,
// khatru and groups_relay instances. A software-name fallback covers relays that
// implement NIP-29 groups but happen not to list it.
const NIP29 = 29;
// "ditto" — Ditto/Soapbox relays serve group (kind 39000 / 9) events and the app
// already renders their channels, so we surface them as channel hosts even though
// their NIP-11 doesn't advertise 29. Open channels work; managed (closed/private)
// semantics aren't guaranteed there.
const GROUP_SOFTWARE = ["pyramid", "khatru", "groups_relay", "groups-relay", "relay29", "chachi", "29.tools", "ditto"];

export interface ChannelCapability {
  supportsNip29: boolean;
  software: string | null; // display, e.g. "pyramid v1.2.12"
  authRequired: boolean;
  doc: Nip11Document | null;
}

function hostsGroups(doc: Nip11Document | null): boolean {
  if (!doc) return false;
  if (doc.supported_nips?.includes(NIP29)) return true;
  const sw = (doc.software || "").toLowerCase();
  return GROUP_SOFTWARE.some((s) => sw.includes(s));
}

// Whether a single relay can host chat channels (NIP-29). Cached via nip11Cache.
export async function getChannelCapability(relayUrl: string): Promise<ChannelCapability> {
  const doc = await fetchNip11(relayUrl);
  return {
    supportsNip29: hostsGroups(doc),
    software: doc ? getSoftwareDisplay(doc) : null,
    authRequired: !!doc?.limitation?.auth_required,
    doc,
  };
}

export interface ChannelCapableOutpost {
  url: string;
  label: string;
  software: string | null;
  authRequired: boolean;
}

// The joined outposts a user can actually create a channel on (NIP-29 capable).
export async function listChannelCapableJoinedOutposts(): Promise<ChannelCapableOutpost[]> {
  const outposts = getOutpostRelays();
  const checked = await Promise.all(
    outposts.map(async (o) => {
      try {
        const cap = await getChannelCapability(o.url);
        return cap.supportsNip29
          ? { url: o.url, label: o.label, software: cap.software, authRequired: cap.authRequired }
          : null;
      } catch {
        return null;
      }
    }),
  );
  return checked.filter((x): x is ChannelCapableOutpost => x !== null);
}

export interface SuggestedChannelRelay {
  url: string;
  label: string;
  note: string;
}

// Short curated list of OPEN groups relays (any member can spin up a channel) —
// shown only when a user has no channel-capable joined outpost. All verified to
// advertise NIP-29. Joining one uses the normal outpost-join flow.
export const CHANNEL_FRIENDLY_RELAYS: SuggestedChannelRelay[] = [
  { url: "wss://groups.0xchat.com", label: "0xchat Groups", note: "Popular open groups relay — anyone can create a channel." },
  { url: "wss://communities.nos.social", label: "nos.social Communities", note: "Open community groups hosted by nos.social." },
  { url: "wss://groups.fiatjaf.com", label: "fiatjaf's Groups", note: "Reference NIP-29 groups relay run by Nostr's creator." },
];

// "Run your own" options surfaced when someone wants to host channels themselves.
export interface SelfHostRelay {
  name: string;
  url: string; // GitHub
  blurb: string;
}
export const SELF_HOST_CHANNEL_RELAYS: SelfHostRelay[] = [
  {
    name: "pyramid",
    url: "https://github.com/fiatjaf/pyramid",
    blurb: "An invite-tree community relay whose groups relay lets members create their own channels and become admins. (This is what Spatia-Arcana runs.)",
  },
  {
    name: "HAVEN",
    url: "https://github.com/barrydeen/haven",
    blurb: "A personal, sovereign relay (private / chat / inbox / outbox) with built-in media hosting. Best for private or personal use rather than open community channels.",
  },
];
