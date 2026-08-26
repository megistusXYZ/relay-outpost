// Per-pubkey dismissal flags for first-run adoption UI (the getting-started
// checklist and the profile-completion nudge). Same JSON-set-of-pubkeys shape as
// ONBOARDING_KEY in local-account.ts, so a dismissal sticks per account and
// across reloads without leaking between accounts on a shared device.

export const ADOPTION_FLAGS = {
  gettingStartedChecklist: "relay-outpost-dismissed-getting-started",
  profileCompletionNudge: "relay-outpost-dismissed-profile-nudge",
} as const;

export function isDismissed(key: string, pubkey: string | null | undefined): boolean {
  if (!pubkey) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    const set = JSON.parse(raw);
    return Array.isArray(set) && set.includes(pubkey);
  } catch {
    return false;
  }
}

export function dismiss(key: string, pubkey: string | null | undefined): void {
  if (!pubkey) return;
  try {
    const raw = localStorage.getItem(key);
    const set: string[] = raw ? JSON.parse(raw) : [];
    if (!set.includes(pubkey)) {
      set.push(pubkey);
      localStorage.setItem(key, JSON.stringify(set));
    }
  } catch {
    /* ignore */
  }
}

// "Has published a note" — set the first time a user composes a kind-1 from
// CreatePost, read by the getting-started checklist. A durable localStorage
// flag (the local eventStore doesn't survive reloads); only needs to catch
// new users, which is the checklist's audience.
const HAS_POSTED_KEY = "relay-outpost-has-posted";
export function markHasPosted(pubkey: string | null | undefined): void {
  dismiss(HAS_POSTED_KEY, pubkey);
}
export function hasPosted(pubkey: string | null | undefined): boolean {
  return isDismissed(HAS_POSTED_KEY, pubkey);
}
