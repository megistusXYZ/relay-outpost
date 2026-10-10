/**
 * One name for the thing that cannot be replaced (owner, 2026-10-10, from the
 * first-use review): "your key". The secret used to go by eight names across
 * sign-up, unlock and the account menu — password, passphrase, unlock key,
 * key, backup file, recovery code, username, npub — for at most three things,
 * and a newcomer built the wrong model from them. The lock that opens the copy
 * kept in this browser is "password for this browser", never a bare password
 * presented as the way back in.
 *
 * Source-reading on purpose: the words are the design. Prove it can fail by
 * putting "passphrase" in a string in any file below.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "client", "src");
const FILES = [
  "components/CreateAccountFlow.tsx",
  "components/UnlockScreen.tsx",
  "components/PasskeyEnrollmentCard.tsx",
  "components/KeyBackupActions.tsx",
  "components/KeyBackupNudge.tsx",
  "components/KeyBackupMoment.tsx",
  "pages/KeyBackup.tsx",
  "pages/Account.tsx",
  "pages/Tools.tsx",
  "lib/key-file.ts",
];
// Old names, as words people read (identifiers like handleSuggestPassphrase
// and test ids like input-passphrase are not words on screen).
const OLD_NAMES = [/passphrase/i, /recovery code/i, /backup file/i, /encrypted backup/i, /unlock key/i, /your keys/i];

function words(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*import .*$/gm, "");
}

describe("the key has one name on screen", () => {
  for (const f of FILES) {
    it(`${f} never calls it by an old name`, () => {
      const src = words(readFileSync(join(SRC, f), "utf8"));
      const hits: string[] = [];
      for (const re of OLD_NAMES) {
        const m = new RegExp(`(?<![A-Za-z-])${re.source}(?![A-Za-z-])`, "gi");
        for (const hit of src.matchAll(m)) hits.push(src.slice(Math.max(0, hit.index! - 30), hit.index! + 40).replace(/\s+/g, " "));
      }
      expect(hits).toEqual([]);
    });
  }
});
