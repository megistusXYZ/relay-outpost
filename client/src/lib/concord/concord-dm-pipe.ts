/**
 * Group-chat rumors that ride the DM gift-wrap pipe (NIP-59) and must never be
 * shown or cached as DM text: a direct invite (3313), whose content is the
 * group's secret keys, and a report to the group's moderators (1984). Every
 * unwrap path calls this first, and anything it returns was handled here, even
 * when malformed: falling through would put it in a DM thread.
 */
import { stashDirectInviteRumor, KIND_DIRECT_INVITE } from "./concord-invites";
import { parseReport, stashReport, KIND_GROUP_REPORT } from "./concord-reports";

export type RoutedRumor =
  | { kind: "invite"; isNew: boolean; name?: string }
  | { kind: "report"; isNew: boolean };

export function routeGroupRumor(
  owner: string,
  u: { senderPubkey: string; content: string; timestamp: number; rumorId: string; rumorKind: number; tags?: string[][] },
): RoutedRumor | null {
  if (u.rumorKind === KIND_DIRECT_INVITE) {
    const stashed = stashDirectInviteRumor(owner, u);
    return { kind: "invite", isNew: !!stashed?.isNew, ...(stashed?.bundle.name ? { name: stashed.bundle.name } : {}) };
  }
  if (u.rumorKind === KIND_GROUP_REPORT) {
    const report = parseReport(u);
    return { kind: "report", isNew: !!report && stashReport(owner, report) };
  }
  return null;
}
