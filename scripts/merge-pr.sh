#!/usr/bin/env bash
#
# Merge a PR only if CI actually passed.
#
# WHY THIS EXISTS: main sat red for 20 consecutive runs while PR after PR was
# merged, because everyone read a green LOCAL `npm test` and never opened the
# CI result. GitHub's own answer to this — a required status check — needs
# branch protection or rulesets, and both are 403 on a private repo on the free
# plan. So this is the next best thing: make the default merge path look at the
# answer, and make ignoring it a deliberate act rather than an oversight.
#
#   npm run merge 572
#   npm run merge 572 -- --force-red     # override, loudly
#
# This is a guard rail, not a gate. Anyone can still run `gh pr merge`. It works
# because it is the documented path (see CLAUDE.md) and because the override has
# to be typed out.
set -euo pipefail

PR="${1:-}"
FORCE=false
for arg in "$@"; do [[ "$arg" == "--force-red" ]] && FORCE=true; done

if [[ -z "$PR" || "$PR" == --* ]]; then
  echo "usage: npm run merge <pr-number> [-- --force-red]" >&2
  exit 2
fi

echo "PR #$PR — reading CI before merging, not after."

ROLLUP=$(gh pr view "$PR" --json statusCheckRollup --jq '[.statusCheckRollup[]? | {name, status, conclusion}]')
COUNT=$(jq 'length' <<<"$ROLLUP")

if [[ "$COUNT" == "0" ]]; then
  # Real case, not an edge case: ci.yml has paths-ignore for '**.md', so a
  # docs-only PR legitimately has no run. Say so rather than blocking forever.
  echo "No checks reported. CI's paths-ignore skips docs-only changes — verify that's why."
else
  jq -r '.[] | "  \(.conclusion // .status)  \(.name)"' <<<"$ROLLUP"

  PENDING=$(jq '[.[] | select(.status != "COMPLETED")] | length' <<<"$ROLLUP")
  FAILED=$(jq '[.[] | select(.conclusion != null and .conclusion != "SUCCESS" and .conclusion != "NEUTRAL" and .conclusion != "SKIPPED")] | length' <<<"$ROLLUP")

  if [[ "$PENDING" != "0" ]]; then
    echo "REFUSING: $PENDING check(s) still running. Wait for the answer." >&2
    exit 1
  fi

  if [[ "$FAILED" != "0" ]]; then
    echo "REFUSING: $FAILED check(s) did not pass." >&2
    if [[ "$FORCE" != "true" ]]; then
      echo "If they're pre-existing and unrelated, PROVE it — compare against main's" >&2
      echo "latest run — then re-run with: npm run merge $PR -- --force-red" >&2
      exit 1
    fi
    echo "--force-red given: merging over a red CI deliberately." >&2
  fi
fi

INFO=$(gh pr view "$PR" --json headRefName,baseRefName,isCrossRepository)
HEAD_REF=$(jq -r '.headRefName' <<<"$INFO")
BASE_REF=$(jq -r '.baseRefName' <<<"$INFO")
CROSS=$(jq -r '.isCrossRepository' <<<"$INFO")

# PRs stacked on this one's branch follow it to its base first, so deleting
# the branch below can't strand or close them. GitHub only retargets them on
# its own when it deletes the branch itself, which --delete-branch didn't do
# from a detached worktree (see below).
for DEP in $(gh pr list --base "$HEAD_REF" --state open --json number --jq '.[].number'); do
  echo "Retargeting stacked #$DEP from $HEAD_REF to $BASE_REF."
  gh pr edit "$DEP" --base "$BASE_REF" >/dev/null
done

# No --delete-branch: in a detached worktree (the ship script's) gh merges,
# then fails to find a local branch ("not on any branch") and exits before
# deleting the remote one. It also switched a normal checkout to main. The
# state check below is the answer either way.
gh pr merge "$PR" --squash || echo "(gh pr merge exited nonzero — checking what actually happened)"

# Report what actually happened, not what we asked for. `gh pr merge` exits 0
# on an already-merged PR, so an unconditional "Merged." here would be a
# confident claim nobody checked — the same defect this script exists to stop.
STATE=$(gh pr view "$PR" --json state --jq '.state')
if [[ "$STATE" == "MERGED" ]]; then
  echo "#$PR is merged."
  # A fork's branch isn't ours to delete.
  if [[ "$CROSS" != "true" ]]; then
    if gh api -X DELETE "repos/{owner}/{repo}/git/refs/heads/$HEAD_REF" >/dev/null 2>&1; then
      echo "Deleted branch $HEAD_REF."
    else
      echo "Branch $HEAD_REF not deleted (already gone, or protected)."
    fi
  fi
else
  echo "#$PR is $STATE — NOT merged. Check the output above." >&2
  exit 1
fi
