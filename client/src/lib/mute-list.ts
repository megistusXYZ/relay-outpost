/**
 * Your mute list, the same in every app.
 *
 * The shared format is NIP-51's mute list (kind 10000), the one Amethyst uses
 * and Damus is matching ("Regular Nip44-encrypted nip51 lists", Vitor
 * Pamplona): public entries in the tags; private entries as the same tag list,
 * JSON, encrypted to yourself in the content. Entries are ["p", pubkey],
 * ["t", hashtag], ["word", word] and ["e", thread id]. See mute-list.test.ts.
 */

/** Encrypt and decrypt to yourself, as your signer does. */
export interface SelfCrypto {
  nip44?: {
    encrypt(plaintext: string): Promise<string>;
    decrypt(ciphertext: string): Promise<string>;
  };
  /** Older lists' private part; only ever read, never written. */
  nip04?: {
    decrypt(ciphertext: string): Promise<string>;
  };
}

/** NIP-04 ciphertext carries its IV after "?iv="; NIP-44 is plain base64. */
function isNip04(ciphertext: string): boolean {
  return ciphertext.includes("?iv=");
}

/** A mute list, both halves. */
export interface MuteListState {
  /** Entries anyone can see (the event's tags). */
  publicTags: string[][];
  /** Entries only you can see (decrypted from the content). */
  privateTags: string[][];
  /**
   * False when the list has a private half we couldn't open (the signer
   * declined, or it's in a form this signer can't read). Its contents are
   * unknown, not empty: saving over it would erase them.
   */
  privateReadable: boolean;
}

export async function readMuteList(
  event: { tags: string[][]; content: string },
  crypto: SelfCrypto,
): Promise<MuteListState> {
  if (!event.content) return { publicTags: event.tags, privateTags: [], privateReadable: true };
  const decrypt = isNip04(event.content) ? crypto.nip04?.decrypt : crypto.nip44?.decrypt;
  try {
    if (!decrypt) throw new Error("no way to open this private half");
    const parsed: unknown = JSON.parse(await decrypt(event.content));
    if (!Array.isArray(parsed)) throw new Error("the private half isn't a tag list");
    const privateTags = parsed.filter(
      (t): t is string[] => Array.isArray(t) && t.every((x) => typeof x === "string"),
    );
    return { publicTags: event.tags, privateTags, privateReadable: true };
  } catch {
    // Unknown contents are never treated as empty: saving would erase them.
    return { publicTags: event.tags, privateTags: [], privateReadable: false };
  }
}

/**
 * What we know of your saved list before changing it:
 * - "loaded": we have it (both halves);
 * - "none":   the relays answered and you have no list yet;
 * - "unknown": we couldn't get it. Saving then would replace a list we never
 *   saw, so it's refused (the replaceable-event wipe).
 */
export type MuteListBase =
  | { status: "loaded"; list: MuteListState }
  | { status: "none" }
  | { status: "unknown" };

/** One change to the list: mute or unmute one entry, e.g. ["p", pubkey]. */
export interface MuteChange {
  action: "add" | "remove";
  tag: [string, string];
}

/** Either the list to publish, or why not. */
export type MuteSavePlan =
  | {
      ok: true;
      template: { kind: 10000; tags: string[][]; content: string };
      /** The list as it stands once saved, so it needn't be decrypted again. */
      next: MuteListState;
    }
  | { ok: false; reason: "not-loaded" | "unreadable" | "cannot-encrypt" };

const sameEntry = (a: string[], b: string[]) => a[0] === b[0] && a[1] === b[1];

/** The entries a mute list holds: people, hashtags, words and threads. */
const MUTE_ENTRY_KINDS = new Set(["p", "t", "word", "e"]);

/**
 * The list to publish after a change (or several, applied in order). The
 * whole list is replaced wherever it's saved, so every entry already in it,
 * from any app and in either half, is carried over.
 */
export async function planMuteSave(
  base: MuteListBase,
  change: MuteChange | MuteChange[],
  crypto: SelfCrypto,
): Promise<MuteSavePlan> {
  // Never loaded: we'd be replacing a list we never saw.
  if (base.status === "unknown") return { ok: false, reason: "not-loaded" };
  // A brand-new account has no list yet: start from an empty one.
  const list: MuteListState =
    base.status === "loaded" ? base.list : { publicTags: [], privateTags: [], privateReadable: true };
  // A private half we couldn't read would be replaced by our copy of nothing.
  if (!list.privateReadable) return { ok: false, reason: "unreadable" };
  // No NIP-44 on this signer: never fall back to saving your mutes in public.
  if (!crypto.nip44) return { ok: false, reason: "cannot-encrypt" };
  // Mutes that were public move into the private half (the owner's call:
  // public mute lists are a bad idea); any other tag stays where it was.
  const publicTags = list.publicTags.filter((t) => !MUTE_ENTRY_KINDS.has(t[0]));
  const privateTags = [...list.privateTags];
  for (const t of list.publicTags) {
    if (MUTE_ENTRY_KINDS.has(t[0]) && !privateTags.some((p) => sameEntry(p, t))) privateTags.push([...t]);
  }
  // Apply each change in order, into one save. Every mute entry is in the
  // private half by now, so an unmute removes it wherever it was kept.
  let kept = privateTags;
  for (const c of Array.isArray(change) ? change : [change]) {
    if (c.action === "add") {
      if (!kept.some((t) => sameEntry(t, c.tag))) kept = [...kept, [...c.tag]];
    } else {
      kept = kept.filter((t) => !sameEntry(t, c.tag));
    }
  }
  const content = await crypto.nip44.encrypt(JSON.stringify(kept));
  return {
    ok: true,
    template: { kind: 10000, tags: publicTags, content },
    next: { publicTags, privateTags: kept, privateReadable: true },
  };
}

/** What you mute on this device through the app's own controls: people and words. */
export interface DeviceMutes {
  pubkeys: string[];
  words: string[];
}

/**
 * The list changes that turn one view of this device's mutes into another:
 * people added or dropped, then words added or dropped (lowercased, as the
 * filter keeps them). Saving exactly the difference means entries from other
 * apps are never replaced by this device's view.
 */
export function changesBetween(before: DeviceMutes, after: DeviceMutes): MuteChange[] {
  const diff = (kind: string, was: Set<string>, now: Set<string>): MuteChange[] => [
    ...[...now].filter((v) => !was.has(v)).map((v): MuteChange => ({ action: "add", tag: [kind, v] })),
    ...[...was].filter((v) => !now.has(v)).map((v): MuteChange => ({ action: "remove", tag: [kind, v] })),
  ];
  const words = (list: string[]) => new Set(list.map((w) => w.toLowerCase()));
  return [
    ...diff("p", new Set(before.pubkeys), new Set(after.pubkeys)),
    ...diff("word", words(before.words), words(after.words)),
  ];
}

/** What the list mutes, from both halves. */
export interface Muted {
  pubkeys: Set<string>;
  words: Set<string>;
  hashtags: Set<string>;
  threads: Set<string>;
}

export function mutedFrom(list: MuteListState): Muted {
  const muted: Muted = { pubkeys: new Set(), words: new Set(), hashtags: new Set(), threads: new Set() };
  for (const [kind, value] of [...list.publicTags, ...list.privateTags]) {
    if (!value) continue;
    if (kind === "p") muted.pubkeys.add(value);
    else if (kind === "word") muted.words.add(value.toLowerCase());
    else if (kind === "t") muted.hashtags.add(value.toLowerCase());
    else if (kind === "e") muted.threads.add(value);
  }
  return muted;
}
