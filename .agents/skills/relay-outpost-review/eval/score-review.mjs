// Scores a review written in the contract shape (ID first, then pass / flag /
// fail / n/a, then the reason) against the sealed answer key. Deterministic.
//   node score-review.mjs bad|good <answer-key.json> <report.md>   → exit 0 ok, 1 miss/false alarm/trap
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const VERDICT = /^\W*([A-Z]\d{1,2})\b\W*\s*(pass|flag|fail|n\/a|na)\b/i;

/** @returns {Record<string, "pass"|"flag"|"fail"|"n/a">} one verdict per ID; the first mention wins */
export function parseReport(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const m = VERDICT.exec(raw.trim());
    if (!m) continue;
    const id = m[1].toUpperCase();
    if (out[id]) continue;
    const v = m[2].toLowerCase();
    out[id] = v === "na" ? "n/a" : v;
  }
  return out;
}

/**
 * @param {"bad"|"good"} fixture
 * @param {{fails: string[], flags: string[], traps: string[]}} key planted fails, planted flags, rows that must never fail
 * @param {Record<string,string>} verdicts
 */
export function score(fixture, key, verdicts) {
  const missed = [], falseFails = [], trapViolations = [], softMisses = [];
  if (fixture === "bad") {
    for (const id of key.fails) if (verdicts[id] !== "fail") missed.push(id);
    for (const id of key.flags) if (!verdicts[id] || verdicts[id] === "pass" || verdicts[id] === "n/a") softMisses.push(id);
  } else {
    for (const [id, v] of Object.entries(verdicts)) if (v === "fail") falseFails.push(id);
  }
  for (const id of key.traps) if (verdicts[id] === "fail") trapViolations.push(id);
  const ok = missed.length === 0 && falseFails.length === 0 && trapViolations.length === 0;
  return { ok, missed, falseFails, trapViolations, softMisses };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [fixture, keyPath, reportPath] = process.argv.slice(2);
  const key = JSON.parse(readFileSync(keyPath, "utf8"));
  const verdicts = parseReport(readFileSync(reportPath, "utf8"));
  const s = score(fixture, key, verdicts);
  console.log(JSON.stringify({ fixture, verdicts, ...s }, null, 2));
  process.exit(s.ok ? 0 : 1);
}
