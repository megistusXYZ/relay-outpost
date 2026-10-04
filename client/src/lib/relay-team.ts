/**
 * Wrapping, storing and opening a relay team's records (lib/team-records.ts).
 *
 * Each record is one NIP-17-style message to the whole team: the same rumor
 * sealed by its author and gift-wrapped once per teammate (and once for the
 * author), published to the relay being managed. Each wrap carries
 * ["k","30078"] in the open — the same idea Concord uses for its invites — so
 * a teammate's app asks the relay for team wraps only and never opens their
 * private messages to find them.
 *
 * Opened records are kept in memory for the session only; nothing decrypted
 * is written to the device.
 */
import type { Event } from "nostr-tools";
import { pool } from "./nostr";
import { canReachRelay } from "./relay-reach";
import { createGiftWrapForSelf, createRoomGiftWraps, unwrapGiftWrapRumor } from "./dm";
import { recordTags, TEAM_RUMOR_KIND, type RecordType, type TeamRumor } from "./team-records";

const opened = new Map<string, TeamRumor | null>();

export async function loadTeamRumors(
  relayUrl: string,
  signer: unknown,
  me: string,
): Promise<{ rumors: TeamRumor[]; reached: boolean }> {
  if (!(await canReachRelay(relayUrl))) return { rumors: [], reached: false };
  const wraps: Event[] = await pool
    .querySync([relayUrl], { kinds: [1059], "#p": [me], "#k": [String(TEAM_RUMOR_KIND)], limit: 500 }, { maxWait: 6000 } as never)
    .catch(() => []);
  const rumors: TeamRumor[] = [];
  for (const w of wraps) {
    if (!opened.has(w.id)) opened.set(w.id, (await unwrapGiftWrapRumor(signer, me, w)) as TeamRumor | null);
    const r = opened.get(w.id);
    if (r) rumors.push(r);
  }
  // One record arrives as several wraps (one per teammate); keep it once.
  const seen = new Set<string>();
  return { rumors: rumors.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))), reached: true };
}

/** `missed`: teammates whose copy the relay turned down — they won't see this one. */
export type PublishOutcome = { stored: true; missed?: number } | { stored: false; reason: string };

/** Seal one record to everyone on the team (you included) and store it on the relay. */
export async function publishTeamRecord(
  relayUrl: string,
  signer: { nip44?: unknown } | null | undefined,
  me: string,
  members: readonly string[],
  type: RecordType,
  body: Record<string, unknown>,
): Promise<PublishOutcome> {
  if (!signer?.nip44) return { stored: false, reason: "Your signer can't encrypt, so team records can't be written." };
  const others = [...new Set(members.map((m) => m.toLowerCase()))].filter((m) => m !== me.toLowerCase());
  const content = JSON.stringify(body);
  const opts = { rumorKind: TEAM_RUMOR_KIND, extraTags: recordTags(type, relayUrl), outerTags: [["k", String(TEAM_RUMOR_KIND)]] };
  let wraps: Event[] = [];
  if (others.length) {
    const built = await createRoomGiftWraps(signer, me, others, content, opts);
    if (!built) return { stored: false, reason: "Couldn't seal it for everyone on the team." };
    wraps = [...built.wraps.map((w) => w.wrap), ...(built.selfWrap ? [built.selfWrap] : [])];
  } else {
    const self = await createGiftWrapForSelf(signer, me, me, content, opts);
    if (!self) return { stored: false, reason: "Couldn't seal it." };
    wraps = [self];
  }
  const failures: string[] = [];
  for (const w of wraps) {
    try { await Promise.any(pool.publish([relayUrl], w)); } catch (e) {
      const msg = e instanceof AggregateError ? String(e.errors?.[0]?.message ?? e.errors?.[0] ?? "refused") : String((e as Error)?.message ?? e);
      failures.push(msg);
    }
  }
  if (failures.length === wraps.length) return { stored: false, reason: `Your relay didn't keep it: ${failures[0]}` };
  return failures.length ? { stored: true, missed: failures.length } : { stored: true };
}
