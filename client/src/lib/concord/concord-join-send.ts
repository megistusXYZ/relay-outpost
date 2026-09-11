/**
 * Send a request to join a group chat to the moderators an ask link names
 * (concord-join-requests): one NIP-59 gift wrap each, delivered to their inbox
 * relays (NIP-17 kind 10050, else NIP-65 read relays). The person asking
 * doesn't know the group's relays, and needs none. Returns how many it reached.
 *
 * Not NIP-29's `sendJoinRequest` (a relay-group request that returns
 * `{ ok, error }`): a different thing, so a different name.
 */
import type { ISigner } from "applesauce-signers";
import { createGiftWrap, publishWithFallback } from "@/lib/dm";
import { fetchDMRelayList, hasDMRelayList, getDMRelaysForContact } from "@/lib/outbox";
import { joinRequestTags, KIND_JOIN_REQUEST } from "./concord-join-requests";

export async function sendConcordJoinRequest(
  signer: ISigner,
  requester: string,
  recipients: string[],
  communityId: string,
  note: string,
): Promise<number> {
  let sent = 0;
  for (const to of recipients) {
    const wrapped = await createGiftWrap(signer, requester, to, note.trim(), {
      rumorKind: KIND_JOIN_REQUEST,
      extraTags: joinRequestTags(communityId),
      // Lets a moderator's app find requests without opening every gift wrap.
      outerTags: [["k", String(KIND_JOIN_REQUEST)]],
    }).catch(() => null);
    if (!wrapped) continue;
    await fetchDMRelayList(to, { force: true }).catch(() => {});
    const ok = await publishWithFallback(getDMRelaysForContact(to), wrapped.wrap, hasDMRelayList(to)).then(() => true, () => false);
    if (ok) sent++;
  }
  return sent;
}
