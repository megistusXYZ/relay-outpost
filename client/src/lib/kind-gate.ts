/**
 * Kind gating for the Access Control tab — what a relay accepts at the door,
 * via NIP-86 allowkind/disallowkind.
 *
 * The policy readout obeys the three-outcome rule: an allowlist, a blocklist,
 * an explicit "no restriction" (the relay answered with two empty lists), and
 * "unknown" (we never got an answer) are four different facts. Rendering
 * unknown as unrestricted would be the reachability lie this repo keeps
 * paying for.
 */

export type KindPolicy =
  | { mode: "allowlist"; kinds: number[] }
  | { mode: "blocklist"; kinds: number[] }
  | { mode: "unrestricted"; kinds: number[] }
  | { mode: "unknown"; kinds: number[] };

export function describeKindPolicy(
  allowed: number[] | null,
  disallowed: number[] | null,
): KindPolicy {
  if (allowed === null || disallowed === null) return { mode: "unknown", kinds: [] };
  // An allowlist is the narrower claim — it wins if a relay reports both.
  if (allowed.length > 0) return { mode: "allowlist", kinds: allowed };
  if (disallowed.length > 0) return { mode: "blocklist", kinds: disallowed };
  return { mode: "unrestricted", kinds: [] };
}

/**
 * The vocabulary the gate UI offers — content people recognize, mapped to the
 * kinds that carry it. Not exhaustive on purpose: operators gate categories,
 * not kind numbers, and a raw-number input covers the long tail.
 */
export const GATE_KIND_OPTIONS: { label: string; kinds: number[] }[] = [
  { label: "Short posts", kinds: [1] },
  { label: "Reposts & reactions", kinds: [6, 7] },
  { label: "Articles", kinds: [30023] },
  { label: "Pictures", kinds: [20] },
  { label: "Videos", kinds: [21, 22, 34235, 34236] },
  { label: "Live streams", kinds: [30311] },
  { label: "Marketplace listings", kinds: [30402] },
  { label: "Private messages", kinds: [4, 1059] },
  { label: "Group chat", kinds: [9, 39000, 39001, 39002] },
  { label: "Comments", kinds: [1111] },
  { label: "Zaps", kinds: [9734, 9735] },
  { label: "Curated feeds", kinds: [30004] },
];

/** Kinds grouped under their category labels: "Private messages (4, 1059)". */
export function formatKindList(kinds: number[]): string {
  const groups = new Map<string, number[]>();
  for (const k of kinds) {
    const opt = GATE_KIND_OPTIONS.find((o) => o.kinds.includes(k));
    const label = opt ? opt.label : `Kind ${k}`;
    groups.set(label, [...(groups.get(label) || []), k]);
  }
  return [...groups.entries()]
    .map(([label, ks]) => (label.startsWith("Kind ") ? label : `${label} (${ks.join(", ")})`))
    .join(", ");
}
