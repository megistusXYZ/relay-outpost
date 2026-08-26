/**
 * The one failure in this change that the type system cannot see.
 *
 * Nine NIP-29 senders were widened from `Promise<boolean>` to
 * `Promise<{ok, error}>` so a relay's refusal reaches the person who pressed
 * the button. TypeScript does NOT error on a truthiness check against an
 * object, so a call site left as
 *
 *     const ok = await sendPutUser(...);
 *     if (!ok) { ...report failure... }
 *
 * compiles cleanly, is always falsy-negative, and reports SUCCESS forever. It
 * fails OPEN. `AdmissionQueue` had exactly that shape: un-destructured, a
 * refused admission would have toasted "<name> is in" and dropped them from the
 * queue for an approval the relay rejected.
 *
 * `npm run check` stays green through all of it, so this reads the source
 * instead. It is a crude test and it earns its place: it guards the one
 * mistake that is both easy to make and invisible to every other gate.
 *
 * Prove it can fail before trusting it: un-destructure any one call site and
 * watch this go red.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Senders that return `{ ok, error }` and must never be bound to a bare name. */
const RESULT_SENDERS = [
  "sendPutUser",
  "sendRemoveUser",
  "sendEditMetadata",
  "sendEditAccess",
  "sendGroupPin",
  "sendCreateInvite",
  "sendDeleteGroup",
  "sendJoinRequest",
  "sendLeaveRequest",
  "sendDeleteEvent",
  "sendCreateGroup",
];

const SRC = join(process.cwd(), "client", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("NIP-29 result-shape senders are always destructured", () => {
  const files = walk(SRC).filter((f) => !f.endsWith(join("lib", "nip29.ts")));

  it("binds no result-returning sender to a bare identifier", () => {
    // `const ok = await sendPutUser(` — the exact shape that fails open.
    const bad = new RegExp(
      String.raw`(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*await\s+(?:${RESULT_SENDERS.join("|")})\s*\(`,
    );
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (bad.test(line)) offenders.push(`${file.replace(SRC, "client/src")}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("guards a list that actually matches the senders in nip29.ts", () => {
    // A guard whose name list has drifted from the source guards nothing. This
    // is what stops the test above from passing because it is looking for
    // functions that no longer exist under those names.
    const nip29 = readFileSync(join(SRC, "lib", "nip29.ts"), "utf8");
    const missing = RESULT_SENDERS.filter(
      (name) => !new RegExp(String.raw`export async function ${name}\b`).test(nip29),
    );
    expect(missing).toEqual([]);
  });

  it("confirms every guarded sender really does return a result object", () => {
    // If one silently reverted to `Promise<boolean>`, the regex above would
    // keep passing while the fail-open hazard quietly returned.
    const nip29 = readFileSync(join(SRC, "lib", "nip29.ts"), "utf8");
    const notResultShaped = RESULT_SENDERS.filter((name) => {
      // Anchored on the name and non-greedy to the return annotation, because
      // slicing "up to the first {" finds the brace inside `Promise<{ ok: ...`
      // and truncates the signature before the thing being matched. (Written
      // the naive way first; it reported all eleven as broken while tsc was
      // green, which is the tell that the TEST was wrong.)
      const sig = new RegExp(
        String.raw`export async function ${name}\([\s\S]{0,400}?\):\s*Promise<\{\s*ok:\s*boolean`,
      );
      return !sig.test(nip29);
    });
    expect(notResultShaped).toEqual([]);
  });
});
