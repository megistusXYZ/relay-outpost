// The merge guard's verdict on a PR's check rollup (scripts/merge-pr.sh).
//
// Per check name, the LATEST run answers: GitHub cancels a duplicate run when
// two triggers land on the same commit a second apart, and a cancelled run
// that a later run superseded is not a failure (2026-10-11, #446). A re-run
// after a real failure counts the same way. A check still running means wait.
//
// Library: `verdict(rollup)`. CLI: JSON rollup on stdin; prints the answer;
// exit 0 = merge, 1 = did not pass, 2 = still running. Tested in merge-verdict.test.ts.

import { pathToFileURL } from "node:url";

const PASSING = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** @param {{name:string,status:string,conclusion:string|null,startedAt?:string}[]} rollup */
export function verdict(rollup) {
  const byName = new Map();
  rollup.forEach((r, i) => {
    const list = byName.get(r.name) ?? [];
    list.push({ ...r, order: i });
    byName.set(r.name, list);
  });
  const pending = [], failed = [], superseded = [], passed = [];
  for (const [name, runs] of byName) {
    runs.sort((a, b) => (Date.parse(a.startedAt ?? "") || a.order) - (Date.parse(b.startedAt ?? "") || b.order));
    const latest = runs[runs.length - 1];
    for (const r of runs.slice(0, -1)) {
      if (r.conclusion && !PASSING.has(r.conclusion)) superseded.push(`${name} (${r.conclusion} at ${r.startedAt ?? "?"})`);
    }
    if (latest.status !== "COMPLETED" || !latest.conclusion) pending.push(name);
    else if (PASSING.has(latest.conclusion)) passed.push(name);
    else failed.push(name);
  }
  return { ok: pending.length === 0 && failed.length === 0, pending, failed, superseded, passed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { input += c; });
  process.stdin.on("end", () => {
    const v = verdict(JSON.parse(input || "[]"));
    for (const s of v.superseded) console.log(`  superseded  ${s}`);
    for (const p of v.passed) console.log(`  SUCCESS  ${p}`);
    for (const p of v.pending) console.log(`  PENDING  ${p}`);
    for (const f of v.failed) console.log(`  FAILED  ${f}`);
    if (v.pending.length) console.error(`REFUSING: ${v.pending.length} check(s) still running. Wait for the answer.`);
    if (v.failed.length) console.error(`REFUSING: ${v.failed.length} check(s) did not pass.`);
    process.exit(v.ok ? 0 : v.pending.length ? 2 : 1);
  });
}
