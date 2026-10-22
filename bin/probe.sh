#!/usr/bin/env bash
# Read-only inspection of the installed code, so a model can VERIFY an API instead of guessing it.
# Reads base64 on stdin: one probe per line (max 5), prints a block per probe.
#   sig <Class> [method]            public method signatures via reflection
#   grep <text> <path>              fixed-string search (max 8 hits) under vendor/<v>/<p>, app, routes, config, database, resources, tests
#   doc <vendor/package> <file>     first 60 lines of README.md | UPGRADE.md | CHANGELOG.md of an installed package
#   pkg <vendor/package>            composer show
#   artisan <filter>                artisan command names containing filter
#   routes                          route:list without vendor routes
# usage: probe.sh <absolute repo root>   (stdin: base64 of the probe lines)
set -uo pipefail

ROOT="${1:?root}"
case "$ROOT" in /*) ;; *) echo "root must be absolute" >&2; exit 1 ;; esac
[ -d "$ROOT" ] || { echo "root not found" >&2; exit 1; }
cd "$ROOT"

in="$(base64 -d 2>/dev/null | tr '\r' '\n' | head -n 5)"
cap() { head -n "${1:-40}" | cut -c1-220; }

while IFS= read -r line; do
  [ -n "$line" ] || continue
  read -r kind a b <<< "$line"
  echo "--- probe: $line ---"
  case "$kind" in
    sig)
      [[ "$a" =~ ^\\?[A-Za-z_][A-Za-z0-9_]*(\\[A-Za-z_][A-Za-z0-9_]*)*$ ]] || { echo "rejected: invalid class name"; continue; }
      [ -z "${b:-}" ] || [[ "$b" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "rejected: invalid method name"; continue; }
      [ -f vendor/autoload.php ] || { echo "no vendor/autoload.php (composer install has not run)"; continue; }
      CLS="${a#\\}" METH="${b:-}" php -r '
        require "vendor/autoload.php";
        $c = getenv("CLS"); $m = getenv("METH");
        if (!class_exists($c) && !interface_exists($c) && !trait_exists($c) && !enum_exists($c)) { echo "class not found: $c\n"; exit(0); }
        $r = new ReflectionClass($c);
        echo ($r->isInterface() ? "interface " : ($r->isEnum() ? "enum " : "class ")), $r->getName();
        if ($r->getParentClass()) echo " extends ", $r->getParentClass()->getName();
        echo "\n";
        $n = 0;
        foreach ($r->getMethods(ReflectionMethod::IS_PUBLIC) as $x) {
          if ($m !== "" && strcasecmp($x->getName(), $m) !== 0) continue;
          $ps = array_map(fn($p) => ($p->getType() ? $p->getType() . " " : "") . ($p->isVariadic() ? "..." : "") . "$" . $p->getName() . ($p->isOptional() && !$p->isVariadic() ? " = ..." : ""), $x->getParameters());
          echo "  ", $x->isStatic() ? "static " : "", $x->getName(), "(", implode(", ", $ps), ")", $x->getReturnType() ? ": " . $x->getReturnType() : "", "\n";
          if (++$n >= 40) { echo "  ...\n"; break; }
        }
        if ($n === 0) echo "  (no matching public method)\n";
      ' 2>&1 | cap 45
      ;;
    grep)
      [[ "$a" =~ ^[A-Za-z0-9_:\\\>\$.@\ -]{1,80}$ ]] || { echo "rejected: invalid search text"; continue; }
      p="${b:-}"
      [[ "$p" =~ ^(vendor/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+|app|routes|config|database|resources|tests)(/[A-Za-z0-9._/-]*)?$ ]] && [[ "$p" != *..* ]] || { echo "rejected: path must be vendor/<v>/<p>, app, routes, config, database, resources or tests"; continue; }
      [ -e "$p" ] || { echo "path does not exist: $p"; continue; }
      grep -rnF -m 3 --include='*.php' --include='*.blade.php' --include='*.md' --include='*.js' --include='*.css' -- "$a" "$p" 2>/dev/null | head -n 8 | cap 8
      ;;
    doc)
      [[ "$a" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "rejected: package must be vendor/name"; continue; }
      case "${b:-}" in README.md|UPGRADE.md|CHANGELOG.md) ;; *) echo "rejected: file must be README.md, UPGRADE.md or CHANGELOG.md"; continue ;; esac
      [ -f "vendor/$a/$b" ] && head -n 60 "vendor/$a/$b" | cut -c1-200 || echo "not found: vendor/$a/$b"
      ;;
    pkg)
      [[ "$a" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "rejected: package must be vendor/name"; continue; }
      composer show "$a" 2>&1 | cap 25
      ;;
    artisan)
      [[ "${a:-}" =~ ^[A-Za-z0-9:_-]{0,30}$ ]] || { echo "rejected: invalid filter"; continue; }
      php artisan list --raw 2>&1 | awk '{print $1}' | grep -iF -- "${a:-}" | cap 40
      ;;
    routes)
      php artisan route:list --except-vendor 2>&1 | cap 60
      ;;
    *) echo "rejected: unknown probe '$kind'" ;;
  esac
done <<< "$in"
exit 0
