import type { Event as NostrEvent, Filter } from "nostr-tools";
import { nip19 } from "nostr-tools";
import { pool, DEFAULT_RELAYS } from "./nostr";
import { fetchNip11 } from "./nip11";
import { clientTags, buildNip22CommentTags } from "./nostr-helpers";
import { getOutpostRelays } from "./outpost-relays";
import { getReadRelays, getWriteRelays, getDMRelayListCached, getLocalDMRelays, fetchDMRelayList } from "./outbox";
import { sendDM, unwrapGiftWrapRumor, type UnwrappedRumor } from "./dm";
import { APP_VERSION } from "./changelog";

export const KIND_NIP34_ISSUE = 1621;
export const KIND_NIP34_COMMENT = 1622; // legacy NIP-34 comment (still read for back-compat)
export const KIND_NIP22_COMMENT = 1111; // NIP-22 generic comment — the standard we publish
export const KIND_NIP34_STATUS_OPEN = 1630;
export const KIND_NIP34_STATUS_RESOLVED = 1631;
export const KIND_NIP34_STATUS_CLOSED = 1632;
export const KIND_NIP34_STATUS_DRAFT = 1633;
export const KIND_NIP34_REPO = 30617;

export const NIP34_FEEDBACK_KINDS = [
  KIND_NIP34_ISSUE,
  KIND_NIP22_COMMENT,
  KIND_NIP34_COMMENT,
  KIND_NIP34_STATUS_OPEN,
  KIND_NIP34_STATUS_RESOLVED,
  KIND_NIP34_STATUS_CLOSED,
  KIND_NIP34_STATUS_DRAFT,
];

export const FEEDBACK_TOPIC_TAG = "feedback";
export const FEEDBACK_KIND1_TAG = "feedback";

export const RELAY_OUTPOST_TEAM_RELAY = "wss://relay.nostroutpost.com";
export const RELAY_OUTPOST_TEAM_REPO_D = "relay-outpost";
// The team relay doesn't advertise an operator pubkey via NIP-11, so feedback
// couldn't be addressed to the team (it fell back to public-only). Hardcode the
// team inbox pubkey so beta feedback always routes here — privately + tagged.
export const RELAY_OUTPOST_TEAM_PUBKEY = "dabe380b225adf262f3e2cf96460d4879b15fafd2f4325939600fc5c3b50a122";

// The human-facing release version comes from the changelog (single source of
// truth — see APP_VERSION there). Re-exported here so existing importers keep
// working. APP_BUILD is the precise per-build stamp baked in at build time
// ("<git-sha>+<timestamp>", or "dev" locally) — it changes every Republish, so
// the update check fires reliably and crash tickets pin the exact commit.
export { APP_VERSION };
export const APP_BUILD: string =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_APP_VERSION) || "dev";

/** The short build id (git sha) for display — the part before the timestamp. */
export function shortBuild(build: string = APP_BUILD): string {
  return build.split("+")[0];
}

/** Human version label for support/crash context, e.g. "1.6.0 (a3202be)".
 *  Drops the build suffix in dev where there's no stamp. */
export function appVersionLabel(): string {
  return APP_BUILD && APP_BUILD !== "dev" ? `${APP_VERSION} (${shortBuild()})` : APP_VERSION;
}

export type FeedbackType = "bug" | "idea" | "ux" | "question";
export type FeedbackStatus = "open" | "resolved" | "closed" | "draft";

export interface FeedbackContext {
  route: string;
  viewport: string;
  signerType: string;
  appVersion: string;
}

export interface FeedbackRecipient {
  label: string;
  relay: string;
  operatorPubkey: string | null;
  repoD: string | null;
  hasInbox: boolean;
  description?: string;
}

export interface FeedbackIssue {
  event: NostrEvent;
  title: string;
  type: FeedbackType[];
  status: FeedbackStatus;
  reporter: string;
  createdAt: number;
  latestActivityAt: number;
  contextBlock: FeedbackContext | null;
  comments: NostrEvent[];
  private?: boolean;
}

export function relayScopedRepoD(relayUrl: string): string {
  let host = relayUrl.replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
  host = host.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  return `feedback-${host}`;
}

export function repoCoord(pubkey: string, d: string): string {
  return `${KIND_NIP34_REPO}:${pubkey}:${d}`;
}

// Drops the URL `#fragment` (and any `?query`) from the captured route. Concord
// invite secrets ride in `window.location.hash`, so keeping the hash would let an
// auto-filed crash report on an invite link silently exfiltrate the secret. We
// keep only the pathname, with bech32 entity ids masked to `/<id>`.
export const SAFE_ROUTE = (path: string): string => {
  try {
    const u = new URL(path, window.location.origin);
    return u.pathname.replace(/\/(npub1|nprofile1|nevent1|note1|naddr1)[a-z0-9]+/gi, "/<id>");
  } catch {
    return path.split(/[?#]/)[0] || "/";
  }
};

export function captureContext(signerType: string): FeedbackContext {
  return {
    // Pass only the pathname (never the hash) — belt-and-braces, since SAFE_ROUTE
    // now strips the hash anyway.
    route: typeof window !== "undefined" ? SAFE_ROUTE(window.location.pathname) : "/",
    viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "0x0",
    signerType,
    appVersion: appVersionLabel(),
  };
}

export function formatContextBlock(ctx: FeedbackContext): string {
  return [
    "",
    "---",
    "Context (auto-attached):",
    `- route: ${ctx.route}`,
    `- viewport: ${ctx.viewport}`,
    `- signer: ${ctx.signerType}`,
    `- app: Relay Outpost ${ctx.appVersion}`,
  ].join("\n");
}

const CONTEXT_RE = /\n---\nContext \(auto-attached\):\n- route: (.+?)\n- viewport: (.+?)\n- signer: (.+?)\n- app: Relay Outpost (.+?)$/m;

export function parseContextBlock(content: string): FeedbackContext | null {
  const m = content.match(CONTEXT_RE);
  if (!m) return null;
  return { route: m[1], viewport: m[2], signerType: m[3], appVersion: m[4] };
}

export function stripContextBlock(content: string): string {
  return content.replace(CONTEXT_RE, "").trimEnd();
}

const ANNOTATIONS_KEY = "relay-outpost:feedback-annotations:v1";
export interface FeedbackAnnotation {
  pinned?: boolean;
  duplicateOf?: string;
}
type AnnotationStore = Record<string, FeedbackAnnotation>;

function loadAnnotations(): AnnotationStore {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_KEY);
    return raw ? (JSON.parse(raw) as AnnotationStore) : {};
  } catch { return {}; }
}
function saveAnnotations(store: AnnotationStore) {
  try { localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(store)); } catch {}
  try { window.dispatchEvent(new CustomEvent("relay-outpost:feedback-annotated")); } catch {}
}
export function getAnnotation(issueId: string): FeedbackAnnotation {
  return loadAnnotations()[issueId] || {};
}
export function getAllAnnotations(): AnnotationStore {
  return loadAnnotations();
}
export function setAnnotation(issueId: string, patch: Partial<FeedbackAnnotation>) {
  const store = loadAnnotations();
  const next = { ...(store[issueId] || {}), ...patch };
  if (!next.pinned && !next.duplicateOf) delete store[issueId];
  else store[issueId] = next;
  saveAnnotations(store);
}

// --- Crash-group local statuses ---------------------------------------------
// Operator triage state for crash groups, keyed by the stable crash-sig. Same
// contract as the pin/duplicate annotations above: LOCAL-ONLY (this device's
// localStorage), NEVER published. Crash reports come from anonymous throwaway
// keys, so there is no reporter to notify — a wire status event would be
// meaningless; a local marker is the honest model. Default for an unseen sig
// is "new".
export type CrashStatus = "new" | "investigating" | "fixed" | "ignored";
export const CRASH_STATUSES: readonly CrashStatus[] = ["new", "investigating", "fixed", "ignored"];

export function isCrashStatus(value: unknown): value is CrashStatus {
  return typeof value === "string" && (CRASH_STATUSES as readonly string[]).includes(value);
}

/** Fixed/Ignored groups are "done" — they render dimmed and sort below active ones. */
export function isInactiveCrashStatus(status: CrashStatus): boolean {
  return status === "fixed" || status === "ignored";
}

/** Tap-to-cycle order: new → investigating → fixed → ignored → new. */
export function nextCrashStatus(status: CrashStatus): CrashStatus {
  const i = CRASH_STATUSES.indexOf(status);
  return CRASH_STATUSES[(i + 1) % CRASH_STATUSES.length];
}

const CRASH_STATUS_KEY = "relay-outpost:crash-statuses:v1";
type CrashStatusStore = Record<string, CrashStatus>;

function loadCrashStatuses(): CrashStatusStore {
  try {
    const raw = localStorage.getItem(CRASH_STATUS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out: CrashStatusStore = {};
    for (const [sig, st] of Object.entries(parsed)) {
      if (isCrashStatus(st)) out[sig] = st;
    }
    return out;
  } catch { return {}; }
}

function saveCrashStatuses(store: CrashStatusStore) {
  try { localStorage.setItem(CRASH_STATUS_KEY, JSON.stringify(store)); } catch {}
  // Reuse the annotations change event so the Feedback tab's existing tick
  // listener re-renders — one channel for every local annotation change.
  try { window.dispatchEvent(new CustomEvent("relay-outpost:feedback-annotated")); } catch {}
}

export function getAllCrashStatuses(): CrashStatusStore {
  return loadCrashStatuses();
}

export function getCrashStatus(sig: string): CrashStatus {
  return loadCrashStatuses()[sig] || "new";
}

export function setCrashStatus(sig: string, status: CrashStatus) {
  const store = loadCrashStatuses();
  // "new" is the default — storing it would just grow the map forever.
  if (status === "new") delete store[sig];
  else store[sig] = status;
  saveCrashStatuses(store);
}

// --- Filter predicates + list ordering (shared by both console views) --------

export type AgeFilter = "all" | "24h" | "7d" | "30d";

export function ageFilterCutoff(filter: AgeFilter, now: number): number {
  switch (filter) {
    case "24h": return now - 86400;
    case "7d": return now - 7 * 86400;
    case "30d": return now - 30 * 86400;
    default: return 0;
  }
}

/** True when a last-activity timestamp (seconds) passes the AGE filter. */
export function matchesAge(activityAt: number, filter: AgeFilter, now: number): boolean {
  const cutoff = ageFilterCutoff(filter, now);
  return cutoff === 0 || activityAt >= cutoff;
}

/** Resolved/Closed tickets are "done" — dimmed and sorted below open/triaged. */
export function isInactiveFeedbackStatus(status: FeedbackStatus): boolean {
  return status === "resolved" || status === "closed";
}

/** Stable list order for triage lists: pinned first, then active items, then
 *  dimmed (done) items, newest activity first within each band. Returns a new
 *  array; never mutates the input. */
export function sortTriaged<T>(
  items: T[],
  opts: { pinned?: (item: T) => boolean; dimmed: (item: T) => boolean; activityAt: (item: T) => number },
): T[] {
  const { pinned, dimmed, activityAt } = opts;
  return [...items].sort((a, b) => {
    if (pinned) {
      const pa = pinned(a) ? 1 : 0;
      const pb = pinned(b) ? 1 : 0;
      if (pa !== pb) return pb - pa;
    }
    const da = dimmed(a) ? 1 : 0;
    const db = dimmed(b) ? 1 : 0;
    if (da !== db) return da - db;
    return activityAt(b) - activityAt(a);
  });
}

/** Honest list-header count: "5 errors" when nothing is filtered away,
 *  "3 of 5 errors · 2 hidden" when active filters hide items. */
export function formatFilteredHeader(noun: string, visible: number, total: number): string {
  const label = total === 1 ? noun : `${noun}s`;
  if (visible >= total) return `${total} ${label}`;
  return `${visible} of ${total} ${label} · ${total - visible} hidden`;
}

/** Count feedback issues per lifecycle status, so filter chips can show the
 *  distribution ("Open 4 · Resolved 1 · Closed 0") instead of bare labels. */
export function tallyFeedbackStatuses(issues: FeedbackIssue[]): Record<FeedbackStatus, number> {
  const t: Record<FeedbackStatus, number> = { open: 0, resolved: 0, closed: 0, draft: 0 };
  for (const i of issues) if (i.status in t) t[i.status] += 1;
  return t;
}

/** Count how many of `times` (unix seconds) fall within each age window, so the
 *  Age chips read "24h 5 · 7d 5 · 30d 5" — which makes it obvious when every
 *  ticket is recent and narrowing the window legitimately changes nothing. */
export function tallyByAge(times: number[], now: number): Record<AgeFilter, number> {
  const t: Record<AgeFilter, number> = { all: times.length, "24h": 0, "7d": 0, "30d": 0 };
  for (const ts of times) {
    if (matchesAge(ts, "24h", now)) t["24h"] += 1;
    if (matchesAge(ts, "7d", now)) t["7d"] += 1;
    if (matchesAge(ts, "30d", now)) t["30d"] += 1;
  }
  return t;
}

// --- Recent status-change marker (visual layer only) -------------------------
// Remembers the last status this DEVICE saw per issue so the list can show a
// subtle "updated" dot when a status flips (whether the operator changed it here
// or it arrived from the wire). Purely cosmetic, local-only, never published.

export interface StatusObservation { status: FeedbackStatus; at: number }
export type StatusObservationMap = Record<string, StatusObservation>;

/** How long the "updated" dot stays visible after a status change (seconds). */
export const STATUS_CHANGE_DOT_WINDOW_S = 24 * 3600;

/** Pure fold: merge the currently-observed statuses into the persisted map.
 *  First sighting of an issue records { at: 0 } (backlog never lights up);
 *  a CHANGED status stamps { at: now } — that's what drives the dot. Entries
 *  for issues no longer observed are pruned once their stamp leaves the dot
 *  window, so the map can't grow forever. */
export function foldStatusObservations(
  prev: StatusObservationMap,
  observed: Array<{ id: string; status: FeedbackStatus }>,
  now: number,
): { map: StatusObservationMap; changed: boolean } {
  const map: StatusObservationMap = {};
  let changed = false;
  const seen = new Set<string>();
  for (const { id, status } of observed) {
    seen.add(id);
    const before = prev[id];
    if (!before) {
      map[id] = { status, at: 0 };
      changed = true;
    } else if (before.status !== status) {
      map[id] = { status, at: now };
      changed = true;
    } else {
      map[id] = before;
    }
  }
  for (const [id, obs] of Object.entries(prev)) {
    if (seen.has(id)) continue;
    if (now - obs.at < STATUS_CHANGE_DOT_WINDOW_S) map[id] = obs; // keep a fresh marker through list churn
    else changed = true; // stale + absent → pruned
  }
  return { map, changed };
}

/** Ids whose status changed within the dot window. */
export function recentStatusChangeIds(map: StatusObservationMap, now: number): Set<string> {
  const out = new Set<string>();
  for (const [id, obs] of Object.entries(map)) {
    if (obs.at > 0 && now - obs.at < STATUS_CHANGE_DOT_WINDOW_S) out.add(id);
  }
  return out;
}

const STATUS_SEEN_KEY = "relay-outpost:feedback-status-seen:v1";

function loadStatusObservations(): StatusObservationMap {
  try {
    return JSON.parse(localStorage.getItem(STATUS_SEEN_KEY) || "{}") as StatusObservationMap;
  } catch { return {}; }
}

/** Storage wrapper around the pure fold: observe the current issue statuses,
 *  persist any changes, and return the ids that should show the "updated" dot.
 *  Deliberately does NOT dispatch the annotated event (it runs on every issue
 *  refresh — an event here would tick a re-render loop). */
export function observeIssueStatuses(
  observed: Array<{ id: string; status: FeedbackStatus }>,
  now: number = Math.floor(Date.now() / 1000),
): Set<string> {
  const { map, changed } = foldStatusObservations(loadStatusObservations(), observed, now);
  if (changed) {
    try { localStorage.setItem(STATUS_SEEN_KEY, JSON.stringify(map)); } catch {}
  }
  return recentStatusChangeIds(map, now);
}

export interface BuildIssueOpts {
  recipient: FeedbackRecipient;
  title: string;
  body: string;
  types: FeedbackType[];
  context: FeedbackContext | null;
}

export function buildIssueTemplate(opts: BuildIssueOpts) {
  const { recipient, title, body, types, context } = opts;
  const tags: string[][] = [
    ["subject", title.slice(0, 200)],
    ["t", FEEDBACK_TOPIC_TAG],
    ...types.map((t) => ["t", t]),
    ...clientTags(),
  ];
  if (recipient.operatorPubkey && recipient.repoD) {
    tags.unshift(["a", repoCoord(recipient.operatorPubkey, recipient.repoD), recipient.relay]);
    tags.push(["p", recipient.operatorPubkey]);
  } else if (recipient.operatorPubkey) {
    tags.push(["p", recipient.operatorPubkey]);
  }
  const content = body + (context ? formatContextBlock(context) : "");
  return {
    kind: KIND_NIP34_ISSUE,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

export function buildKind1Mirror(opts: BuildIssueOpts & { issueEventId?: string }) {
  const { recipient, title, body, types, context, issueEventId } = opts;
  const tags: string[][] = [
    ["t", FEEDBACK_KIND1_TAG],
    ...types.map((t) => ["t", t]),
    ...clientTags(),
  ];
  if (recipient.operatorPubkey) tags.push(["p", recipient.operatorPubkey]);
  if (issueEventId) tags.push(["e", issueEventId, recipient.relay, "mention"]);
  const content = `[Feedback] ${title}\n\n${body}` + (context ? formatContextBlock(context) : "");
  return {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

export function buildCommentTemplate(opts: {
  issue: NostrEvent;
  body: string;
  recipient: FeedbackRecipient;
}) {
  const { issue, body, recipient } = opts;
  // NIP-22 generic comment (kind 1111) rooted on the issue. buildNip22CommentTags
  // sets K/E (root) + P (issue author). We add the repo coordinate (NIP-34 interop)
  // and make sure BOTH parties are p-tagged so each side's #p subscription catches
  // it (operator sees user replies; reporter sees operator replies).
  const tags = buildNip22CommentTags(issue, null, recipient.relay);
  if (recipient.operatorPubkey && recipient.repoD) {
    const coord = repoCoord(recipient.operatorPubkey, recipient.repoD);
    tags.push(["A", coord, recipient.relay]);
    tags.push(["a", coord, recipient.relay]);
  }
  // buildNip22CommentTags only sets an UPPERCASE "P" for the root author, which
  // a `#p` filter does NOT match. Add a LOWERCASE "p" for BOTH the reporter and
  // the operator so each side's inbox subscription ({"#p":[me]}) catches the
  // reply — this is what makes replies round-trip in both directions.
  for (const pk of [issue.pubkey, recipient.operatorPubkey]) {
    if (pk && !tags.some((t) => t[0] === "p" && t[1] === pk)) {
      tags.push(["p", pk]);
    }
  }
  return {
    kind: KIND_NIP22_COMMENT,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: body,
  };
}

/** Extract the root issue id a comment references — handles NIP-22 (uppercase E),
 *  plain `e`, and legacy NIP-34 `["e", id, relay, "root"]`. */
export function commentRootId(comment: NostrEvent): string | null {
  const upper = comment.tags.find((t) => t[0] === "E")?.[1];
  if (upper) return upper;
  const rootMarked = comment.tags.find((t) => t[0] === "e" && (t[3] === "root" || !t[3]))?.[1];
  return rootMarked || null;
}

export function buildStatusTemplate(opts: {
  issue: NostrEvent;
  status: FeedbackStatus;
  recipient: FeedbackRecipient;
  note?: string;
}) {
  const { issue, status, recipient, note } = opts;
  const kind =
    status === "resolved" ? KIND_NIP34_STATUS_RESOLVED :
    status === "closed" ? KIND_NIP34_STATUS_CLOSED :
    status === "draft" ? KIND_NIP34_STATUS_DRAFT :
    KIND_NIP34_STATUS_OPEN;
  const tags: string[][] = [
    ["e", issue.id, recipient.relay, "root"],
    ["p", issue.pubkey], // the reporter — so their #p inbox re-ingests the status
    ...clientTags(),
  ];
  // Also p-tag the operator (self). subscribeOperatorFeedback ingests by
  // #p:[operator]; on a no-repo relay there is no `a` coordinate to match, so
  // without this self p-tag the operator's OWN status change never round-trips
  // back into their inbox and the label silently reverts to "Open". Mirrors how
  // replies p-tag BOTH parties. (Skip when operator === reporter to avoid a dup.)
  if (recipient.operatorPubkey && recipient.operatorPubkey !== issue.pubkey) {
    tags.push(["p", recipient.operatorPubkey]);
  }
  // Keep the repo coordinate when a kind-30617 repo exists (NIP-34 interop + the
  // #a ingestion path). It complements — never substitutes for — the self p-tag.
  if (recipient.operatorPubkey && recipient.repoD) {
    tags.push(["a", repoCoord(recipient.operatorPubkey, recipient.repoD), recipient.relay]);
  }
  return {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: note || "",
  };
}

export function buildRepoAnnouncementTemplate(opts: {
  d: string;
  name: string;
  description: string;
  relay: string;
  topics?: string[];
}) {
  const { d, name, description, relay, topics = [FEEDBACK_TOPIC_TAG] } = opts;
  const tags: string[][] = [
    ["d", d],
    ["name", name],
    ["description", description],
    ["relays", relay],
    ...topics.map((t) => ["t", t]),
    ...clientTags(),
  ];
  return {
    kind: KIND_NIP34_REPO,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: "",
  };
}

/** A comment/rumor is a real message worth rendering only if it has body text.
 *  A status-ONLY private change is an empty-body kind-1111 rumor carrying just a
 *  `status` tag — it must update the ticket status but never render as a blank
 *  comment card. Applied at render time so counting logic still sees it. */
export function isRenderableComment(c: { content?: string }): boolean {
  return (c.content || "").trim().length > 0;
}

/** Drop empty-body (status-only) rumors from a comment list for display. */
export function renderableComments<T extends { content?: string }>(comments: T[]): T[] {
  return comments.filter(isRenderableComment);
}

export function statusFromKind(kind: number): FeedbackStatus | null {
  switch (kind) {
    case KIND_NIP34_STATUS_OPEN: return "open";
    case KIND_NIP34_STATUS_RESOLVED: return "resolved";
    case KIND_NIP34_STATUS_CLOSED: return "closed";
    case KIND_NIP34_STATUS_DRAFT: return "draft";
    default: return null;
  }
}

/** Honest, wire-faithful status labels. Each maps 1:1 onto its NIP-34 status
 *  kind so other Nostr clients agree on what a status event means:
 *    open (1630) · resolved (1631) · closed (1632) · draft (1633 → "Triaged").
 *  The old UI displayed resolved as "In progress" and open-vs-resolved were out
 *  of step with the wire kinds, so a status set here read as a DIFFERENT status
 *  in gitworkshop/other NIP-34 clients. "Triaged" is this product's label for
 *  the draft kind (an acknowledged-but-not-started ticket) — it does not claim a
 *  different kind, so it stays interoperable. */
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  closed: "Closed",
  draft: "Triaged",
};

export function statusLabel(status: FeedbackStatus): string {
  return FEEDBACK_STATUS_LABEL[status] ?? "Open";
}

/** The four canonical feedback statuses. A wire `status` tag can carry ANY
 *  string (a future/renamed status, another client's value, a typo), but the UI
 *  indexes STATUS_META by it — so an out-of-enum value reads back `undefined`
 *  and crashes the Feedback tab render. Never widen an untrusted string to
 *  FeedbackStatus without passing it through isFeedbackStatus first. */
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ["open", "resolved", "closed", "draft"];

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

export function readTitle(issue: NostrEvent): string {
  const subject = issue.tags.find((t) => t[0] === "subject")?.[1];
  if (subject) return subject;
  const firstLine = (issue.content || "").split("\n")[0].trim();
  return firstLine.slice(0, 120) || "(untitled)";
}

export function readTypes(issue: NostrEvent): FeedbackType[] {
  const known: FeedbackType[] = ["bug", "idea", "ux", "question"];
  const out: FeedbackType[] = [];
  for (const t of issue.tags) {
    if (t[0] === "t" && known.includes(t[1] as FeedbackType) && !out.includes(t[1] as FeedbackType)) {
      out.push(t[1] as FeedbackType);
    }
  }
  return out;
}

const recipientCache = new Map<string, FeedbackRecipient | null>();
const cacheStamps = new Map<string, number>();
const RECIPIENT_TTL = 5 * 60 * 1000;

export async function discoverRecipientForRelay(relayUrl: string, label?: string): Promise<FeedbackRecipient | null> {
  const stamp = cacheStamps.get(relayUrl) || 0;
  if (Date.now() - stamp < RECIPIENT_TTL && recipientCache.has(relayUrl)) {
    return recipientCache.get(relayUrl) || null;
  }
  const nip11 = await fetchNip11(relayUrl).catch(() => null);
  const operatorPubkey = nip11?.pubkey || null;
  const labelOut = label || nip11?.name || relayUrl.replace(/^wss?:\/\//, "");

  let repoD: string | null = null;
  let hasInbox = false;
  if (operatorPubkey) {
    repoD = await new Promise<string | null>((resolve) => {
      let found: string | null = null;
      const sub = pool.subscribeMany(
        [relayUrl],
        { kinds: [KIND_NIP34_REPO], authors: [operatorPubkey], "#t": [FEEDBACK_TOPIC_TAG], limit: 5 } as Filter,
        {
          onevent(e) {
            const d = e.tags.find((t) => t[0] === "d")?.[1];
            if (d && !found) found = d;
          },
          oneose() {
            try { sub.close(); } catch {}
            resolve(found);
          },
        }
      );
      setTimeout(() => { try { sub.close(); } catch {} resolve(found); }, 4000);
    });
    hasInbox = !!repoD;
  }

  const recipient: FeedbackRecipient = {
    label: labelOut,
    relay: relayUrl,
    operatorPubkey,
    repoD,
    hasInbox,
    description: nip11?.description,
  };
  recipientCache.set(relayUrl, recipient);
  cacheStamps.set(relayUrl, Date.now());
  return recipient;
}

export function invalidateRecipientCache(relayUrl?: string) {
  if (relayUrl) {
    recipientCache.delete(relayUrl);
    cacheStamps.delete(relayUrl);
  } else {
    recipientCache.clear();
    cacheStamps.clear();
  }
}

export async function discoverAllRecipients(): Promise<FeedbackRecipient[]> {
  const team = await discoverRecipientForRelay(RELAY_OUTPOST_TEAM_RELAY, "Relay Outpost team");
  // Always fall back to the known team pubkey so feedback is addressable even
  // when the relay's NIP-11 omits one (private + operator-console routing work).
  const teamOperator = team?.operatorPubkey || RELAY_OUTPOST_TEAM_PUBKEY;
  const teamFinal: FeedbackRecipient = {
    ...(team ?? {}),
    label: "Relay Outpost team",
    relay: RELAY_OUTPOST_TEAM_RELAY,
    operatorPubkey: teamOperator,
    repoD: team?.repoD || RELAY_OUTPOST_TEAM_REPO_D,
    hasInbox: !!teamOperator,
    description: team?.description,
  };

  const joined = getOutpostRelays();
  const others = await Promise.all(
    joined
      .filter((r) => r.url !== RELAY_OUTPOST_TEAM_RELAY)
      .map((r) => discoverRecipientForRelay(r.url, r.label))
  );
  return [teamFinal, ...others.filter((r): r is FeedbackRecipient => r !== null)];
}

export interface ThreadFetchHandle {
  close: () => void;
}

export function subscribeFeedbackThread(
  relayUrl: string,
  repoCoordValue: string,
  onUpdate: (events: NostrEvent[]) => void
): ThreadFetchHandle {
  const filter: Filter = { kinds: NIP34_FEEDBACK_KINDS, "#a": [repoCoordValue], limit: 200 } as Filter;
  const buffer = new Map<string, NostrEvent>();
  const sub = pool.subscribeMany([relayUrl], filter, {
    onevent(e) {
      const prev = buffer.get(e.id);
      if (!prev) {
        buffer.set(e.id, e);
        onUpdate(Array.from(buffer.values()));
      }
    },
    oneose() {
      onUpdate(Array.from(buffer.values()));
    },
  });
  return { close: () => { try { sub.close(); } catch {} } };
}

/** Open one subscription per (relay, filter) pair, merging all events into a
 *  single deduped buffer. Returns a handle that closes every sub. */
function subscribeMerged(
  relays: string[],
  filters: Filter[],
  onUpdate: (events: NostrEvent[]) => void,
): ThreadFetchHandle {
  const buffer = new Map<string, NostrEvent>();
  const uniqRelays = Array.from(new Set(relays.filter(Boolean)));
  const subs = uniqRelays.flatMap((relay) =>
    filters.map((filter) =>
      pool.subscribeMany([relay], filter, {
        onevent(e) {
          if (!buffer.has(e.id)) {
            buffer.set(e.id, e);
            onUpdate(Array.from(buffer.values()));
          }
        },
        oneose() {
          onUpdate(Array.from(buffer.values()));
        },
      })
    )
  );
  return { close: () => { for (const s of subs) { try { s.close(); } catch {} } } };
}

/**
 * Operator-side ingestion. Catches ALL feedback addressed to the operator by
 * `#p` (works even when the user's issue has no repo `a` coordinate and no
 * kind-30617 repo exists), plus the legacy `#a` path when a repo is present —
 * across the operated relay and the operator's read relays. This is the fix for
 * "the operator can't see the message."
 */
export function subscribeOperatorFeedback(
  operatorPubkey: string,
  operatedRelay: string,
  repoCoordValue: string | null,
  onUpdate: (events: NostrEvent[]) => void,
): ThreadFetchHandle {
  const relays = Array.from(new Set([operatedRelay, ...getReadRelays(operatorPubkey, [])]));
  const filters: Filter[] = [
    { kinds: NIP34_FEEDBACK_KINDS, "#p": [operatorPubkey], limit: 300 } as Filter,
  ];
  if (repoCoordValue) {
    filters.push({ kinds: NIP34_FEEDBACK_KINDS, "#a": [repoCoordValue], limit: 300 } as Filter);
  }
  return subscribeMerged(relays, filters, onUpdate);
}

/**
 * User-side ingestion for the "My tickets" inbox. Fetches the user's own
 * submitted issues plus every reply/status addressed back to them, across their
 * write+read relays and the relays of outposts they've joined.
 */
export function subscribeMyTickets(
  myPubkey: string,
  onUpdate: (events: NostrEvent[]) => void,
): ThreadFetchHandle {
  const relays = Array.from(new Set([
    ...getWriteRelays(myPubkey, []),
    ...getReadRelays(myPubkey, []),
    ...getOutpostRelays().map((r) => r.url),
  ]));
  const filters: Filter[] = [
    { kinds: [KIND_NIP34_ISSUE], authors: [myPubkey], "#t": [FEEDBACK_TOPIC_TAG], limit: 200 } as Filter,
    { kinds: [KIND_NIP22_COMMENT, KIND_NIP34_COMMENT, KIND_NIP34_STATUS_OPEN, KIND_NIP34_STATUS_RESOLVED, KIND_NIP34_STATUS_CLOSED, KIND_NIP34_STATUS_DRAFT], "#p": [myPubkey], limit: 300 } as Filter,
  ];
  return subscribeMerged(relays, filters, onUpdate);
}

/** Reconstruct the operator/relay a ticket was addressed to, from the issue's
 *  own tags — so the user can reply without re-running relay discovery. */
export function recipientFromIssue(issue: NostrEvent): FeedbackRecipient {
  const operatorPubkey = issue.tags.find((t) => t[0] === "p")?.[1] || null;
  const aTag = issue.tags.find((t) => t[0] === "a");
  let repoD: string | null = null;
  let relay = "";
  if (aTag) {
    const parts = (aTag[1] || "").split(":");
    repoD = parts[2] || null;
    relay = aTag[2] || "";
  }
  if (!relay) relay = issue.tags.find((t) => t[0] === "e" || t[0] === "E")?.[2] || "";
  return {
    label: relay.replace(/^wss?:\/\//, "") || "operator",
    relay,
    operatorPubkey,
    repoD,
    hasInbox: !!(operatorPubkey && repoD),
  };
}

// --- Private (NIP-17) tickets ------------------------------------------------
// A private ticket is a gift-wrapped issue rumor (kind 1621) carrying the same
// subject/t:feedback/type tags as a public issue; replies are gift-wrapped
// comment rumors (kind 1111) referencing it. Because the rumor kind is NOT a
// chat kind (14/15), the DM/Messages stack ignores it — private feedback never
// leaks into the user's DMs.

const FEEDBACK_DM_FALLBACK_RELAYS = [
  "wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://auth.nostr1.com",
];

function myDMRelays(myPubkey: string): string[] {
  const set = new Set<string>([
    ...getDMRelayListCached(myPubkey),
    ...getLocalDMRelays(),
    ...FEEDBACK_DM_FALLBACK_RELAYS,
  ]);
  return Array.from(set).filter(Boolean).slice(0, 8);
}

/** Send a private feedback ticket (gift-wrapped issue) to an operator.
 *  `types` accepts the extra "crash" topic used by the anonymous crash reporter
 *  (lib/crash-report.ts); `extraTags` lets that reporter attach a stable
 *  ["crash-sig", errorKey] group tag, and `extraRelays` guarantees delivery to
 *  the operator's own relay even when the operator has a kind-10050 inbox. */
export async function sendPrivateTicket(opts: {
  signer: any;
  myPubkey: string;
  operatorPubkey: string;
  title: string;
  body: string;
  types: (FeedbackType | "crash")[];
  context: FeedbackContext | null;
  extraTags?: string[][];
  extraRelays?: string[];
}) {
  const { signer, myPubkey, operatorPubkey, title, body, types, context } = opts;
  const tags: string[][] = [
    ["subject", title.slice(0, 200)],
    ["t", FEEDBACK_TOPIC_TAG],
    ...types.map((t) => ["t", t]),
    ...(opts.extraTags || []),
    ...clientTags(),
  ];
  const content = body + (context ? formatContextBlock(context) : "");
  return sendDM({ signer, senderPubkey: myPubkey, recipientPubkey: operatorPubkey, content, rumorKind: KIND_NIP34_ISSUE, extraTags: tags, extraRelays: opts.extraRelays });
}

/** Reply to (or set status on) a private ticket. */
export async function sendPrivateReply(opts: {
  signer: any;
  myPubkey: string;
  recipientPubkey: string;
  issueRumorId: string;
  body: string;
  statusTag?: FeedbackStatus;
}) {
  const { signer, myPubkey, recipientPubkey, issueRumorId, body, statusTag } = opts;
  const extraTags: string[][] = [
    ["E", issueRumorId],
    ["K", String(KIND_NIP34_ISSUE)],
    ...clientTags(),
  ];
  if (statusTag) extraTags.push(["status", statusTag]);
  return sendDM({ signer, senderPubkey: myPubkey, recipientPubkey, content: body, rumorKind: KIND_NIP22_COMMENT, extraTags });
}

/** Subscribe to private feedback addressed to me (operator or user), unwrapping
 *  gift wraps to feedback issue/comment rumors. */
export function subscribePrivateFeedback(
  signer: any,
  myPubkey: string,
  onUpdate: (rumors: UnwrappedRumor[]) => void,
): ThreadFetchHandle {
  if (!signer?.nip44 || !myPubkey) return { close: () => {} };
  fetchDMRelayList(myPubkey).catch(() => {});
  // Listen on the SAME broad set the notification path uses (DM relays + the
  // user's read relays + defaults), not just our DM-relay list. Operators don't
  // always publish the reply gift wrap to the user's exact kind-10050 relays, so
  // a DM-relays-only subscription could miss replies the notification layer
  // (which reads DEFAULT_RELAYS) already caught — leaving the thread one-sided.
  const relays = Array.from(new Set([
    ...myDMRelays(myPubkey),
    ...getReadRelays(myPubkey),
    ...DEFAULT_RELAYS,
  ])).filter(Boolean).slice(0, 12);
  const buffer = new Map<string, UnwrappedRumor>();
  const seenWrap = new Set<string>();
  const subs = relays.map((relay) =>
    pool.subscribeMany([relay], { kinds: [1059], "#p": [myPubkey], limit: 300 } as Filter, {
      onevent(e) {
        if (seenWrap.has(e.id)) return;
        seenWrap.add(e.id);
        unwrapGiftWrapRumor(signer, myPubkey, e).then((rumor) => {
          if (!rumor) return;
          const isIssue = rumor.kind === KIND_NIP34_ISSUE && rumor.tags.some((t) => t[0] === "t" && t[1] === FEEDBACK_TOPIC_TAG);
          const isComment = rumor.kind === KIND_NIP22_COMMENT && rumor.tags.some((t) => t[0] === "E");
          if (!isIssue && !isComment) return;
          if (!buffer.has(rumor.id)) {
            buffer.set(rumor.id, rumor);
            onUpdate(Array.from(buffer.values()));
          }
        }).catch(() => {});
      },
      oneose() {},
    })
  );
  return { close: () => { for (const s of subs) { try { s.close(); } catch {} } } };
}

/** Group unwrapped private rumors into tickets (same shape as public issues). */
export function hydratePrivateTickets(rumors: UnwrappedRumor[]): FeedbackIssue[] {
  const issues = new Map<string, FeedbackIssue>();
  const commentsByRoot = new Map<string, UnwrappedRumor[]>();
  for (const r of rumors) {
    if (r.kind === KIND_NIP34_ISSUE) {
      const ev = r as unknown as NostrEvent;
      issues.set(r.id, {
        event: ev,
        title: readTitle(ev),
        type: readTypes(ev),
        status: "open",
        reporter: r.pubkey,
        createdAt: r.created_at,
        latestActivityAt: r.created_at,
        contextBlock: parseContextBlock(r.content),
        comments: [],
        private: true,
      });
    } else if (r.kind === KIND_NIP22_COMMENT) {
      const root = r.tags.find((t) => t[0] === "E")?.[1];
      if (root) {
        if (!commentsByRoot.has(root)) commentsByRoot.set(root, []);
        commentsByRoot.get(root)!.push(r);
      }
    }
  }
  for (const [root, issue] of Array.from(issues.entries())) {
    const cs = (commentsByRoot.get(root) || []).sort((a, b) => a.created_at - b.created_at);
    // Keep the FULL rumor list (incl. status-only, empty-body rumors) so
    // latestActivityAt + the user-side unread count still register a status
    // change as activity. Empty-body rumors are stripped at RENDER time via
    // renderableComments so they don't show as blank cards (bug: private status
    // change posted an empty comment). status is read from every rumor's tag.
    let latest = issue.createdAt;
    let status: FeedbackStatus = "open";
    for (const c of cs) {
      latest = Math.max(latest, c.created_at);
      // Only trust a status tag whose value is one of the four canonical
      // statuses. An arbitrary wire string (from another NIP-34 client, a future
      // status, or a malformed rumor) must NOT flow into issue.status — the tab
      // renders STATUS_META[status], which is `undefined` for an unknown value
      // and would crash the whole Feedback tab.
      const st = c.tags.find((t) => t[0] === "status")?.[1];
      if (isFeedbackStatus(st)) status = st;
    }
    issue.comments = cs as unknown as NostrEvent[];
    issue.status = status;
    issue.latestActivityAt = latest;
  }
  return Array.from(issues.values()).sort((a, b) => b.latestActivityAt - a.latestActivityAt);
}

export function hydrateIssues(events: NostrEvent[]): FeedbackIssue[] {
  const issues = new Map<string, FeedbackIssue>();
  const commentsByRoot = new Map<string, NostrEvent[]>();
  const statusesByRoot = new Map<string, NostrEvent[]>();

  for (const e of events) {
    if (e.kind === KIND_NIP34_ISSUE) {
      issues.set(e.id, {
        event: e,
        title: readTitle(e),
        type: readTypes(e),
        status: "open",
        reporter: e.pubkey,
        createdAt: e.created_at,
        latestActivityAt: e.created_at,
        contextBlock: parseContextBlock(e.content),
        comments: [],
      });
    } else if (e.kind === KIND_NIP22_COMMENT || e.kind === KIND_NIP34_COMMENT) {
      const root = commentRootId(e);
      if (root) {
        if (!commentsByRoot.has(root)) commentsByRoot.set(root, []);
        commentsByRoot.get(root)!.push(e);
      }
    } else if (statusFromKind(e.kind)) {
      const root = e.tags.find((t) => t[0] === "e")?.[1];
      if (root) {
        if (!statusesByRoot.has(root)) statusesByRoot.set(root, []);
        statusesByRoot.get(root)!.push(e);
      }
    }
  }

  for (const [root, issue] of Array.from(issues.entries())) {
    const cs = commentsByRoot.get(root) || [];
    cs.sort((a, b) => a.created_at - b.created_at);
    issue.comments = cs;
    const ss = statusesByRoot.get(root) || [];
    let latest = issue.createdAt;
    if (cs.length > 0) latest = Math.max(latest, cs[cs.length - 1].created_at);
    if (ss.length > 0) {
      ss.sort((a, b) => b.created_at - a.created_at);
      issue.status = statusFromKind(ss[0].kind) || "open";
      latest = Math.max(latest, ss[0].created_at);
    }
    issue.latestActivityAt = latest;
  }

  return Array.from(issues.values()).sort((a, b) => b.latestActivityAt - a.latestActivityAt);
}

/** Stable identity for a private rumor when merging optimistic + real copies.
 *  Includes the `status` tag so two DIFFERENT status changes on one ticket (both
 *  empty-bodied) don't collapse into one, while an optimistic status and its real
 *  round-trip still dedupe to a single entry. */
export function privateRumorKey(r: UnwrappedRumor): string {
  const E = r.tags.find((t) => t[0] === "E")?.[1] || "";
  const status = r.tags.find((t) => t[0] === "status")?.[1] || "";
  return `${r.pubkey}|${r.kind}|${r.content}|${E}|${status}`;
}

/** THE inbox. Combine public feedback events + unwrapped private (NIP-17) rumors
 *  into one deduped, newest-first issue list — the exact list the Feedback tab
 *  renders AND the unread badge counts. Single source of truth so the tab and the
 *  badge can never diverge (the badge previously counted only #a-matched public
 *  issues, missing #p-only public issues and every private ticket). */
export function combineFeedbackIssues(
  events: NostrEvent[],
  privateRumors: UnwrappedRumor[],
): FeedbackIssue[] {
  const byId = new Map<string, NostrEvent>();
  for (const e of events) byId.set(e.id, e);
  const pub = hydrateIssues(Array.from(byId.values()));

  const seen = new Set<string>();
  const rumors: UnwrappedRumor[] = [];
  for (const r of privateRumors) {
    const key = privateRumorKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    rumors.push(r);
  }
  const priv = hydratePrivateTickets(rumors);

  return [...pub, ...priv].sort((a, b) => b.latestActivityAt - a.latestActivityAt);
}

const LAST_READ_KEY = "relay-outpost:feedback:last-read-by-thread";

function readLastReadMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_KEY) || "{}");
  } catch { return {}; }
}

function writeLastReadMap(map: Record<string, number>) {
  try { localStorage.setItem(LAST_READ_KEY, JSON.stringify(map)); } catch {}
}

export function getIssueLastRead(issueId: string): number {
  return readLastReadMap()[issueId] || 0;
}

export function markIssueRead(issueId: string, at: number = Math.floor(Date.now() / 1000)) {
  const m = readLastReadMap();
  m[issueId] = at;
  writeLastReadMap(m);
  try { window.dispatchEvent(new CustomEvent("relay-outpost:feedback-read", { detail: { issueId } })); } catch {}
}

export function markIssuesRead(issues: FeedbackIssue[]) {
  if (issues.length === 0) return;
  const m = readLastReadMap();
  const now = Math.floor(Date.now() / 1000);
  for (const i of issues) {
    m[i.event.id] = Math.max(m[i.event.id] || 0, i.latestActivityAt, now - 1);
  }
  writeLastReadMap(m);
  try { window.dispatchEvent(new CustomEvent("relay-outpost:feedback-read", { detail: { bulk: true } })); } catch {}
}

export function isIssueUnread(issue: FeedbackIssue): boolean {
  const last = getIssueLastRead(issue.event.id);
  if (last === 0) return true;
  return issue.latestActivityAt > last;
}

export function countUnread(_repoCoordValue: string, issues: FeedbackIssue[]): number {
  let count = 0;
  for (const i of issues) if (isIssueUnread(i)) count++;
  return count;
}

/** @deprecated kept for compat — marks every supplied issue as read */
export function markRepoRead(_repoCoordValue: string, _at?: number) {
  // intentionally no-op when called without issues; callers should switch to markIssuesRead.
}

export function tryEncodeNevent(eventId: string, relay: string, kind: number): string {
  try {
    return nip19.neventEncode({ id: eventId, relays: [relay], kind });
  } catch {
    return eventId;
  }
}

export type OpenFeedbackDrawerDetail = {
  initialRecipient?: FeedbackRecipient;
  initialType?: FeedbackType;
  initialTitle?: string;
};

export function openFeedbackDrawer(detail: OpenFeedbackDrawerDetail = {}) {
  try {
    window.dispatchEvent(new CustomEvent("relay-outpost:open-feedback", { detail }));
  } catch {}
}
