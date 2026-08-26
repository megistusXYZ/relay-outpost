/**
 * "When did anything last happen in this community?"
 *
 * A joined relay outpost carries no clock — `OutpostPreview` is
 * {url,label,icon,private} — so the Chats list has always shown these rows in
 * the order the user set by dragging on the Outposts page, and a busy community
 * sat exactly where a dormant one did.
 *
 * WHAT IS ASKED, AND WHY IT IS THE CHEAP QUESTION. One filter per relay:
 * "the single newest group message here". Not per-room activity — that needs
 * your room memberships first, which the Chats screen does not have, turning one
 * round trip into two for every community on the app's landing screen. And for
 * ORDERING a place, activity-of-the-place is the honest signal anyway: the row
 * represents the community, not your unread count in it. Nothing here claims
 * anything is unread.
 *
 * WHAT ABSENCE MEANS. A relay that could not be reached, or that opened a socket
 * and then refused to serve us, is simply MISSING from the result. Never zero.
 * `orderCommunitiesByActivity` reads a missing entry as "no reason to move this
 * row", so it keeps the place the user gave it. Returning 0 would rank it as the
 * deadest thing in the list on the strength of a question we never got answered
 * — the collapse RELAY_REACHABILITY.md exists to prevent.
 */
import { pool } from "@/lib/nostr";
import { withReach, type Reached } from "@/lib/relay-reach";
import { KIND_GROUP_CHAT, fetchLastActivityBatch } from "@/lib/nip29";
import { normalizeUrl } from "@/lib/pinned-feeds";

/** Per-relay budget. The landing screen must not wait on a slow community. */
const PER_RELAY_TIMEOUT_MS = 4000;

async function newestActivity(relayUrl: string): Promise<number | undefined> {
  const res = await withReach(relayUrl, [] as { created_at: number }[], async () => {
    const events = await Promise.race([
      pool.querySync([relayUrl], { kinds: [KIND_GROUP_CHAT], limit: 1 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), PER_RELAY_TIMEOUT_MS),
      ),
    ]);
    return events as { created_at: number }[];
  }).catch((): Reached<{ created_at: number }[]> => ({ data: [], reached: false }));

  // Three outcomes, kept apart. Unreached and refused both mean "we do not
  // know" — only a relay that answered gets to say a number, including when
  // that answer is genuinely "nothing here" (which is also not a number).
  if (!res.reached || res.refusedReason) return undefined;
  const newest = res.data.reduce((max, e) => Math.max(max, e.created_at || 0), 0);
  return newest > 0 ? newest * 1000 : undefined;
}

/**
 * Relay url → newest activity in ms, for the relays that actually answered.
 *
 * Keyed by `normalizeUrl` so a trailing slash or capital letter cannot make a
 * community miss its own answer.
 */
/**
 * "When did anything last happen in each of MY rooms here?" — the per-room
 * refinement of the question above, for the rooms nested under a community row.
 *
 * Returns NULL when the relay was never reached or refused us — the caller must
 * render silence (no timestamp, no unread claim), never "quiet room". Returns a
 * map when the relay answered; a groupId ABSENT from that map is still not a
 * claim of quiet — `fetchLastActivityBatch` resolves on EOSE-or-timeout with
 * whatever arrived, so absence only ever downgrades to "no dot, no timestamp".
 * Both failure directions are silent, neither is a lie; the three-outcomes rule
 * (RELAY_REACHABILITY.md) is carried by the null.
 *
 * Values are SECONDS (matching the read-marks in room-read.ts), unlike
 * fetchCommunityActivity above, which reports ms for the ordering window.
 */
export async function fetchRoomActivity(
  relayUrl: string,
  groupIds: string[],
): Promise<Record<string, number> | null> {
  if (groupIds.length === 0) return {};
  const res = await withReach(relayUrl, {} as Record<string, number>, () =>
    fetchLastActivityBatch(relayUrl, groupIds),
  ).catch((): Reached<Record<string, number>> => ({ data: {}, reached: false }));
  if (!res.reached || res.refusedReason) return null;
  return res.data;
}

export async function fetchCommunityActivity(relayUrls: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(
    relayUrls.map(async (url) => {
      try {
        const at = await newestActivity(url);
        if (typeof at === "number") out.set(normalizeUrl(url), at);
      } catch {
        // Deliberately swallowed into ABSENCE, not into a zero.
      }
    }),
  );
  return out;
}
