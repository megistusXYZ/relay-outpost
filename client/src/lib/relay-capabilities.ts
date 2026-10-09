/**
 * What a relay lets its operator manage, asked of the relay itself.
 *
 * The console used to assume every relay speaks the whole of NIP-86 plus two
 * methods that aren't in it. They don't (researched 2026-10-03):
 *   - `changerelaybanner` exists in one relay (grain); `changerelaymoderators`
 *     existed only in this app. Saving either "worked" against our own proxy and
 *     failed at relay.tools, nostr1.com and nearly everywhere else.
 *   - relay.tools' legacy endpoint (every *.nostr1.com relay) lifts bans with
 *     `deletebannedpubkey` / `deleteallowedpubkey`, not the spec's names.
 *   - pyramid has no way to lift a ban or an allow at all.
 *
 * So the console asks first (`supportedmethods`, signed) and offers only what
 * the answer lists. When a relay doesn't answer that question, it offers the
 * controls nearly every NIP-86 relay has and tries known alternative names in
 * turn; it never offers banner or moderators on a guess.
 *
 * Pure: no network. lib/nip86.ts does the asking.
 */

export type RelayAction =
  | "ban" | "unban" | "allow" | "unallow" | "listBanned" | "listAllowed"
  | "removeEvent" | "listRemoved" | "restoreEvent"
  | "name" | "description" | "icon" | "banner" | "moderators"
  | "allowKind" | "disallowKind" | "listAllowedKinds" | "listDisallowedKinds"
  // newlay's own (relay.tools Feeds) — only ever offered when the relay lists them.
  | "status" | "postingGate" | "media" | "relayType";

/** Method names for each action, the spec's first, then known alternatives. */
const ACTION_METHODS: Record<RelayAction, readonly string[]> = {
  ban: ["banpubkey"],
  unban: ["unbanpubkey", "deletebannedpubkey"],
  allow: ["allowpubkey"],
  unallow: ["unallowpubkey", "deleteallowedpubkey"],
  listBanned: ["listbannedpubkeys"],
  listAllowed: ["listallowedpubkeys"],
  removeEvent: ["banevent"],
  listRemoved: ["listbannedevents"],
  // The spec's undo is unbanevent; Newlay lifts a removal with allowevent.
  restoreEvent: ["unbanevent", "allowevent"],
  name: ["changerelayname"],
  description: ["changerelaydescription"],
  icon: ["changerelayicon"],
  banner: ["changerelaybanner"],
  moderators: ["changerelaymoderators"],
  allowKind: ["allowkind"],
  disallowKind: ["disallowkind"],
  listAllowedKinds: ["listallowedkinds"],
  listDisallowedKinds: ["listdisallowedkinds"],
  status: ["getrelaystatus"],
  postingGate: ["setwotgatewrites"],
  media: ["listblobs"],
  relayType: ["setrelaymode"],
};

/** Actions that take several calls: every one must be listed (never assumed for an unlisted relay). */
const NEEDS_ALSO: Partial<Record<RelayAction, readonly string[]>> = {
  postingGate: ["getwotsettings", "setwotenabled", "setwotobserver", "setwotexemptkinds"],
  media: ["getblobstats", "deleteblob", "deleteblobsbyowner"],
  relayType: ["getrelaymode"],
};

/** Offered on a relay that didn't list its methods: what nearly every NIP-86 relay has. */
const OFFERED_UNLISTED: ReadonlySet<RelayAction> = new Set<RelayAction>([
  "ban", "unban", "allow", "unallow", "listBanned", "listAllowed", "removeEvent",
  "name", "description", "icon", "allowKind", "disallowKind", "listAllowedKinds", "listDisallowedKinds",
]);

/** Methods any signed-in stranger may call on relay.tools; listing only these means "not yours". */
const SELF_SERVICE = new Set(["supportedmethods", "deletedmsuntil", "deletedmsid"]);

export interface RelayCapabilities {
  /** The methods the relay listed for this key, or null when it didn't say. */
  listed: ReadonlySet<string> | null;
  /** Its management address answered with a web page, not the API: none to offer. */
  noApi?: boolean;
}

export const UNKNOWN_CAPABILITIES: RelayCapabilities = { listed: null };

export function readSupportedMethods(res: { result?: unknown; error?: string; isHtml?: boolean }): RelayCapabilities {
  if (!Array.isArray(res.result)) {
    if (res.isHtml || /\bhtml\b|non-json|non-nip-86/i.test(res.error ?? "")) return { listed: null, noApi: true };
    return UNKNOWN_CAPABILITIES;
  }
  return { listed: new Set(res.result.filter((m): m is string => typeof m === "string").map((m) => m.toLowerCase())) };
}

/** The method names to try for an action, in order. Empty: the relay can't do it. */
export function methodsToTry(caps: RelayCapabilities, action: RelayAction): string[] {
  const names = ACTION_METHODS[action];
  if (caps.noApi) return [];
  if (caps.listed) return names.filter((m) => caps.listed!.has(m));
  return OFFERED_UNLISTED.has(action) ? [...names] : [];
}

export function canDo(caps: RelayCapabilities, action: RelayAction): boolean {
  const also = NEEDS_ALSO[action];
  if (also && !(caps.listed && also.every((m) => caps.listed!.has(m)))) return false;
  return methodsToTry(caps, action).length > 0;
}

/** The relay listed management methods for this key — a positive claim, never inferred. */
export function canManage(caps: RelayCapabilities): boolean {
  if (!caps.listed) return false;
  for (const m of caps.listed) if (!SELF_SERVICE.has(m)) return true;
  return false;
}

/** The relay answered, and the answer is "I don't know that method" — not a refusal. */
export function isUnknownMethod(error: string | undefined): boolean {
  if (!error) return false;
  return /method\b.{0,60}\b(not supported|unsupported|unknown|not found|not implemented)|\b(unknown|unsupported|invalid) method/i.test(error);
}

type Answer = { result?: unknown; error?: string };

/**
 * Call the first of `methods` the relay understands. Moves on only when the
 * relay says it doesn't know a name; any other answer — a result or a real
 * refusal — is final.
 */
export async function callFirstSupported<T extends Answer>(
  call: (method: string, params: unknown[]) => Promise<T>,
  methods: readonly string[],
  params: unknown[],
): Promise<T | Answer> {
  if (methods.length === 0) return { error: "This relay can't do this from here." };
  let last: T | undefined;
  for (const m of methods) {
    last = await call(m, params);
    if (!isUnknownMethod(last.error)) return last;
  }
  return last!;
}

/** Where to change a setting this app can't, for the "Managed at …" line. */
export function managedAt(relayUrl: string): { name: string; url?: string } {
  let host = "";
  try { host = new URL(relayUrl.replace(/^ws/, "http")).hostname.toLowerCase(); } catch {}
  if (host.endsWith(".feeds.relay.tools")) return { name: "relay.tools", url: "https://feeds.relay.tools" };
  if (host.endsWith(".nostr1.com") || host.endsWith(".relay.tools") || host === "relay.tools") {
    return { name: "relay.tools", url: "https://relay.tools" };
  }
  return { name: "your host's settings" };
}
