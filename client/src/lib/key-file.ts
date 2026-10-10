/**
 * Your key, as a file (owner, 2026-10-10, from the first-use review).
 *
 * One file, one name. It holds the key as text and nothing that needs a
 * second secret to open. The old "backup file" came in two shapes under one
 * filename: signup wrote the raw key next to an encrypted copy, and the
 * account page wrote only the encrypted copy — which an account that chose
 * Touch ID first could never open, because its password was random and never
 * shown. The file is the thing to guard; the password for this browser only
 * unlocks the copy kept here.
 *
 * "Check it works": the only feedback that settles whether a backup is a
 * backup is reading it back. checkBackup takes whatever they hand us (the
 * file's text, or the key pasted bare) and says whether it opens THIS account.
 */
import { getPublicKey, nip19 } from "nostr-tools";

export interface KeyFileInput {
  /** The name they chose; shown so the file says whose it is. */
  name: string;
  npub: string;
  nsec: string;
  relays: string[];
  createdAt: number;
}

export function buildKeyFile(input: KeyFileInput): string {
  const who = input.name.trim() || "(no name set)";
  const made = input.createdAt ? new Date(input.createdAt).toISOString().slice(0, 10) : "";
  const lines = [
    "RELAY OUTPOST — YOUR KEY",
    "========================",
    "",
    `Account:  ${who}`,
    `Address:  ${input.npub}`,
    ...(made ? [`Made on:  ${made}`] : []),
    "",
    "YOUR KEY",
    "--------",
    "This line IS the account. Anyone who has it can act as you.",
    "Nobody, including us, can bring it back if it is lost. We keep no copy.",
    "",
    input.nsec,
    "",
    "KEEP IT",
    "-------",
    "  - In a password manager, or printed and kept somewhere safe.",
    "  - Not in email, a shared folder, or your Downloads folder.",
    "  - Two copies in two places beats one perfect copy.",
    "",
    "TO GET BACK IN",
    "--------------",
    "  1. Open Relay Outpost on any phone or computer.",
    "  2. Choose \"Use existing account\".",
    "  3. Paste the line under YOUR KEY.",
    "",
    "Any other Nostr app can open this key too.",
    "",
  ];
  if (input.relays.length) {
    lines.push(
      "YOUR RELAYS",
      "-----------",
      "Where your posts and profile were being sent when this file was made.",
      "",
      ...input.relays.map((r) => `  - ${r}`),
      "",
    );
  }
  lines.push("Anything not in this file (wallet connections, settings) is set up again after you get back in.", "");
  return lines.join("\n");
}

export function keyFileName(npub: string): string {
  return `relay-outpost-key-${npub.slice(0, 12)}.txt`;
}

/** The key, wherever it sits in the text they hand back; null when there is none. */
export function findKeyInText(text: string): string | null {
  const m = /nsec1[02-9ac-hj-np-z]{6,}/i.exec(text ?? "");
  return m ? m[0].toLowerCase() : null;
}

export type BackupCheck = "opens" | "other-account" | "unreadable";

/** Does this text open the account whose public key is `expectedPubkey`? */
export function checkBackup(text: string, expectedPubkey: string): BackupCheck {
  const key = findKeyInText(text);
  if (!key) return "unreadable";
  try {
    const decoded = nip19.decode(key);
    if (decoded.type !== "nsec") return "unreadable";
    return getPublicKey(decoded.data) === expectedPubkey ? "opens" : "other-account";
  } catch {
    return "unreadable";
  }
}

/** Browser side: hand the file to the person. Kept apart so the rest is pure. */
export function saveKeyFile(text: string, npub: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = keyFileName(npub);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
