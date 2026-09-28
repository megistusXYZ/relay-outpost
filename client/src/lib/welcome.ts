/**
 * Has this account seen the one-time welcome on this device? Per account, so a
 * second account on the same device still gets its own. Device-only on
 * purpose: it's a first-run screen, not a preference worth syncing.
 */
const KEY = "ro_welcomed";

function read(): string[] {
  const raw = localStorage.getItem(KEY);
  const list = raw ? JSON.parse(raw) : [];
  return Array.isArray(list) ? list : [];
}

export function isWelcomed(pubkey: string): boolean {
  // Unreadable storage counts as welcomed, so a blocked store can never keep
  // sending someone back to the welcome at every sign-in.
  try { return read().includes(pubkey); } catch { return true; }
}

export function markWelcomed(pubkey: string): void {
  try {
    const list = read();
    if (!list.includes(pubkey)) localStorage.setItem(KEY, JSON.stringify([...list, pubkey]));
  } catch {}
}
