#!/usr/bin/env bash
# Prints the context bundle for one agent: rules, scope, slices, skills, repo snapshot.
# usage: ctx.sh <backend|frontend|qa> <absolute repo root>
set -euo pipefail

AGENT="${1:?agent}"
ROOT="${2:?root}"
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$AGENT" in backend|frontend|qa) ;; *) echo "invalid agent" >&2; exit 1 ;; esac
case "$ROOT" in /*) ;; *) echo "root must be absolute" >&2; exit 1 ;; esac
[ -d "$ROOT" ] || { echo "root not found: $ROOT" >&2; exit 1; }

PROJECT="$(basename "$ROOT")"

section() { printf '\n=====%s=====\n' "$1"; }

section PLANNER;  cat "$BASE/prompts/planner.md"
section CODER;    cat "$BASE/prompts/coder.md"
section MEMORY;   cat "$BASE/prompts/memory.md"
section SCOPE
{ cat "$BASE/scope/common.md"; echo; cat "$BASE/scope/$AGENT.md"; } | sed "s#yuyyuy-admin-web#$PROJECT#g"
section SLICES;   cat "$BASE/scope/$AGENT.slices.json"

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
  done < "$BASE/scope/$AGENT.skills"
else
  echo "No skills directory at $SKILLDIR"
fi

section SNAPSHOT
echo "Root: $ROOT"
if [ -f "$ROOT/composer.json" ]; then
  echo "composer require:"
  sed -n '/"require"/,/}/p' "$ROOT/composer.json" | head -20
fi
{ cd "$ROOT" && find app routes database resources config tests docs -maxdepth 5 -type f \
  -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null || true; } | sort | head -70 | sed "s#^#$ROOT/#" || true
section END
