# Honesty run — 2026-10-12 (first run of the Relay Outpost overlay)

Cold reviewers: subagents given only `evaluation_rubric.md` (C1–C8, S1–S4), `references/overlay.md` and the fixture; never the answer key. Scored by `score-review.mjs`.

| Fixture | Report | Planted fails caught | False fails | Trap (C7) | Flags |
|---|---|---|---|---|---|
| known-bad | `report_bad.md` | 7/7 of the original key; plus 3 real defects the key had not planted (R7 hard-coded tier shown as a status, S3 unvalidated relay-supplied tags, C5 a second trust phrasebook) → promoted to planted; 10/10 against the extended key | — | pass | R10 raised as asked |
| known-good v1 | `report_good_v1.md` | — | 0 | pass | 5: C5, C8, S3, R3, R9 — three were real fixture weaknesses (hard-coded `tier: "none"` rendered as "New here"; dead `pool` import; duplicate append on a second tap; "Pull to refresh" copy on a panel) |
| known-good v2 (hardened) | `report_good_v2.md` | — | 0 | pass | 1: C8 (`signer: any`, the repo's own convention) |

**Outcome:** the overlay catches every planted defect and does not invent one in clean code. The known-good was hardened once by the reviewers themselves, which is the fixture working. No row wording changed.
