/**
 * Team on the relay itself (newlay / relay.tools Feeds; MANAGEMENT_API.md
 * §3.5–3.6). Our Team is a roster the relay never sees, so a teammate who
 * removes a post or bans someone is refused by the relay. On a relay with
 * tiers, "can act here" is a fact the relay holds: the person is assigned a
 * tier whose profile has can_admin. This module turns that into one switch.
 *
 * Precedence on the relay is ban > admin > nip43 > rule > config, so a banned
 * person never acts, and an assignment the host put in the config can't be
 * taken away from here (unassigntier removes only the admin-sourced row).
 */
import type { Nip86Param } from "@shared/nip86-methods";

const HEX64 = /^[0-9a-f]{64}$/;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

/** Our role when the host has none that acts: plain, and only what a moderator needs. */
export const MODERATOR_TIER = { name: "moderator", rank: 50, can_read: true, can_write: true, can_admin: true } as const;
/** Written on every assignment we make, so the host can tell ours from theirs. */
export const OUR_REASON = "Relay Outpost team";

export interface TierPlan {
  tier: string;
  /** The call that creates the tier first, or null when the host already has one. */
  create: { method: string; params: Nip86Param[] } | null;
}

/** Names of the tiers whose profile says can_admin (from listtiers). */
export function adminTierNames(tiers: unknown): string[] {
  if (!Array.isArray(tiers)) return [];
  return tiers.filter((t) => isObj(t) && typeof t.name === "string" && t.can_admin === true && t.name !== "banned").map((t) => t.name as string);
}

/** The tier to give a teammate: the host's own acting tier (lowest rank), else ours, created once. */
export function moderatorTierPlan(tiers: unknown): TierPlan {
  const acting = (Array.isArray(tiers) ? tiers : [])
    .filter((t) => isObj(t) && typeof t.name === "string" && t.can_admin === true && t.name !== "banned")
    .sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0));
  if (acting.length) return { tier: acting[0].name, create: null };
  return { tier: MODERATOR_TIER.name, create: { method: "createtier", params: [{ ...MODERATOR_TIER }] } };
}

/**
 * Who acts here today (from listassignments): everyone assigned an acting
 * tier and not banned. `byHost`: the host set it in the config, so it can't be
 * taken away from here.
 */
export function whoActs(assignments: unknown, acting: readonly string[]): Map<string, { byHost: boolean }> {
  const out = new Map<string, { byHost: boolean }>();
  if (!Array.isArray(assignments)) return out;
  const banned = new Set<string>();
  for (const a of assignments) {
    if (!isObj(a) || typeof a.pubkey !== "string" || !HEX64.test(a.pubkey)) continue;
    if (a.source === "ban") { banned.add(a.pubkey); continue; }
    if (typeof a.tier !== "string" || !acting.includes(a.tier)) continue;
    const prev = out.get(a.pubkey);
    out.set(a.pubkey, { byHost: (prev?.byHost ?? false) || a.source === "config" });
  }
  for (const pk of banned) out.delete(pk);
  return out;
}

/** The calls that make `pubkey` act here (or stop), given the plan. */
export function callsToSetActing(on: boolean, pubkey: string, plan: TierPlan): Array<{ method: string; params: Nip86Param[] }> {
  if (!on) return [{ method: "unassigntier", params: [pubkey] }];
  const calls: Array<{ method: string; params: Nip86Param[] }> = [];
  if (plan.create) calls.push(plan.create);
  calls.push({ method: "assigntier", params: [pubkey, plan.tier, OUR_REASON] });
  return calls;
}
