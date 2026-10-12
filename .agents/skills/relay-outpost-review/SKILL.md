---
name: relay-outpost-review
description: "Relay Outpost's own review overlay for code-architect's threshold mode: the twelve bars that have actually bitten this codebase (three relay outcomes, EOSE is not reachability, one word per thing, status words not pills, violet for actions, the modal-back contract, positive claims, the replaceable-event wipe rule, honest status, names and hooks without ESLint, a harness must be able to fail, just the rails). Use with code-architect on any pre-PR review in this repo; the Rise overlay is always n/a here. Carries a known-bad/known-good fixture and a scorer so the overlay can prove it catches a planted defect."
metadata:
  version: "1.0"
  updated: "2026-10-12"
---

# Relay Outpost review overlay

Use with the `code-architect` skill in **threshold mode**. Walk its universal core (C1–C8) and security rows (S1–S4), then `references/overlay.md` (R1–R12). Mark the Rise overlay (O1–O4) n/a.

**Report shape (contract):** one line per row, the ID first, then pass / flag / fail / n/a, then the reason: the smallest correction for a fail, the question for a flag. Fails are mandatory; flags never auto-reject; C7 never fails on the metric alone.

**Context first.** This is a React/Vite client over Nostr relays with an Express server, no ESLint, source-scan guard tests, and rigs in `ship/`. Several rows cite the memory or guard that made them; when a row and the code disagree, the row is the owner's decision until the owner says otherwise.

## Standing honesty test

`eval/known-bad.tsx` plants defects on seven fail rows and one flag row, with a C7 trap that must not fail; `eval/known-good.tsx` is the clean twin. A cold reviewer (a subagent given only the rubric and the file, never the key) writes a report; `eval/score-review.mjs` scores it against the sealed `eval/_answer_key.json`:

```bash
node .agents/skills/relay-outpost-review/eval/score-review.mjs bad .agents/skills/relay-outpost-review/eval/_answer_key.json <report.md>
```

Re-run it whenever a row changes. A miss is a finding about the row's wording or the fixture, never about the reviewer; fix that. Runs are recorded in `eval/runs/<date>/`. The scorer's own test: `scripts/relay-outpost-review-eval.test.ts`.

**First run 2026-10-12 (cold subagents):** known-bad 7/7 planted caught plus three real defects the key had missed (promoted to planted: 10/10); known-good hardened once by the reviewers (a hard-coded tier shown as a status word, a dead import, a duplicate append) before a 0-fail pass with one flag. Record in `eval/runs/2026-10-12/RUN_RECORD.md`.
