/**
 * Your mute list, kept the same in every app: NIP-51 kind 10000, the format
 * Amethyst uses and Damus is matching (private entries NIP-44-encrypted to
 * yourself). The rules live in lib/mute-list.ts; this hook loads the list,
 * applies it on this device, and saves what you change here.
 *
 * - Load: the newest list from your write and read relays, the defaults and
 *   purplepag.es. "You have no list yet" is only believed when a relay really
 *   connected (lib/relay-reach.ts: EOSE isn't proof) and we've never seen a
 *   list for you; otherwise the list is "unknown" and nothing is saved over it.
 * - Apply: the synced list is what counts on this device (an unmute made in
 *   another app sticks here), plus changes made here that haven't synced yet.
 *   Hashtag and thread mutes go to the shared filter. Applying never saves.
 * - Save: one debounced, one-at-a-time path for every mute control in the app.
 *   Only what changed here since the last save is saved (changesBetween), into
 *   the encrypted half. Whatever planMuteSave refuses, or a failed publish,
 *   stays on this device with a note: never saved in public, never erasing.
 */
import { useEffect, useState } from "react";
import type { Event } from "nostr-tools";
import type { ISigner } from "applesauce-signers";
import { useNostrAuth } from "@/contexts/NostrAuthContext";
import { publishEvent, DEFAULT_RELAYS, throttledPoolSubscribe, verifySignedEventKind } from "@/lib/nostr";
import { getReadRelays, getWriteRelays } from "@/lib/outbox";
import { canReachRelay } from "@/lib/relay-reach";
import { signWithTimeout, withSignerTimeout, SIGNER_CRYPTO_TIMEOUT } from "@/lib/signer-timeout";
import {
  mutePubkey as localMutePubkey,
  unmutePubkey as localUnmutePubkey,
  getMutedPubkeys,
  addMutedKeyword as localAddKeyword,
  removeMutedKeyword as localRemoveKeyword,
  getMutedKeywords,
  onMuteChange,
  isMutedPubkey,
  setMutedHashtags,
  setMutedThreads,
} from "@/lib/spam-filter";
import {
  changesBetween,
  mutedFrom,
  planMuteSave,
  readMuteList,
  type DeviceMutes,
  type MuteChange,
  type MuteListBase,
  type MuteListState,
  type SelfCrypto,
} from "@/lib/mute-list";

const KIND_MUTE_LIST = 10000;
/** Archives replaceable lists; often still holds one other relays lost. */
const LIST_ARCHIVE_RELAYS = ["wss://purplepag.es"];
const FETCH_TIMEOUT_MS = 8_000;
const SAVE_DEBOUNCE_MS = 1_500;
/** Changes made here that haven't reached your list yet (MuteChange[]). */
const PENDING_KEY = "relay-outpost-mute-changes-pending";
const seenListKey = (pk: string) => `relay-outpost-mute-list-seen:${pk}`;
const migratedKey = (pk: string) => `relay-outpost-mute-list-migrated:${pk}`;

/** Why the last change didn't reach your saved list. */
export type MuteSyncNote = "not-loaded" | "unreadable" | "cannot-encrypt" | "publish-failed";

// ── Shared state: one list per signed-in account, many hook users ──────────
let base: MuteListBase = { status: "unknown" };
let loading = true;
let loadedFor: string | null = null;
let syncNote: MuteSyncNote | null = null;
let hashtags: string[] = [];
let threads: string[] = [];
/** This device's people and words as of the last sync: "changed here" is measured from it. */
let lastSynced: DeviceMutes = { pubkeys: [], words: [] };
/** Hashtag and thread unmutes asked for on the Muted page, waiting to be saved. */
let explicitChanges: MuteChange[] = [];
/** True while the synced list is applied to this device: those aren't your changes. */
let applying = false;
let session: { pubkey: string; signer: ISigner | null } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: the in-memory state still applies */
  }
}

const pendingChanges = () => readJson<MuteChange[]>(PENDING_KEY, []);
const setPending = (changes: MuteChange[]) => writeJson(PENDING_KEY, changes);
const deviceMutesNow = (): DeviceMutes => ({ pubkeys: getMutedPubkeys(), words: getMutedKeywords() });

/** Your signer, as the "encrypt to myself" the list format needs (timed, so a silent signer can't hang it). */
function selfCrypto(signer: ISigner | null, pubkey: string): SelfCrypto {
  if (!signer) return {};
  const timed = <T,>(p: Promise<T>, what: string) => withSignerTimeout(p, SIGNER_CRYPTO_TIMEOUT, what);
  const { nip44, nip04 } = signer;
  return {
    nip44: nip44 && {
      encrypt: (plaintext: string) => timed(nip44.encrypt(pubkey, plaintext), "encrypt your mute list"),
      decrypt: (ciphertext: string) => timed(nip44.decrypt(pubkey, ciphertext), "read your mute list"),
    },
    nip04: nip04 && {
      decrypt: (ciphertext: string) => timed(nip04.decrypt(pubkey, ciphertext), "read your mute list"),
    },
  };
}

function listRelays(pubkey: string): string[] {
  return Array.from(new Set([
    ...getWriteRelays(pubkey),
    ...getReadRelays(pubkey),
    ...DEFAULT_RELAYS,
    ...LIST_ARCHIVE_RELAYS,
  ]));
}

/** Your newest mute list, and whether any relay actually answered. */
async function fetchNewestList(pubkey: string): Promise<{ event: Event | null; reached: boolean }> {
  const relays = listRelays(pubkey);
  // Connecting is the proof a relay answered; an EOSE isn't (lib/relay-reach.ts).
  const reachable = (
    await Promise.all(relays.map(async (r) => ((await canReachRelay(r, FETCH_TIMEOUT_MS)) ? r : null)))
  ).filter((r): r is string => !!r);
  if (reachable.length === 0) return { event: null, reached: false };
  const event = await new Promise<Event | null>((resolve) => {
    let best: Event | null = null;
    let done = false;
    let sub: { close(): void } | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      try { sub?.close(); } catch { /* already closed */ }
      resolve(best);
    };
    sub = throttledPoolSubscribe(reachable, { kinds: [KIND_MUTE_LIST], authors: [pubkey] }, {
      onevent(e: Event) {
        if (e.pubkey === pubkey && e.kind === KIND_MUTE_LIST && (!best || e.created_at > best.created_at)) best = e;
      },
      oneose: finish,
    });
    setTimeout(finish, FETCH_TIMEOUT_MS);
  });
  return { event, reached: true };
}

/**
 * Make this device match your list: the synced people and words, then the
 * changes made here that haven't synced yet. Hashtags and threads go to the
 * shared filter. Never schedules a save.
 */
function applyToDevice(list: MuteListState | null) {
  const synced = list ? mutedFrom(list) : null;
  const wantPeople = new Set(synced?.pubkeys ?? []);
  const wantWords = new Set(synced?.words ?? []);
  for (const c of pendingChanges()) {
    const set = c.tag[0] === "p" ? wantPeople : c.tag[0] === "word" ? wantWords : null;
    const value = c.tag[0] === "word" ? c.tag[1].toLowerCase() : c.tag[1];
    if (set) c.action === "add" ? set.add(value) : set.delete(value);
  }
  applying = true;
  try {
    for (const pk of getMutedPubkeys()) if (!wantPeople.has(pk)) localUnmutePubkey(pk);
    for (const pk of wantPeople) if (!isMutedPubkey(pk)) localMutePubkey(pk);
    const haveWords = new Set(getMutedKeywords());
    for (const w of haveWords) if (!wantWords.has(w)) localRemoveKeyword(w);
    for (const w of wantWords) if (!haveWords.has(w)) localAddKeyword(w);
    hashtags = [...(synced?.hashtags ?? [])];
    threads = [...(synced?.threads ?? [])];
    setMutedHashtags(hashtags);
    setMutedThreads(threads);
  } finally {
    applying = false;
  }
  lastSynced = { pubkeys: [...(synced?.pubkeys ?? [])], words: [...(synced?.words ?? [])] };
}

/**
 * Once per account: people and words muted on this device before the list was
 * shared (or that never made it into it) become changes waiting to sync, so
 * they're kept rather than dropped. Keeping a mute is safer than losing one.
 */
function migrateOnce(pubkey: string, list: MuteListState | null) {
  if (readJson(migratedKey(pubkey), false)) return;
  writeJson(migratedKey(pubkey), true);
  const synced = list ? mutedFrom(list) : null;
  const adds = changesBetween(
    { pubkeys: [...(synced?.pubkeys ?? [])], words: [...(synced?.words ?? [])] },
    deviceMutesNow(),
  ).filter((c) => c.action === "add");
  if (adds.length > 0) setPending([...pendingChanges(), ...adds]);
}

async function load(pubkey: string, signer: ISigner | null) {
  loading = true;
  notify();
  const { event, reached } = await fetchNewestList(pubkey);
  if (session?.pubkey !== pubkey) return;
  if (event) {
    writeJson(seenListKey(pubkey), true);
    const list = await readMuteList(event, selfCrypto(signer, pubkey));
    if (session?.pubkey !== pubkey) return;
    base = { status: "loaded", list };
    syncNote = list.privateReadable ? null : "unreadable";
    migrateOnce(pubkey, list);
    applyToDevice(list);
  } else if (reached && !readJson(seenListKey(pubkey), false)) {
    // The relays answered and you've never had a list: a genuinely new one.
    base = { status: "none" };
    migrateOnce(pubkey, null);
    applyToDevice(null);
  } else {
    // Couldn't get it: keep this device's mutes as they are and save nothing
    // over a list we never saw.
    base = { status: "unknown" };
    lastSynced = deviceMutesNow();
  }
  loading = false;
  notify();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveChain = saveChain.then(saveNow, saveNow);
  }, SAVE_DEBOUNCE_MS);
}

/** Save what changed here since the last sync, or keep it on this device and say why. */
async function saveNow(): Promise<void> {
  const s = session;
  if (!s) return;
  const changes = [...changesBetween(lastSynced, deviceMutesNow()), ...explicitChanges];
  if (changes.length === 0) return;
  const keepHere = (note: MuteSyncNote) => {
    syncNote = note;
    setPending(changes.filter((c) => c.tag[0] === "p" || c.tag[0] === "word"));
    notify();
  };
  let plan: Awaited<ReturnType<typeof planMuteSave>>;
  try {
    plan = await planMuteSave(base, changes, selfCrypto(s.signer, s.pubkey));
  } catch {
    return keepHere("cannot-encrypt"); // the signer declined or never answered
  }
  if (!plan.ok) return keepHere(plan.reason);
  if (!s.signer) return keepHere("cannot-encrypt");
  try {
    const signed = await signWithTimeout(s.signer, { ...plan.template, created_at: Math.floor(Date.now() / 1000) });
    if (!verifySignedEventKind(signed, KIND_MUTE_LIST)) throw new Error("the signer returned a different kind");
    if (!(await publishEvent(signed, listRelays(s.pubkey)))) throw new Error("no relay accepted the list");
  } catch {
    return keepHere("publish-failed");
  }
  if (session !== s) return;
  base = { status: "loaded", list: plan.next };
  writeJson(seenListKey(s.pubkey), true);
  const synced = mutedFrom(plan.next);
  lastSynced = { pubkeys: [...synced.pubkeys], words: [...synced.words] };
  hashtags = [...synced.hashtags];
  threads = [...synced.threads];
  explicitChanges = [];
  setPending([]);
  syncNote = null;
  applying = true;
  try {
    setMutedHashtags(hashtags);
    setMutedThreads(threads);
  } finally {
    applying = false;
  }
  notify();
}

function listenForChanges() {
  if (stopListening) return;
  stopListening = onMuteChange(() => {
    notify();
    if (!applying && session) scheduleSave();
  });
}

// ── The controls, shared by every hook user ────────────────────────────────
async function mutePubkey(pubkey: string) { localMutePubkey(pubkey); }
async function unmutePubkey(pubkey: string) { localUnmutePubkey(pubkey); }
async function addKeyword(keyword: string) { localAddKeyword(keyword.toLowerCase().trim()); }
async function removeKeyword(keyword: string) { localRemoveKeyword(keyword.toLowerCase().trim()); }

/** Unmute a hashtag or thread (usually muted in another app): hidden no more, and saved. */
function unmuteListEntry(kind: "t" | "e", value: string) {
  explicitChanges = [...explicitChanges, { action: "remove", tag: [kind, value] }];
  applying = true;
  try {
    if (kind === "t") setMutedHashtags((hashtags = hashtags.filter((h) => h !== value)));
    else setMutedThreads((threads = threads.filter((t) => t !== value)));
  } finally {
    applying = false;
  }
  notify();
  scheduleSave();
}
async function unmuteHashtag(hashtag: string) { unmuteListEntry("t", hashtag); }
async function unmuteThread(threadId: string) { unmuteListEntry("e", threadId); }

export function useNostrMuteList() {
  const { pubkey, signer } = useNostrAuth();
  const [, rerender] = useState(0);

  useEffect(() => {
    const listener = () => rerender((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!pubkey) {
      if (session) {
        session = null;
        base = { status: "unknown" };
        loadedFor = null;
        syncNote = null;
        explicitChanges = [];
        applying = true;
        try {
          setMutedHashtags((hashtags = []));
          setMutedThreads((threads = []));
        } finally {
          applying = false;
        }
      }
      loading = false;
      notify();
      return;
    }
    session = { pubkey, signer: signer ?? null };
    listenForChanges();
    if (loadedFor === pubkey) return;
    loadedFor = pubkey;
    void load(pubkey, signer ?? null).then(() => {
      // Couldn't get the list: try again the next time the list is needed.
      if (base.status === "unknown") loadedFor = null;
    });
  }, [pubkey, signer]);

  return {
    mutedPubkeys: getMutedPubkeys(),
    mutedKeywords: getMutedKeywords(),
    mutedHashtags: hashtags,
    mutedThreads: threads,
    isLoading: loading,
    /** Why the last change stayed on this device, or null when your list is in sync. */
    syncNote,
    isMuted: isMutedPubkey,
    mutePubkey,
    unmutePubkey,
    addKeyword,
    removeKeyword,
    unmuteHashtag,
    unmuteThread,
  };
}
