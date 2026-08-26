/**
 * What a relay said when it refused an event, turned into something a person can act on.
 *
 * Relays answer a failed publish with a real explanation — NIP-01 gives them a
 * machine-readable prefix and a human sentence:
 *
 *   invalid: a group event must carry an "h" tag
 *   blocked: to create groups open https://groups.fiatjaf.com in your web browser
 *   restricted: not authenticated
 *
 * Every one of those was being thrown away. `tryPublish` logged the Error and
 * returned only a count, so three completely different problems — a malformed
 * event, a policy that wants you in a browser, a missing login — all surfaced as
 * one flat "Failed to create group". A relay saying no IS an answer; discarding
 * it turns a five-second fix into an hour of guessing.
 *
 * Pure and separate from nostr.ts so the wording can be tested without a socket.
 */

export interface PublishRejection {
  relay: string;
  /** Verbatim relay message, prefix included. Empty when the relay said nothing. */
  message: string;
}

/** NIP-01 machine-readable prefixes, most-actionable first. */
const PREFIX_RANK: Record<string, number> = {
  invalid: 5,
  blocked: 4,
  restricted: 3,
  "auth-required": 2,
  "payment-required": 2,
  "rate-limited": 1,
  error: 0,
};

function rank(message: string): number {
  const prefix = message.split(":", 1)[0]?.trim().toLowerCase() ?? "";
  return PREFIX_RANK[prefix] ?? 0;
}

/** A bare timeout tells the user nothing they can act on. */
function isNoise(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m) return true;
  return m.startsWith("timeout after") || m.startsWith("connection failure");
}

/**
 * One line explaining why a publish failed, or undefined when no relay gave a
 * usable reason (in which case the caller keeps its own generic copy).
 *
 * Picks the most actionable message rather than concatenating all of them: with
 * eight relays refusing, eight sentences in a toast is not eight times the help.
 * Ties break toward the first relay, so the order the caller chose is preserved.
 */
export function summarizePublishRejections(
  rejections: readonly PublishRejection[] | null | undefined,
): string | undefined {
  const usable = (rejections ?? []).filter((r) => r?.message && !isNoise(r.message));
  if (usable.length === 0) return undefined;

  let best = usable[0];
  for (const r of usable) {
    if (rank(r.message) > rank(best.message)) best = r;
  }

  const others = usable.length - 1;
  const suffix = others > 0 ? ` (and ${others} other relay${others === 1 ? "" : "s"})` : "";
  return `${humanize(best.message)}${suffix}`;
}

/**
 * Keep the relay's sentence, drop the machine prefix.
 *
 * The prefix is addressed to clients, not people — "invalid: " in front of a
 * perfectly readable sentence just makes it look like a stack trace. Capitalized
 * so it reads as a sentence in a toast.
 */
export function humanize(message: string): string {
  const trimmed = message.trim();
  const colon = trimmed.indexOf(":");
  const prefix = colon > 0 ? trimmed.slice(0, colon).toLowerCase() : "";
  const body = prefix in PREFIX_RANK ? trimmed.slice(colon + 1).trim() : trimmed;
  if (!body) return trimmed;
  return body.charAt(0).toUpperCase() + body.slice(1);
}
