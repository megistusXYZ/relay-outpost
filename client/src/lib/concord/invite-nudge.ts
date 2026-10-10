/**
 * "Open the invite when I land in my new community" — a nudge that survives
 * the page mounting more than once (owner, 2026-10-10). The nudge used to be
 * `?invite=1` in the URL, consumed on the first render; the community page
 * mounts again right after its record loads, and the dialog state went with
 * the first mount — a new person who had just named their community landed
 * on "now what?" (the welcome rig). The marker stays until the person closes
 * the invite, so every mount opens it, and the URL nudge still works.
 */
const KEY = "relay-outpost-open-invite-for";

export function setInviteNudge(communityId: string): void {
  try { sessionStorage.setItem(KEY, communityId); } catch {}
}

export function hasInviteNudge(communityId: string): boolean {
  try { return sessionStorage.getItem(KEY) === communityId; } catch { return false; }
}

export function clearInviteNudge(communityId: string): void {
  try { if (sessionStorage.getItem(KEY) === communityId) sessionStorage.removeItem(KEY); } catch {}
}
