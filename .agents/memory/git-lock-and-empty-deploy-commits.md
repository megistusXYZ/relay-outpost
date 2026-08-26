---
name: git index.lock + empty deploy commits
description: Recurring git pane failure pattern in this repl and the safe fix sequence
---

# Stale index.lock + empty "Published your App" commits block pulls

Recurring pattern: the Git pane reports "index is currently locked", and pulls fail with MERGE_CONFLICT.

**Why:** Each Republish creates a local, *empty* "Published your App" commit (deployment checkpoint) that diverges from origin/main once task merges land on GitHub. The Git pane's interrupted pull also leaves a stale `.git/index.lock`.

**How to apply (safe sequence):**
1. `pgrep -a git` — confirm zero git processes before touching the lock.
2. `rm -f .git/index.lock`.
3. Check if HEAD is an empty deploy commit: `git diff --stat origin/main HEAD` prints nothing → empty; safe to `git reset --hard origin/main`.
4. Pull via the gitPull sandbox callback (CLI `git fetch` fails auth — creds live only in the callback), then restart the dev workflow.

Note: `grep -c '[g]it'` counts the pipeline itself — use `pgrep -a git` instead.
