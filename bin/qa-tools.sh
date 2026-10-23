#!/usr/bin/env bash
# Deterministic QA evidence for a Laravel repo. Never fails the shell: every tool becomes one block
#   @@ <name> exit=<code> blocking=<1|0> [note]
#   <tail of the output>
# The engine parses the blocks; the Product Manager judges them. A tool that is not installed is SKIPPED, not failed.
# Tools: pint (style), larastan/phpstan (static analysis), pest via artisan (unit + feature + arch tests),
#        composer audit (known CVEs), hygiene (changed files only: debug calls, strict_types, layer rules),
#        tests-added (code changed but no test file changed), css (broken design tokens), security (patterns),
#        mutation (pest --mutate), e2e (Playwright).
# Env: QA_MUTATION=auto|1|0 (auto: only with pcov/xdebug), QA_E2E=auto|1|0 (auto: only when Playwright is set up),
#      QA_E2E_BLOCKING=1 (a failing E2E run blocks), QA_REQUIRE_TESTS=1|0 (default 1).
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

mut="${QA_MUTATION:-auto}"
if [ -x vendor/bin/pest ]; then
  drv=""; php -m 2>/dev/null | grep -qiE '^(pcov|xdebug)$' && drv=1
  if [ "$mut" = "1" ] || { [ "$mut" = "auto" ] && [ -n "$drv" ]; }; then block mutation 0 "advisory" -- vendor/bin/pest --mutate --covered-only
  elif [ "$mut" = "auto" ]; then skip mutation "no coverage driver (pcov or xdebug)"; fi
fi

e2e="${QA_E2E:-auto}"
if [ "$e2e" != "0" ]; then
  pwcfg=""; for f in playwright.config.ts playwright.config.js playwright.config.mjs; do [ -f "$f" ] && pwcfg="$f" && break; done
  if [ -n "$pwcfg" ] && [ -x node_modules/.bin/playwright ]; then
    blk=0; [ "${QA_E2E_BLOCKING:-0}" = "1" ] && blk=1
    block e2e "$blk" "playwright $pwcfg" -- node_modules/.bin/playwright test --reporter=line
  else skip e2e "playwright is not set up (run bin/e2e-scaffold.sh <root> --install)"; fi
fi

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
# tests-added: code of a layer that must be tested changed in this sprint, yet no test file changed
suggest() { # app/<Layer>/<Name>.php -> the test file that should exist
  local f="$1" cls; cls="$(basename "$f" .php)"
  case "$f" in
    app/Livewire/*) echo "tests/Feature/Livewire/${cls}Test.php" ;;
    app/Http/Controllers/*) echo "tests/Feature/${cls}Test.php" ;;
    app/*/*) echo "tests/Unit/$(printf '%s' "$f" | cut -d/ -f2)/${cls}Test.php" ;;
  esac
}
src=""
if [ -n "$changed" ]; then
  while IFS= read -r f; do
    case "$f" in
      app/Services/*|app/Repositories/*|app/DTOs/*|app/Validators/*|app/Policies/*|app/Support/*|app/Jobs/*|app/Http/Controllers/*|app/Livewire/*)
        case "$f" in *Interface.php|*Provider.php) ;; *) src="$src$f"$'\n' ;; esac ;;
    esac
  done <<< "$changed"
fi
src="$(printf '%s' "$src" | grep . || true)"
tests_changed="$(git ls-files -m -o --exclude-standard tests 2>/dev/null | grep -cE '\.(php|ts|js)$' || true)"
if [ "${QA_REQUIRE_TESTS:-1}" = "1" ] && [ -n "$src" ] && [ "${tests_changed:-0}" = "0" ]; then
  printf '@@ tests-added exit=1 blocking=1 %s source file(s) changed and no test file added\n' "$(printf '%s\n' "$src" | wc -l | tr -d ' ')"
  printf '%s\n' "$src" | head -n 6 | while IFS= read -r f; do printf '%s: write a Pest test for the public behaviour of %s\n' "$(suggest "$f")" "$f"; done
else
  printf '@@ tests-added exit=0 blocking=1 %s source file(s), %s test file(s) changed\n' "$(printf '%s' "$src" | grep -c . || true)" "${tests_changed:-0}"
fi

# css: design tokens written by a small model are the most likely to be invalid
css_changed="$(git ls-files -m -o --exclude-standard resources 2>/dev/null | grep -E '\.css$' || true)"
if [ -n "$css_changed" ]; then
  if command -v node >/dev/null 2>&1 && [ -f "$(dirname "$0")/css-check.js" ]; then
    CSSOUT="$(printf '%s\n' "$css_changed" | xargs node "$(dirname "$0")/css-check.js" 2>&1 || true)"
    if [ -n "$CSSOUT" ]; then printf '@@ css exit=1 blocking=1 %s changed css file(s)\n%s\n' "$(printf '%s\n' "$css_changed" | wc -l | tr -d ' ')" "$CSSOUT"
    else printf '@@ css exit=0 blocking=1 %s changed css file(s) checked\n' "$(printf '%s\n' "$css_changed" | wc -l | tr -d ' ')"; fi
  else skip css "node or css-check.js missing"; fi
fi

# security: severe patterns block, risky ones are advisory (reviewed by the PM)
SEV="$(mktemp)"; ADV="$(mktemp)"; trap 'rm -f "$HYG" "$SEV" "$ADV"' EXIT
sec_files="$(git ls-files -m -o --exclude-standard app routes resources 2>/dev/null | grep -E '\.(php|blade\.php)$' || true)"
if [ -n "$sec_files" ]; then
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    grep -nE '(^|[^A-Za-z0-9_>:$])(eval|unserialize|shell_exec|passthru|proc_open|popen|system|exec)\(|DB::unprepared\(' "$f" | sed "s#^#$f: #" | head -n 3 >> "$SEV"
    grep -nE '\{!!' "$f" | sed "s#^#$f: unescaped output {!! !!} (XSS risk unless the value is trusted): #" | head -n 2 >> "$ADV"
    grep -nE '(whereRaw|selectRaw|orderByRaw|havingRaw|DB::raw)\([^)]*\$' "$f" | sed "s#^#$f: raw SQL with a variable (use bindings): #" | head -n 2 >> "$ADV"
    grep -nE '(create|update|fill)\(\$request->all\(\)\)' "$f" | sed "s#^#$f: mass assignment from the whole request: #" | head -n 2 >> "$ADV"
  done <<< "$sec_files"
  if [ -s "$SEV" ]; then printf '@@ security exit=1 blocking=1 dangerous function in changed code\n'; head -n 20 "$SEV"
  elif [ -s "$ADV" ]; then printf '@@ security exit=1 blocking=0 risky patterns to review\n'; head -n 20 "$ADV"
  else printf '@@ security exit=0 blocking=1 %s changed files scanned\n' "$(printf '%s\n' "$sec_files" | wc -l | tr -d ' ')"; fi
fi
exit 0
