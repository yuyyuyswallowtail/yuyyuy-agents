#!/usr/bin/env bash
# Ground truth about the INSTALLED dependencies, for models whose training data predates them.
# Prints two blocks: installed versions (composer.lock / package-lock.json) and project-owned rules
# (scope/rules/_all.md + scope/rules/<vendor>__<package>.md for every installed package).
# usage: deps.sh <absolute repo root>
set -uo pipefail

ROOT="${1:?root}"
BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$ROOT" in /*) ;; *) echo "root must be absolute" >&2; exit 1 ;; esac

PKGS="laravel/framework livewire/livewire livewire/flux livewire/blaze laravel/fortify spatie/laravel-permission pestphp/pest larastan/larastan laravel/pint laravel/boost laravel/mcp laravel/dusk intervention/image-laravel league/commonmark"
NPM="tailwindcss vite @tailwindcss/vite alpinejs"

echo "Versions below are the REAL installed ones. Your training data is older than these releases."
echo "If your memory of an API conflicts with this block, the SKILLS, or a VERIFIED FACT, they win. Never invent an API: ask for a PROBE."

ROOT="$ROOT" PKGS="$PKGS" NPM="$NPM" php -r '
$root = getenv("ROOT");
echo "php runtime: ", PHP_VERSION, "\n";
$lock = $root . "/composer.lock";
if (!is_file($lock)) { echo "composer.lock: NOT FOUND (composer install has not run)\n"; }
else {
  $j = json_decode((string) file_get_contents($lock), true) ?: [];
  $all = array_merge($j["packages"] ?? [], $j["packages-dev"] ?? []);
  $by = []; foreach ($all as $p) { $by[$p["name"]] = $p["version"] ?? "?"; }
  foreach (explode(" ", getenv("PKGS")) as $n) {
    if (!isset($by[$n])) continue;
    $docs = [];
    foreach (["README.md", "UPGRADE.md", "CHANGELOG.md"] as $f) { if (is_file("$root/vendor/$n/$f")) $docs[] = $f; }
    echo "  $n $by[$n]", $docs ? "  [docs in vendor: " . implode(", ", $docs) . "]" : "", "\n";
  }
  echo "  (", count($by), " packages installed in total)\n";
}
$pl = $root . "/package-lock.json";
if (is_file($pl)) {
  $j = json_decode((string) file_get_contents($pl), true) ?: [];
  foreach (explode(" ", getenv("NPM")) as $n) {
    $v = $j["packages"]["node_modules/$n"]["version"] ?? null;
    if ($v) echo "  npm $n $v\n";
  }
}
'

echo
echo "PROJECT RULES (owned by this repo; they cover what the skills do not):"
shown=0
emit() { [ -f "$1" ] || return 0; echo "--- RULE $(basename "$1") ---"; head -c 1500 "$1"; echo; shown=$((shown + 1)); }
emit "$BASE/scope/rules/_all.md"
if [ -f "$ROOT/composer.lock" ]; then
  for p in $PKGS; do
    grep -q "\"name\": \"$p\"" "$ROOT/composer.lock" 2>/dev/null && emit "$BASE/scope/rules/${p//\//__}.md"
  done
fi
[ "$shown" -gt 0 ] || echo "(none yet)"
exit 0
