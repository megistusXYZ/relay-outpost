/**
 * The line a visitor sees on the landing when they arrive from someone's invite
 * link (?inviter=). It used to look identical whether a friend sent you or not.
 * Pure: the caller fetches the inviter's profile (kind 0) and passes it in.
 */
const MAX_NAME = 40;

export function inviteGreeting(profile: { display_name?: string; name?: string } | null | undefined): string {
  const raw = (profile?.display_name || "").trim() || (profile?.name || "").trim();
  if (!raw) return "A friend invited you";
  const name = raw.length > MAX_NAME ? `${raw.slice(0, MAX_NAME)}…` : raw;
  return `${name} invited you`;
}
