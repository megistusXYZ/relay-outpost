/**
 * Send a report to a group's moderators (concord-reports): one NIP-59 gift wrap
 * each, delivered the way a direct invite is, to their inbox relays (NIP-17
 * kind 10050, else NIP-65 read relays) with the group's relays as a backup.
 * Returns how many moderators it went to.
 */
import type { Event } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { createGiftWrap, publishWithFallback } from "@/lib/dm";
import { fetchDMRelayList, hasDMRelayList, getDMRelaysForContact } from "@/lib/outbox";
import { reportTags, KIND_GROUP_REPORT, type ReportReason } from "./concord-reports";
import type { StoredCommunity } from "./concord-keys";

export async function sendGroupReport(
  signer: ISigner,
  reporter: string,
  community: StoredCommunity,
  recipients: string[],
  report: { channelId: string; msgId: string; author: string; reason: ReportReason; note: string; snippet: string },
  publish: (event: Event, relays: string[]) => Promise<unknown>,
): Promise<number> {
  const tags = reportTags({ communityId: community.community_id, ...report });
  let sent = 0;
  for (const to of recipients) {
    const wrapped = await createGiftWrap(signer, reporter, to, report.note.trim(), {
      rumorKind: KIND_GROUP_REPORT,
      extraTags: tags,
      // Lets a moderator's app find reports without opening every gift wrap.
      outerTags: [["k", String(KIND_GROUP_REPORT)]],
    }).catch(() => null);
    if (!wrapped) continue;
    await fetchDMRelayList(to, { force: true }).catch(() => {});
    await publishWithFallback(getDMRelaysForContact(to), wrapped.wrap, hasDMRelayList(to)).catch(() => {});
    await publish(wrapped.wrap, community.relays).catch(() => {});
    sent++;
  }
  return sent;
}
