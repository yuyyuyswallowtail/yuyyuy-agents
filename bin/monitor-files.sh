#!/usr/bin/env bash
# Live view of the files the agents create in the target project.
# Usage (host):  bash bin/monitor-files.sh [seconds]
# Override: PROJECT=~/n8n/workspace/yuyyuy-admin-web  MINUTES=240
PROJECT="${PROJECT:-$HOME/n8n/workspace/yuyyuy-admin-web}"
MINUTES="${MINUTES:-240}"
EVERY="${1:-10}"
P="$PROJECT"

count() { find "$P/$1" -type f 2>/dev/null | wc -l; }
EXCL=(-not -path '*/node_modules/*' -not -path '*/vendor/*' -not -path '*/.git/*' -not -path '*/storage/*' -not -path '*/public/build/*' -not -path '*/test-results/*' -not -path '*/playwright-report/*')

while true; do
  clear 2>/dev/null || printf '\033c'
  echo "== FILES  $(date '+%H:%M:%S')   $P =="
  [ -d "$P" ] || { echo "folder tidak ada: $P"; sleep "$EVERY"; continue; }
  echo
  echo "-- DOKUMEN PLAN (docs/agents/<role>/) --"
  found=0
  for d in "$P"/docs/agents/*/; do
    [ -d "$d" ] || continue; found=1
    printf "%-10s %3s file | terbaru: %s\n" "$(basename "$d")" "$(find "$d" -type f | wc -l)" \
      "$(find "$d" -type f -printf '%TH:%TM %f\n' | sort -r | head -1)"
  done
  [ "$found" = 1 ] || echo "(belum ada: dokumen ditulis setelah PM meng-APPROVE plan)"
  echo
  echo "-- RINGKASAN --"
  printf "app: %s  tests: %s  resources: %s  database: %s  docs/design: %s  routes: %s\n" \
    "$(count app)" "$(count tests)" "$(count resources)" "$(count database)" "$(count docs/design)" "$(count routes)"
  echo
  echo "-- BARU/BERUBAH (${MINUTES} menit terakhir, terbaru di atas) --"
  find "$P" -type f -mmin "-$MINUTES" "${EXCL[@]}" -not -path '*/docs/agents/*' \
    -printf '%TH:%TM:%TS  %6s B  %P\n' 2>/dev/null | sed -E 's/(:[0-9]{2})\.[0-9]+/\1/' | sort -r | head -20
  echo
  echo "-- GIT --"
  git -C "$P" branch --show-current 2>/dev/null
  git -C "$P" status -sb 2>/dev/null | head -10
  git -C "$P" log --oneline -3 2>/dev/null
  echo
  echo "-- SCREENSHOT QA --"
  ls -t "$P"/storage/e2e-screens 2>/dev/null | head -3
  sleep "$EVERY"
done
