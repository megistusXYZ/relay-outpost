/**
 * The account-wide vanish request (NIP-62, kind 62). A relay honours it
 * only when named in a `relay` tag or when the request says ALL_RELAYS, so
 * it carries both: every relay we send to, and the wildcard for any relay
 * that only ever sees a copy. Kept free of app imports so it can be tested
 * on its own.
 */
export function buildVanishTemplate(relays: string[], reason?: string): { kind: number; created_at: number; tags: string[][]; content: string } {
  return {
    kind: 62,
    created_at: Math.floor(Date.now() / 1000),
    tags: [...relays.map((r) => ["relay", r]), ["relay", "ALL_RELAYS"]],
    content: reason?.trim() || "",
  };
}
