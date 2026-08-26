/**
 * Every <button>/<Button> inside a <form> must carry an explicit `type`.
 *
 * THE BUG THIS PINS. In HTML, a button inside a form defaults to
 * type="submit", and pressing Enter in a text field triggers the form's
 * DEFAULT submit button — the first one in DOM order, regardless of what CSS
 * shows. ImportKeyFlow's Back button had no type and sat before Continue in
 * the tree (flex-col-reverse only flips the visuals), so Enter in the
 * passphrase field "clicked" BACK: it ran clearImportDraft() and exited the
 * flow. A user who had just pasted a 162-char ncryptsec and typed their
 * passphrase watched the whole form vanish. Reported as "enter clears it and
 * doesn't register as hitting continue".
 *
 * WHY A SOURCE TEST. No ESLint in this repo (react/button-has-type never
 * runs), no @testing-library to render and press Enter. The property is
 * narrow and always true: inside a form, an implicit submit button is never a
 * deliberate choice in this codebase — the deliberate ones are written
 * type="submit".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { globSync } from "glob";

interface Violation { file: string; line: number; attrs: string }

function scan(): { forms: number; violations: Violation[] } {
  let forms = 0;
  const violations: Violation[] = [];
  for (const file of globSync("client/src/**/*.tsx")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<form\b/g)) {
      forms++;
      const start = m.index ?? 0;
      const end = src.indexOf("</form>", start);
      const seg = src.slice(start, end === -1 ? src.length : end);
      const lineBase = src.slice(0, start).split("\n").length;
      for (const b of seg.matchAll(/<(Button|button)\b([^>]*?)\/?>/gs)) {
        if (!/\btype=/.test(b[2])) {
          violations.push({
            file,
            line: lineBase + seg.slice(0, b.index ?? 0).split("\n").length - 1,
            attrs: b[2].trim().slice(0, 80),
          });
        }
      }
    }
  }
  return { forms, violations };
}

describe("buttons inside forms declare their type", () => {
  const { forms, violations } = scan();

  it("actually finds forms — a scanner that matches nothing passes forever", () => {
    // ImportKeyFlow alone has two; the repo has more. If this drops to zero
    // the regex or the glob broke, not the codebase.
    expect(forms).toBeGreaterThanOrEqual(2);
  });

  it("finds no untyped button inside any form", () => {
    expect(violations.map((v) => `${v.file}:${v.line} <Button ${v.attrs}>`)).toEqual([]);
  });
});
