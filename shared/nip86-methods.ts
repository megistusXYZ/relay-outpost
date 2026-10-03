/**
 * The NIP-86 management methods the app calls, in one list the client's
 * type and the server's proxy allowlist both read. They used to be two lists:
 * the client gained `changerelaybanner` and `changerelaymoderators`, the
 * server never did, and saving a community's banner or moderators failed in
 * production with "Invalid or unsupported NIP-86 method" (found 2026-10-03).
 */
export const NIP86_METHODS = [
  "allowpubkey", "banpubkey", "unallowpubkey", "unbanpubkey",
  "listallowedpubkeys", "listbannedpubkeys",
  "allowevent", "banevent", "listbannedevents",
  "changerelayname", "changerelaydescription", "changerelayicon", "changerelaybanner", "changerelaymoderators",
  "allowkind", "disallowkind", "listallowedkinds", "listdisallowedkinds",
  "blockip", "unblockip", "listblockedips",
] as const;

export type Nip86Method = (typeof NIP86_METHODS)[number];

export function isNip86Method(m: unknown): m is Nip86Method {
  return typeof m === "string" && (NIP86_METHODS as readonly string[]).includes(m);
}
