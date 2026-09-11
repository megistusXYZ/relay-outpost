/**
 * Disappearing messages (CORD-08).
 *
 * One timer, `message_expiration` in the group's own settings (vsk 0): never a
 * per-message choice, so every member converges on one policy. While it's set,
 * every lasting chat message carries `["expiration", created_at + timer]`
 * inside what its author signs, and its outer wrap carries the same tag so
 * relays delete the ciphertext too (NIP-40). Readers go by the rumor's copy.
 *
 * A change is never retroactive: a message keeps the expiry it was sent under.
 * Expiry is cooperative: an honest client hides and deletes, an honest relay
 * purges, but anyone who could read a message could have copied it. It protects
 * against the future (a seized device, a leaked key), not present readers.
 */
import {
  KIND_DELETE, KIND_TIMER_NOTICE, KIND_TYPING, PERM, msTag, memberPermissions, hasPermissionBit, effectiveTime,
  type CommunityMetadata, type FoldedState, type RumorTemplate,
} from "./concord-events";
import type { SystemEvent } from "./concord-activity";

/**
 * The group's timer in seconds, or 0 for off. "Absent, 0, or malformed means
 * off — a reader MUST NOT guess a default from garbage": only a positive whole
 * JSON number counts.
 */
export function disappearingTimer(metadata: Pick<CommunityMetadata, "raw"> | undefined): number {
  const v = metadata?.raw?.message_expiration;
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : 0;
}

/**
 * Kinds that never carry the tag: a delete must outlive what it erased, a
 * timer notice explains the policy and must not be erased by it, and ephemeral
 * kinds are never stored at all.
 */
const NEVER_EXPIRE = new Set<number>([KIND_DELETE, KIND_TIMER_NOTICE, KIND_TYPING]);

/** A chat rumor as it goes out under the group's timer (unchanged when off). */
export function stampExpiration<T extends Pick<RumorTemplate, "kind" | "created_at" | "tags">>(rumor: T, timer: number): T {
  if (timer <= 0 || NEVER_EXPIRE.has(rumor.kind)) return rumor;
  return { ...rumor, tags: [...rumor.tags.filter((t) => t[0] !== "expiration"), ["expiration", String(rumor.created_at + timer)]] };
}

/** When a rumor expires (unix seconds), by the copy its author signed. */
export function expiresAt(rumor: { tags: string[][] }): number | undefined {
  const v = rumor.tags.find((t) => t[0] === "expiration")?.[1];
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Past its expiry: refused at ingest, never shown, purged from this device. */
export function isExpired(rumor: { tags: string[][] }, nowSec: number): boolean {
  const at = expiresAt(rumor);
  return at !== undefined && at <= nowSec;
}

// ── The notice in the room (CORD-08 §4) ──────────────────────────────────────
/**
 * The line posted into each room after the timer changes, bound to the room
 * like any chat message. It never expires: it explains why history is missing.
 */
export function buildTimerNotice(
  actor: string, channelId: string, epoch: bigint, seconds: number, ms: number, createdAt: number,
): RumorTemplate {
  return {
    kind: KIND_TIMER_NOTICE, pubkey: actor, created_at: createdAt, content: "",
    tags: [["channel", channelId], ["epoch", epoch.toString()], msTag(ms), ["timer", String(Math.max(0, Math.floor(seconds)))]],
  };
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** What the notice says after the actor's name: "set disappearing messages to 7 days". */
/** A timer as people say it: "1 day", "7 days", "12 hours". */
export function timerSpan(seconds: number): string {
  return seconds % 86400 === 0 ? plural(seconds / 86400, "day")
    : seconds % 3600 === 0 ? plural(seconds / 3600, "hour")
    : plural(Math.max(1, Math.round(seconds / 60)), "minute");
}

export function timerNoticeText(seconds: number): string {
  if (!(seconds > 0)) return "turned off disappearing messages";
  return `set disappearing messages to ${timerSpan(seconds)}`;
}

/**
 * Anyone can spell a timer tag; only someone who may change the group's
 * settings is believed about its policy. The settings themselves stay the
 * authority, so a dropped notice changes nothing.
 */
export function believableTimerNotice(
  notice: { kind: number; pubkey: string },
  state: Pick<FoldedState, "grants" | "roles">,
  ownerPubkey: string,
): boolean {
  if (notice.kind !== KIND_TIMER_NOTICE) return false;
  if (notice.pubkey === ownerPubkey) return true;
  return hasPermissionBit(memberPermissions(state.grants.get(notice.pubkey) ?? [], state.roles), PERM.MANAGE_METADATA);
}

/** The "set disappearing messages" lines a room shows: believable notices only. */
export function timerLines(
  notices: { kind: number; pubkey: string; created_at: number; tags: string[][] }[],
  state: Pick<FoldedState, "grants" | "roles">,
  ownerPubkey: string,
): SystemEvent[] {
  return notices
    .filter((n) => believableTimerNotice(n, state, ownerPubkey))
    .map((n) => {
      const v = Number(n.tags.find((t) => t[0] === "timer")?.[1]);
      return { pubkey: n.pubkey, action: "timer" as const, t: effectiveTime(n), timer: Number.isInteger(v) && v > 0 ? v : 0 };
    });
}
