#!/usr/bin/env bash
# Live view of the agent memory (SQLite): sprint status, latest messages, counts, idle time.
# Usage (host):  bash bin/monitor-sqlite.sh [seconds]
# Override: SQLITE_CMD="docker exec -u builder builder sqlite3"  DB=/workspace/_agents/memory/agent.db  ROWS=8  WIDTH=110
SQLITE_CMD="${SQLITE_CMD:-docker exec -u builder builder sqlite3}"
DB="${DB:-/workspace/_agents/memory/agent.db}"
ROWS="${ROWS:-8}"
WIDTH="${WIDTH:-110}"
EVERY="${1:-5}"

SQL="
SELECT name AS sprint, status, plan_iter AS iter, opened_at AS opened_utc, COALESCE(closed_at,'-') AS closed FROM conversations ORDER BY id DESC LIMIT 3;
SELECT id, substr(ts,12,8) AS utc, role, model, phase, iter, status,
       substr(replace(replace(replace(text,char(10),' '),char(13),' '),'  ',' '),1,${WIDTH}) AS text
FROM conversation_thread ORDER BY id DESC LIMIT ${ROWS};
SELECT phase, status, count(*) AS n FROM conversation_thread GROUP BY phase, status ORDER BY phase, status;
SELECT count(*) AS messages, COALESCE(max(ts),'-') AS last_utc,
       COALESCE(CAST((julianday('now')-julianday(max(ts)))*1440 AS INT),-1) AS minutes_since_last FROM messages;
"

while true; do
  out="$($SQLITE_CMD -header -column "$DB" "$SQL" 2>&1)"
  clear 2>/dev/null || printf '\033c'
  echo "== SQLITE  $(date '+%H:%M:%S WIB')   (utc = WIB - 7h)   db=$DB =="
  echo
  echo "$out"
  echo
  echo "minutes_since_last tinggi sementara GPU aktif = model masih menulis plan (30-100 menit itu normal)."
  sleep "$EVERY"
done
