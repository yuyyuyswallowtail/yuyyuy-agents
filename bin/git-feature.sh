#!/usr/bin/env bash
# Per-feature git flow. Never commits or pushes to main/master, never force-pushes.
#   git-feature.sh exists <root> <id>                  -> prints DONE or TODO
#   git-feature.sh ship   <root> <id> <base64 title>   -> branch feat/<id>, commit, push
#   git-feature.sh park   <root> <id> <base64 title>   -> branch wip/<id>-<timestamp> for a BLOCKED sprint, commit, push
set -euo pipefail

CMD="${1:-}"; ROOT="${2:-}"; ID="${3:-}"
printf '%s' "$ID" | grep -Eq '^[0-9]{2}[A-Z]?-[a-z0-9-]+$' || { echo "invalid feature id: $ID" >&2; exit 1; }
case "$ROOT" in /*) ;; *) echo "root must be absolute" >&2; exit 1 ;; esac
[ -e "$ROOT/.git" ] || { echo "not a git repo: $ROOT" >&2; exit 1; }
BRANCH="feat/$ID"
cd "$ROOT"

case "$CMD" in
  exists)
    if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then echo DONE; else echo TODO; fi
    ;;
  ship)
    TITLE="$(printf '%s' "${4:-}" | base64 -d | tr '\n\r' '  ' | cut -c1-100)"
    git config user.name  >/dev/null || git config user.name  "yuyyuy-agents"
    git config user.email >/dev/null || git config user.email "agents@localhost"
    if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
      echo "branch $BRANCH already exists" >&2; exit 1
    fi
    git switch -c "$BRANCH" >/dev/null 2>&1
    git add -A
    if git diff --cached --quiet; then echo "NOTHING $BRANCH"; exit 0; fi
    git commit -q -m "feat($ID): ${TITLE#*: }"
    git push -u origin "refs/heads/$BRANCH:refs/heads/$BRANCH" >/dev/null 2>&1 \
      || { echo "committed locally on $BRANCH but push failed" >&2; exit 2; }
    echo "PUSHED $BRANCH"
    ;;
  park)
    TITLE="$(printf '%s' "${4:-}" | base64 -d | tr '\n\r' '  ' | cut -c1-100)"
    PARK="wip/$ID-$(date +%Y%m%d%H%M%S)"
    git config user.name  >/dev/null || git config user.name  "yuyyuy-agents"
    git config user.email >/dev/null || git config user.email "agents@localhost"
    PREV="$(git rev-parse --abbrev-ref HEAD)"
    [ "$PREV" != "HEAD" ] || PREV="$(git rev-parse HEAD)"
    git switch -c "$PARK" >/dev/null 2>&1
    git add -A
    if git diff --cached --quiet; then
      git switch -q "$PREV"; git branch -q -D "$PARK"; echo "NOTHING $PARK"; exit 0
    fi
    git commit -q -m "wip($ID): BLOCKED, needs human review - ${TITLE#*: }"
    # return to the previous branch: the blocked work stays parked and never becomes the base of the next sprint
    PUSHED=1
    git push -u origin "refs/heads/$PARK:refs/heads/$PARK" >/dev/null 2>&1 || PUSHED=0
    git switch -q "$PREV"
    [ "$PUSHED" = 1 ] || { echo "committed locally on $PARK but push failed" >&2; exit 2; }
    echo "PARKED $PARK"
    ;;
  *) echo "usage: git-feature.sh exists|ship|park <root> <id> [b64 title]" >&2; exit 1 ;;
esac
