# Working in this repo

## This repo is public: nothing private goes in it

Everything committed here is public and indexed: code, comments, commit
messages, PR titles and descriptions, `.gitignore` lines, test fixtures,
images. Edits and force-pushes don't take it back.

- **Never commit** internal plans, strategy or roadmap docs, security notes,
  screenshots, keys, tokens, `.env` files, or anything about where servers,
  clusters, private repos or files live.
- **Private material lives outside this folder**, never inside it, even
  untracked. Keep it beside the repo, not in it.
- **Add files by explicit path.** Never `git add .`, `git add -A` or a
  directory.
- **Commit messages and PR text describe what the code does**, nothing about
  infrastructure, people, accounts or private work.
- **An unfamiliar untracked folder or file is a stop sign.** Don't add it,
  don't name what's in it anywhere public, and ask the owner.

`server/repo-hygiene.test.ts` fails CI on some of this in tracked files; it
can't see commit messages, PR text or untracked folders, so this is on you.

## Merging: read the CI result, not a local run

**Never merge a PR without looking at its CI conclusion.** Use:

```bash
npm run merge <pr-number>
```

It refuses on red or still-running checks. `-- --force-red` overrides, and you
must first *prove* the failures are pre-existing by comparing against main's
latest run — say so in your message when you do.

This rule exists because it was broken, at scale. `main` sat red for **20
consecutive runs** while PR after PR was merged, because everyone read a green
local `npm test` and never opened the CI result. The two failures were real and
had been there the whole time.

Since the 2026-08-26 open-source flip, main IS branch-protected: the
`build-and-test` check is required and force-pushes are blocked, so GitHub now
enforces what this convention policed by hand. The convention stays anyway —
`npm run merge` reads the CI conclusion and says so out loud, and habits that
survive tooling changes are the ones that hold.

## Local Node is not CI's Node

Production is `node:20-slim`; CI and `.nvmrc` pin **Node 20**. A laptop on Node
22+ has globals Node 20 lacks (`WebSocket`, `sessionStorage`), so a test can
lean on one, pass locally, and fail only on CI. That is exactly what caused the
20 red runs.

If you can't switch Node versions:

```bash
npm run test:ci-globals
```

Runs the suite with those globals deleted. It catches the missing-global class
and nothing else — see `test/ci-globals.ts`. Real Node 20 in CI is still the
authority.

## The gates

| gate | bar |
|---|---|
| `npm test` | all green, no tolerated failures |
| `npm run test:ci-globals` | all green |
| `npm run check` | **0** type errors — any new one fails CI (burned down 90 → 0 by 2026-10-07; several were real bugs) |
| `npm run build` | green |

A baseline set above the real count is a check that can't fail. The tsc gate sat
at 123 while the count was 90, leaving room for 33 new errors to land unnoticed.
Ratchet it when you lower it.

## Verify on the wire

The defect that has dominated recent work: a relay fetch has three outcomes —
data, genuinely empty, and *we never got to ask* — and most code is written with
two, so the third collapses into the second and the UI states it confidently.
Full write-up and the shared primitive: `RELAY_REACHABILITY.md`,
`client/src/lib/relay-reach.ts`.

Two habits that follow from it:

- **EOSE is not a reachability signal.** nostr-tools fires `oneose` when a relay
  *fails* to connect; a dead relay EOSEs in ~150ms with zero events. Connecting
  (`pool.ensureRelay`) is the signal.
- **A test you wrote the mock for only proves you're consistent with yourself.**
  Every defect in that class was found by pointing something at a live relay or
  clicking in a browser — none by the 2585 passing tests. When you build a
  harness, prove it can fail before trusting that it passed.
