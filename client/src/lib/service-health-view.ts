/**
 * The words on the team's "Services we depend on" card, from
 * /api/service-health (server/service-health.ts). Pure, so the card can't
 * claim more than the check knows: before the first check it says so, and an
 * old answer is called old.
 */

export interface ServiceHealthItem {
  id: string;
  label: string;
  group: string;
  state: "up" | "empty" | "down";
  since: number;
  lastChecked: number;
  detail?: string;
}

export interface ServiceHealthBody {
  checkedAt: number | null;
  items: ServiceHealthItem[];
}

export interface ServiceRow {
  id: string;
  name: string;
  group: string;
  word: string;
  since: string;
  why?: string;
  severity: "down" | "empty";
}

export type ServiceHealthView =
  | { kind: "waiting"; line: string }
  | { kind: "stale"; line: string }
  | { kind: "ok"; line: string }
  | { kind: "problems"; line: string; rows: ServiceRow[] };

/** Checks run every 15 minutes; two missed rounds and the answer is old. */
const STALE_AFTER_MS = 35 * 60 * 1000;

function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
}

export function serviceHealthView(body: ServiceHealthBody, now: number): ServiceHealthView {
  if (body.checkedAt == null) return { kind: "waiting", line: "The first check runs shortly after the server starts." };
  const age = now - body.checkedAt;
  if (age > STALE_AFTER_MS) return { kind: "stale", line: `The last check was ${ago(age)} ago; the server may not be checking.` };
  const checked = `checked ${ago(age)} ago`;
  const bad = body.items.filter((i) => i.state !== "up");
  if (bad.length === 0) return { kind: "ok", line: `All ${body.items.length} services we depend on are answering · ${checked}` };
  return {
    kind: "problems",
    line: `${bad.length} of ${body.items.length} services need a look · ${checked}`,
    rows: bad.map((i) => ({
      id: i.id,
      name: i.label,
      group: i.group,
      word: i.state === "down" ? "Not answering" : "Answering with nothing",
      since: `for ${ago(now - i.since)}`,
      ...(i.detail ? { why: i.detail } : {}),
      severity: i.state === "down" ? "down" : "empty",
    })),
  };
}
