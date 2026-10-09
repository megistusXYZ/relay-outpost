/**
 * Set up your community — the checklist on Overview (owner, 2026-10-04).
 *
 * Like Discord's, Shopify's or Stripe's: a short list that ticks itself off
 * from what's really true on the relay (its public card, the rules record,
 * the team, the member inbox) — never from a click alone. The two that can't
 * be read from the relay (you confirmed who can post; you shared the link)
 * are remembered on this device. It can be hidden; it never blocks anything.
 *
 * Pure.
 */
export interface SetupFacts {
  name: boolean;
  picture: boolean;
  description: boolean;
  rules: boolean;
  whoCanPostConfirmed: boolean;
  teammates: number;
  justMe: boolean;
  inboxOn: boolean;
  /** The community's own badges (badges-plan step 4: a nudge, never automatic). */
  badges: number;
  shared: boolean;
}

export type SetupItemId = "identity" | "about" | "who-can-post" | "team" | "inbox" | "badge" | "share";

export interface SetupItem {
  id: SetupItemId;
  label: string;
  hint: string;
  done: boolean;
  /** Done because the owner chose to skip it (counts as done; shown faded). */
  skipped: boolean;
  /** The screen where it's done; null when it's done right here (sharing). */
  go: "community" | "access" | "team" | "contact" | "badges" | null;
}

/**
 * `progress` is what the owner did by hand (lib/setup-progress.ts): a step
 * ticked or skipped there is done whatever the relay says; a step true on the
 * relay is done whatever the hand says. The list is a guide, never a gate.
 */
export function setupChecklist(f: SetupFacts, progress: { done: SetupItemId[]; skipped: SetupItemId[] } = { done: [], skipped: [] }): { items: SetupItem[]; done: number; complete: boolean } {
  const byHand = new Set(progress.done), skipped = new Set(progress.skipped);
  const row = (id: SetupItemId, label: string, hint: string, fact: boolean, go: SetupItem["go"]): SetupItem => ({
    id, label, hint, go,
    done: fact || byHand.has(id) || skipped.has(id),
    skipped: !fact && !byHand.has(id) && skipped.has(id),
  });
  const items: SetupItem[] = [
    row("identity", "Name and picture", "What people see first", f.name && f.picture, "community"),
    row("about", "Description and rules", "What it's for, and how to behave", f.description && f.rules, "community"),
    row("who-can-post", "Who can post", "Check it's how you want it", f.whoCanPostConfirmed, "access"),
    row("team", "Your team", "Who helps you run it — or just you", f.teammates > 0 || f.justMe, "team"),
    row("inbox", "Member inbox", "Let members contact you", f.inboxOn, "contact"),
    row("badge", "Make your first badge", "Founding member is ready to go", f.badges > 0, "badges"),
    row("share", "Share your community", "Copy its link and send it to people", f.shared, null),
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, complete: done === items.length };
}
