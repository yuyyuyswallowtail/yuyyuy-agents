#!/usr/bin/env bash
# Prints the context bundle for one agent: rules, scope, slices, skills, repo snapshot.
# usage: ctx.sh <database|backend|uiux|frontend|qa|pm> <absolute repo root>
set -euo pipefail

AGENT="${1:?agent}"
ROOT="${2:?root}"
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$AGENT" in database|backend|uiux|frontend|qa|pm) ;; *) echo "invalid agent" >&2; exit 1 ;; esac
case "$ROOT" in /*) ;; *) echo "root must be absolute" >&2; exit 1 ;; esac
[ -d "$ROOT" ] || { echo "root not found: $ROOT" >&2; exit 1; }

PROJECT="$(basename "$ROOT")"

section() { printf '\n=====%s=====\n' "$1"; }

section PLANNER;  cat "$BASE/prompts/planner.md"
section CODER;    cat "$BASE/prompts/coder.md"
section MEMORY;   cat "$BASE/prompts/memory.md"
section TEAM;     cat "$BASE/prompts/team.md"
section PM;       cat "$BASE/prompts/pm.md"
section SCOPE
{ cat "$BASE/scope/common.md"; echo; cat "$BASE/scope/$AGENT.md"; [ "$AGENT" = uiux ] && { echo; cat "$BASE/scope/frontend.md"; }; true; } | sed "s#yuyyuy-admin-web#$PROJECT#g"
section SLICES
if [ -f "$BASE/scope/$AGENT.slices.json" ]; then cat "$BASE/scope/$AGENT.slices.json"; else echo "[]"; fi
section SPRINTS;  php "$BASE/bin/sprints.php" "$BASE/scope"

section SKILLS
SKILLDIR="$ROOT/.claude/skills"
if [ -d "$SKILLDIR" ]; then
  echo "Skills directory: $SKILLDIR"
  echo "Installed: $(ls -1 "$SKILLDIR" | tr '\n' ' ')"
  n=0
  while IFS= read -r pat; do
    [ -n "$pat" ] || continue
    for d in "$SKILLDIR"/$pat; do
      [ -f "$d/SKILL.md" ] || continue
      n=$((n + 1)); [ "$n" -le 4 ] || break 2
      echo "--- SKILL $d/SKILL.md ---"
      head -c 1800 "$d/SKILL.md"; echo
    done
  done < "$( [ -f "$BASE/scope/$AGENT.skills" ] && echo "$BASE/scope/$AGENT.skills" || echo /dev/null )"
else
  echo "No skills directory at $SKILLDIR"
fi

section DEPS;     bash "$BASE/bin/deps.sh" "$ROOT"

section SNAPSHOT
echo "Root: $ROOT"
if [ -f "$ROOT/composer.json" ]; then
  echo "composer require:"
  sed -n '/"require"/,/}/p' "$ROOT/composer.json" | head -20
fi
# the role's own directories first: a flat alphabetical list would show only app/ and hide the rest
case "$AGENT" in
  database) FOCUS="database app/Models app/Enums config tests" ;;
  backend)  FOCUS="app routes database config tests" ;;
  uiux)     FOCUS="docs resources public" ;;
  frontend) FOCUS="resources app/Livewire routes public tests" ;;
  qa)       FOCUS="tests app routes database" ;;
  pm)       FOCUS="docs routes database app" ;;
esac
{ cd "$ROOT" && for d in $FOCUS app routes database resources config tests docs; do
    [ -e "$d" ] && find "$d" -maxdepth 5 -type f -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | sort | head -30
  done || true; } | awk '!seen[$0]++' | head -90 | sed "s#^#$ROOT/#" || true
section END
