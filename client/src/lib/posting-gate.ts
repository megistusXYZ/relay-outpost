/**
 * "Who can post" on a newlay relay (relay.tools Feeds): the relay's own trust
 * gate (docs/MANAGEMENT_API.md §3.9) as two plain choices.
 *
 *  - Anyone: writes aren't gated.
 *  - People your network trusts: the relay itself refuses posts from authors
 *    outside the operator's network — members, people the operator follows
 *    and anyone trusted past the cutoff still post. One setting on the relay,
 *    replacing the old "Build from Web of Trust" snapshot that pushed up to
 *    500 people into the allowlist one by one.
 *
 * The gate only acts while the filter (`enabled`) is on, and only on a relay
 * whose host wired trust checks in at boot — getrelaystatus.subsystems.wot.
 */
import type { Nip86Param } from "@shared/nip86-methods";

export type PostingChoice = "anyone" | "network";

export interface WotSettings {
  enabled: boolean;
  computing?: boolean;
  configured?: boolean;
  cutoff?: number;
  gate_writes: boolean;
  /** Kinds the operator exempted from the gate (the whole operator set; setwotexemptkinds replaces it). */
  gate_writes_exempt_kinds?: number[];
  observer: string | null;
}

/**
 * What the gate must let through for members to keep talking: private
 * messages and group chats (kind 1059, signed by a one-time key so nobody can
 * tell who sent them — to the gate, always a stranger) and invite links
 * (33301, signed by the link's own key). The relay still rate-limits exempt
 * kinds on its own lane, and bans still apply.
 */
export const MESSAGE_KINDS = [1059, 33301] as const;

export type PostingGate =
  | { choice: PostingChoice }
  | { choice: null; why: "host-off" | "unread" };

function isSettings(v: unknown): v is WotSettings {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.enabled === "boolean" && typeof s.gate_writes === "boolean" && (s.observer === null || typeof s.observer === "string");
}

/** What the relay does today. `wired`: the host switched trust checks on (status subsystems.wot). */
export function readPostingGate(settings: unknown, { wired }: { wired: boolean }): PostingGate {
  if (!wired) return { choice: null, why: "host-off" };
  if (!isSettings(settings)) return { choice: null, why: "unread" };
  return { choice: settings.enabled && settings.gate_writes ? "network" : "anyone" };
}

/** The calls that make the relay do `choice`, given what it does now. Empty: nothing to change. */
export function callsToChoose(choice: PostingChoice, now: WotSettings, me: string): Array<{ method: string; params: Nip86Param[] }> {
  const calls: Array<{ method: string; params: Nip86Param[] }> = [];
  if (choice === "network") {
    if (!now.observer) calls.push({ method: "setwotobserver", params: [me] });
    if (!now.enabled) calls.push({ method: "setwotenabled", params: [true] });
    // Exemptions go up before the gate does, so no message is refused in between.
    const have = new Set(now.gate_writes_exempt_kinds ?? []);
    if (MESSAGE_KINDS.some((k) => !have.has(k))) {
      calls.push({ method: "setwotexemptkinds", params: [[...new Set([...have, ...MESSAGE_KINDS])].sort((a, b) => a - b)] });
    }
    if (!now.gate_writes) calls.push({ method: "setwotgatewrites", params: [true] });
  } else if (now.gate_writes) {
    calls.push({ method: "setwotgatewrites", params: [false] });
  }
  return calls;
}
