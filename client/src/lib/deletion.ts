/**
 * Deleting a post (owner, 2026-10-11): on Nostr a deletion is a request
 * (NIP-09) that each relay and app decides to honour. Inside a Relay Outpost
 * community the relay is the one copy and honours it, so there it is a
 * removal. One word, "Delete"; the words around it tell the truth for where
 * the post lives, and one report afterwards says what the relays did.
 */
import type { Event } from "nostr-tools";

export type DeletionHome = "community" | "wider";

const isAddressable = (kind: number) => kind >= 30000 && kind < 40000;

/** NIP-09 deletion naming the event, its address when it has one, and its kind. */
export function buildDeletion(event: Pick<Event, "id" | "pubkey" | "kind" | "tags">): { kind: number; created_at: number; tags: string[][]; content: string } {
  const tags: string[][] = [["e", event.id]];
  if (isAddressable(event.kind)) {
    const d = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    tags.push(["a", `${event.kind}:${event.pubkey}:${d}`]);
  }
  tags.push(["k", String(event.kind)]);
  return { kind: 5, created_at: Math.floor(Date.now() / 1000), tags, content: "" };
}

const norm = (u: string) => u.trim().toLowerCase().replace(/\/+$/, "");

/** Where the deletion goes: a community when every relay asked is one of ours, else the wider network. */
export function deletionHome(relaysAsked: string[], communityRelays: string[]): DeletionHome {
  if (relaysAsked.length === 0) return "wider";
  const ours = new Set(communityRelays.map(norm));
  return relaysAsked.every((r) => ours.has(norm(r))) ? "community" : "wider";
}

/** The community a deletion lives in, by name, when every relay asked is one of ours. One place decides what "the same relay" means. */
export function communityFor(relaysAsked: string[], communities: { url: string; label: string }[]): string | undefined {
  if (deletionHome(relaysAsked, communities.map((c) => c.url)) !== "community") return undefined;
  const asked = new Set(relaysAsked.map(norm));
  return communities.find((c) => asked.has(norm(c.url)))?.label;
}

export function deletionWords(home: DeletionHome, communityName?: string): { title: string; description: string; confirmLabel: string } {
  return {
    title: "Delete this post?",
    description: home === "community"
      ? `This removes it from ${communityName || "your community"}.`
      : "Relays that honour deletions remove it. Copies elsewhere may remain.",
    confirmLabel: "Delete",
  };
}

/** The one line after the re-query: what the relays asked actually did. */
export function deletionReport({ asked, removed }: { asked: number; removed: number }): string {
  if (asked > 0 && removed >= asked) return "Removed from every relay asked.";
  if (removed === 0) return "No relay has removed it yet. Some take a moment; some keep copies.";
  return `Removed from ${removed} of ${asked} relays.`;
}
