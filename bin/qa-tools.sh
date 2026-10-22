#!/usr/bin/env bash
# Deterministic QA evidence for a Laravel repo. Never fails the shell: every tool becomes one block
#   @@ <name> exit=<code> blocking=<1|0> [note]
#   <tail of the output>
# The engine parses the blocks; the Product Manager judges them. A tool that is not installed is SKIPPED, not failed.
# Tools: pint (style), larastan/phpstan (static analysis), pest via artisan (unit + feature + arch tests),
#        composer audit (known CVEs), hygiene (changed files only: debug calls, strict_types, layer rules).
# Optional (off by default, need a coverage driver): QA_MUTATION=1 runs `pest --mutate --covered-only`.
# usage: qa-tools.sh <absolute repo root>
set -uo pipefail

ROOT="${1:?root}"
case "$ROOT" in /*) ;; *) echo "root must be absolute" >&2; exit 1 ;; esac
[ -d "$ROOT" ] || { echo "root not found" >&2; exit 1; }
cd "$ROOT"

block() { # name blocking note -- command...
  local name="$1" blocking="$2" note="$3"; shift 4
  local out code
  out="$(timeout "${QA_TIMEOUT:-900}" "$@" 2>&1)"; code=$?
  printf '@@ %s exit=%s blocking=%s%s\n' "$name" "$code" "$blocking" "${note:+ $note}"
  printf '%s\n' "$out" | tail -n 30 | cut -c1-240
}
skip() { printf '@@ %s exit=0 blocking=0 SKIPPED: %s\n' "$1" "$2"; }

if [ -x vendor/bin/pint ]; then block pint 1 "" -- vendor/bin/pint --test; else skip pint "vendor/bin/pint not installed"; fi

if [ -x vendor/bin/phpstan ]; then
  cfg=""; for f in phpstan.neon phpstan.neon.dist phpstan.dist.neon; do [ -f "$f" ] && cfg="$f" && break; done
  if [ -n "$cfg" ]; then block phpstan 1 "config=$cfg" -- vendor/bin/phpstan analyse --no-progress --memory-limit=1G --error-format=raw
  else block phpstan 0 "no phpstan config: advisory level 5 on app/" -- vendor/bin/phpstan analyse app --level=5 --no-progress --memory-limit=1G --error-format=raw; fi
else skip phpstan "larastan/phpstan not installed"; fi

if [ -f artisan ]; then block tests 1 "" -- php artisan test --compact; else skip tests "no artisan file"; fi

if command -v composer >/dev/null 2>&1; then block audit 0 "advisory (needs network)" -- composer audit --no-interaction; else skip audit "composer not found"; fi

if [ "${QA_MUTATION:-0}" = "1" ] && [ -x vendor/bin/pest ]; then block mutation 0 "advisory" -- vendor/bin/pest --mutate --covered-only; fi

# hygiene: only files changed in this sprint (modified + untracked), so pre-existing starter-kit code never fails the gate
HYG="$(mktemp)"; trap 'rm -f "$HYG"' EXIT
changed="$(git ls-files -m -o --exclude-standard 2>/dev/null | grep -E '\.(php)$' | grep -E '^(app|routes|database|config|tests)/' || true)"
bad=""
if [ -n "$changed" ]; then
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    grep -nE '(^|[^A-Za-z0-9_>:$])(dd|dump|ray|var_dump|print_r)\(' "$f" | sed "s#^#$f: debug call left in: #" | head -n 3 >> "$HYG" 2>/dev/null
    case "$f" in app/*|database/*|routes/*) grep -q 'declare(strict_types=1)' "$f" || echo "$f: missing declare(strict_types=1)" >> "$HYG" ;; esac
    case "$f" in app/Http/Controllers/*|app/Livewire/*) grep -nE '^use App\\Models\\|DB::|::query\(\)' "$f" | sed "s#^#$f: layer violation (controller/component touches model or DB): #" | head -n 3 >> "$HYG" ;; esac
    case "$f" in app/*) grep -nE '(^|[^A-Za-z0-9_>:$])env\(' "$f" | sed "s#^#$f: env() outside config/: #" | head -n 2 >> "$HYG" ;; esac
  done <<< "$changed"
fi
if [ -s "$HYG" ]; then
  printf '@@ hygiene exit=1 blocking=1 %s changed php files\n' "$(printf '%s\n' "$changed" | wc -l | tr -d ' ')"
  head -n 30 "$HYG"
else
  printf '@@ hygiene exit=0 blocking=1 %s changed php files checked\n' "$(printf '%s' "$changed" | grep -c . || true)"
fi
exit 0
