# Honesty run — 2026-11-17 (R4 and R5 reworded for the Outpost look)

Why: R4 allowed 10px text and greys faded to `/60`; R5 said "violet is for actions". The app now has a 12px floor with WCAG contrast on every word, ink for text and selection, Ember only for actions, links and status words, and the old violet retired (`client/src/no-old-violet.test.ts`). Rows reworded to match; `known-good.tsx` lost its `/60` greys (they now fail R4); `known-bad.tsx` gained one planted R5 defect (a `text-violet-600` heading) and the key gained R5.

Cold reviewers: two subagents given only the code-architect rubric, `references/overlay.md` and one fixture; never the answer key or earlier runs. Scored by `score-review.mjs`.

| Fixture | Report | Planted fails caught | False fails | Trap (C7) | Flags |
|---|---|---|---|---|---|
| known-bad | `report_bad.md` | 11/11 (R1–R9, S3, C5; R5 new) | 0 | pass | R10 raised as asked |
| known-good | `report_good.md` | — | 0 | pass | 6: C3, C5, C8, S3, R7, R9 — questions about the fixture's fixed relay list, a second member parser, an unused tier branch and unpinned record authors. None is a fail; worth hardening the fixture next time a row changes. |

**Outcome:** the reworded rows catch the planted defects, including the new one, and invent none in clean code.
