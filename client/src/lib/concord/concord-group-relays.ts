/**
 * Which relays a new group chat lives on. Yours first, where you already
 * publish; the app's defaults filling up to five, so every member can reach it
 * whatever relays they use. At most three of yours go before the defaults; more
 * only if the defaults run out. Secure relays only, each once.
 *
 * Before, a group went on the first five defaults whatever relays you used.
 */
export const GROUP_RELAY_CAP = 5;
const OWN_FIRST = 3;

const norm = (u: string) => u.trim().replace(/\/+$/, "");
const isSecureRelay = (u: string) => /^wss:\/\/[^\s/]+/i.test(u);

export function groupRelays(write: string[], defaults: string[], cap = GROUP_RELAY_CAP): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string) => {
    if (out.length >= cap) return;
    const n = norm(u);
    if (!isSecureRelay(n) || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    out.push(n);
  };
  const own = write.map(norm).filter(isSecureRelay);
  for (const u of own.slice(0, OWN_FIRST)) add(u);
  for (const u of defaults) add(u);
  for (const u of own.slice(OWN_FIRST)) add(u);
  return out;
}
