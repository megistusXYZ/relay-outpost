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
  observer: string | null;
}

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
    if (!now.gate_writes) calls.push({ method: "setwotgatewrites", params: [true] });
  } else if (now.gate_writes) {
    calls.push({ method: "setwotgatewrites", params: [false] });
  }
  return calls;
}
