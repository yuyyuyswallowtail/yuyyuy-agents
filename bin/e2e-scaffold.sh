#!/usr/bin/env bash
# Adds Playwright E2E with one test user per role to a Laravel project (templates/e2e). Never overwrites existing files.
#   e2e-scaffold.sh <absolute repo root> [--install] [--force]
# --install also runs: npm install -D @playwright/test && npx playwright install chromium (needs network)
set -euo pipefail

ROOT="${1:?usage: e2e-scaffold.sh <absolute repo root> [--install] [--force]}"; shift || true
case "$ROOT" in /*) ;; *) echo "root must be absolute" >&2; exit 1 ;; esac
[ -f "$ROOT/artisan" ] || { echo "not a Laravel project: $ROOT" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$HERE/templates/e2e"
INSTALL=0; FORCE=0
for a in "$@"; do case "$a" in --install) INSTALL=1 ;; --force) FORCE=1 ;; esac; done

( cd "$SRC" && find . -type f | sort ) | while IFS= read -r rel; do
  rel="${rel#./}"; dst="$ROOT/$rel"
  if [ -e "$dst" ] && [ "$FORCE" != 1 ]; then echo "keep   $rel"; continue; fi
  mkdir -p "$(dirname "$dst")"; cp "$SRC/$rel" "$dst"; echo "write  $rel"
done

touch "$ROOT/.gitignore"
for l in /test-results /playwright-report /storage/e2e-users.json /storage/e2e-screens /database/e2e.sqlite; do
  grep -qxF "$l" "$ROOT/.gitignore" || { echo "$l" >> "$ROOT/.gitignore"; echo "ignore $l"; }
done

if [ "$INSTALL" = 1 ]; then
  cd "$ROOT"
  npm install -D @playwright/test
  npx playwright install chromium
fi

cat <<MSG
Next:
  1. DatabaseSeeder must create the Spatie roles (E2eUsersSeeder reads them from the roles table).
  2. Fill tests/e2e/access-matrix.json with the pages and which roles may open them.
  3. cd $ROOT && npx playwright test   (qa-tools.sh runs it automatically once it is set up)
MSG
