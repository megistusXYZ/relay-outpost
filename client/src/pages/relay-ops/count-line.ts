/**
 * "How many match?" in one honest line (NIP-45 COUNT).
 *
 * A relay that can't or won't count is said to — never shown as zero, which
 * would be the confident-empty this project keeps removing
 * (RELAY_REACHABILITY.md). An estimate (`approximate: true`) says "About".
 */
export type CountState =
  | { status: "counting" }
  | { status: "counted"; count: number; approximate?: boolean }
  | { status: "unsupported" }
  | { status: "refused"; reason?: string }
  | { status: "unreached" };

export function countLine(s: CountState): string {
  switch (s.status) {
    case "counting": return "Counting…";
    case "unsupported": return "Totals aren't available here";
    case "unreached": return "Couldn't reach your community to count";
    case "refused": {
      const why = (s.reason ?? "").replace(/^[a-z-]+:\s*/i, "").trim();
      return why ? `Your host wouldn't count this: ${why}` : "Your host wouldn't count this";
    }
    case "counted": {
      if (s.count === 0) return "None match";
      const n = s.count.toLocaleString("en-US");
      return `${s.approximate ? "About " : ""}${n} match`;
    }
  }
}
