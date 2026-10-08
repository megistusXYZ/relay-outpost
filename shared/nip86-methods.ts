/**
 * The NIP-86 management methods the app calls, in one list the client's
 * type and the server's proxy allowlist both read. They used to be two lists:
 * the client gained `changerelaybanner` and `changerelaymoderators`, the
 * server never did, and saving a community's banner or moderators failed in
 * production with "Invalid or unsupported NIP-86 method" (found 2026-10-03).
 *
 * `supportedmethods` is how the console asks a relay what it may offer
 * (lib/relay-capabilities.ts). `deletebannedpubkey` / `deleteallowedpubkey`
 * are relay.tools' legacy names for lifting a ban or an allow — every
 * *.nostr1.com relay answers to those and not to the spec's.
 *
 * The rest are newlay's own (relay.tools Feeds; docs/MANAGEMENT_API.md):
 * the relay's health report, its trust gate ("Who can post") and its media
 * store. Several take an on/off value, a clear (null), a number or a group
 * of fields rather than text — see Nip86Param.
 */
export const NIP86_METHODS = [
  "supportedmethods",
  "allowpubkey", "banpubkey", "unallowpubkey", "unbanpubkey",
  "listallowedpubkeys", "listbannedpubkeys",
  "deletebannedpubkey", "deleteallowedpubkey",
  "allowevent", "banevent", "listbannedevents", "unbanevent",
  "changerelayname", "changerelaydescription", "changerelayicon", "changerelaybanner", "changerelaymoderators",
  "allowkind", "disallowkind", "listallowedkinds", "listdisallowedkinds",
  "blockip", "unblockip", "listblockedips",
  "getrelaystatus",
  "getwotsettings", "setwotenabled", "setwotcompute", "setwotgatewrites", "setwotcutoff", "setwotobserver",
  "getblobstats", "listblobs", "deleteblob", "deleteblobsbyowner",
] as const;

/** One management-call parameter: newlay's settings take more than text. */
export type Nip86Param = string | number | boolean | null | { [key: string]: Nip86Param } | Nip86Param[];

export type Nip86Method = (typeof NIP86_METHODS)[number];

export function isNip86Method(m: unknown): m is Nip86Method {
  return typeof m === "string" && (NIP86_METHODS as readonly string[]).includes(m);
}
