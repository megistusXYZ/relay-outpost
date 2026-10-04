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
  shared: boolean;
}

export type SetupItemId = "identity" | "about" | "who-can-post" | "team" | "inbox" | "share";

export interface SetupItem {
  id: SetupItemId;
  label: string;
  hint: string;
  done: boolean;
  /** The screen where it's done; null when it's done right here (sharing). */
  go: "community" | "access" | "team" | "contact" | null;
}

export function setupChecklist(f: SetupFacts): { items: SetupItem[]; done: number; complete: boolean } {
  const items: SetupItem[] = [
    { id: "identity", label: "Name and picture", hint: "What people see first", done: f.name && f.picture, go: "community" },
    { id: "about", label: "Description and rules", hint: "What it's for, and how to behave", done: f.description && f.rules, go: "community" },
    { id: "who-can-post", label: "Who can post", hint: "Check it's how you want it", done: f.whoCanPostConfirmed, go: "access" },
    { id: "team", label: "Your team", hint: "Who helps you run it — or just you", done: f.teammates > 0 || f.justMe, go: "team" },
    { id: "inbox", label: "Member inbox", hint: "Let members contact you", done: f.inboxOn, go: "contact" },
    { id: "share", label: "Share your community", hint: "Copy its link and send it to people", done: f.shared, go: null },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, complete: done === items.length };
}
