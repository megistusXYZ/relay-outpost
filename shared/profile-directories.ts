/**
 * Profile directories: relays that keep a copy of everyone's profile, so a
 * person can be found wherever they post. Stated once, for the client and
 * the server (shared/profile-directories.test.ts keeps it that way).
 *
 * Measured on the wire 2026-10-23 (seven well-known accounts, read-only):
 *  - purplepag.es        held most, but missed some profiles and relay lists;
 *  - profiles.nostr1.com was the most complete every time;
 *  - relay.nos.social    held profiles, follows, relay lists and mute lists;
 *  - user.kindpag.es     answered EMPTY for five of seven: an empty answer
 *                        that read as "this person has no relay list". Dropped.
 * Asked together, equally, so one of them being down never hides anyone.
 *
 * None of them keep app data (kind 30078: settings, bookmarks, read marks),
 * starter packs or badges: those are never asked of a directory.
 */

/** Profiles (0), follow lists (3), relay lists (10002), mute lists (10000). */
export const PROFILE_DIRECTORIES: readonly string[] = [
  "wss://purplepag.es",
  "wss://profiles.nostr1.com",
  "wss://relay.nos.social",
];

/**
 * The directories that also keep the other personal lists: private-message
 * relays (10050), groups (10009), trust map (10040), interests (10015),
 * bookmarks (10003), upload servers (10063). relay.nos.social doesn't.
 */
export const LIST_DIRECTORIES: readonly string[] = [
  "wss://purplepag.es",
  "wss://profiles.nostr1.com",
];
