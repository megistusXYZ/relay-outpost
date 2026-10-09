/**
 * What a newlay relay is used for (relay.tools Feeds; docs/MANAGEMENT_API.md
 * §3.11, "relay mode"): one setting with two effects on wrapped messages —
 * who may read them, and whether whoever holds a chat key may delete them.
 *
 *  - open:  anyone can read what's here; deleting works as usual.
 *  - inbox: a private message is shown only to the person it's for.
 *  - chat:  group-chat history can't be erased by whoever holds the chat key
 *           (an outpost's shared key leaking must not take the history with it).
 *
 * The relay stores the two effects, not a name; both set by hand is "custom",
 * shown as it is and never folded into one of the three.
 */
import type { Nip86Param } from "@shared/nip86-methods";

export type RelayType = "open" | "inbox" | "chat";

/** The same relay address, allowing for a trailing slash and case. */
export function sameRelay(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** An outpost you run (own, or hold the admin key for) keeps its chat on this relay. */
export function relayHostsOutpost(communities: ReadonlyArray<{ relays: string[]; owner: string; control_root?: string }>, me: string, relayUrl: string): boolean {
  return communities.some((c) => (c.owner === me || !!c.control_root) && c.relays.some((r) => sameRelay(r, relayUrl)));
}

const PRESET: Record<RelayType, "open" | "nip17" | "concord"> = { open: "open", inbox: "nip17", chat: "concord" };

/** What the relay does today, from getrelaymode; null when it couldn't be read. */
export function readRelayType(mode: unknown): RelayType | "custom" | null {
  if (!mode || typeof mode !== "object") return null;
  const m = mode as Record<string, unknown>;
  const gated = m.read_privacy === "recipient_gated", open = m.read_privacy === "open";
  const kept = m.giftwrap_deletion === "prevent", honored = m.giftwrap_deletion === "honor";
  if (!(gated || open) || !(kept || honored)) return null;
  if (gated && kept) return "custom";
  if (gated) return "inbox";
  if (kept) return "chat";
  return "open";
}

/** The one call that makes the relay `type` (a preset: both effects at once). */
export function callToChoose(type: RelayType): { method: string; params: Nip86Param[] } {
  return { method: "setrelaymode", params: [{ mode: PRESET[type] }] };
}

/**
 * What the host already uses this relay for says what it should be. An inbox
 * hides wrapped messages from everyone but the person they're for — which
 * would hide an outpost's chat from its members — so when it's both, chat
 * wins and the messages should go elsewhere.
 */
export function suggestRelayType({ current, hostsOutpost, isMyInbox }: { current: RelayType | "custom" | null; hostsOutpost: boolean; isMyInbox: boolean }): { choice: RelayType; why: string } | null {
  if (hostsOutpost && isMyInbox && current !== "chat") {
    return { choice: "chat", why: "One of your outposts lives here and you receive private messages here too. An inbox would hide the outpost's chat, so choose Community chat and receive private messages somewhere else." };
  }
  if (hostsOutpost && current !== "chat") {
    return { choice: "chat", why: "One of your outposts lives here. Community chat keeps its history safe even if the chat key leaks." };
  }
  if (isMyInbox && !hostsOutpost && current !== "inbox") {
    return { choice: "inbox", why: "You receive private messages here. Private-messages inbox shows each one only to the person it's for." };
  }
  return null;
}
