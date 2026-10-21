#!/usr/bin/env bash
# Agent memory on SQLite. Only the memory agent's normalized lines are stored here.
#   mem.sh init
#   mem.sh add <agent> <scope> <kind> <status> <base64 text>
#   mem.sh recall <agent> <scope> [limit]
# DB path: $AGENT_DB or <agents dir>/memory/agent.db
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${AGENT_DB:-$BASE/memory/agent.db}"
mkdir -p "$(dirname "$DB")"

esc() { printf '%s' "$1" | sed "s/'/''/g"; }
valid() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._/-]+$' || { echo "invalid value: $1" >&2; exit 1; }; }

cmd="${1:-}"; shift || true
case "$cmd" in
  init)
    sqlite3 "$DB" "CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      agent TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL,
      status TEXT NOT NULL, text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope);
      CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory(agent, id);"
    echo "memory ready: $DB"
    ;;
  add)
    agent="$1"; scope="$2"; kind="$3"; status="$4"; text="$(printf '%s' "$5" | base64 -d | tr '\n\r' '  ' | cut -c1-600)"
    valid "$agent"; valid "$scope"; valid "$kind"; valid "$status"
    case "$text" in CONTRACT:*) kind="contract" ;; esac
    sqlite3 "$DB" "INSERT INTO memory(agent,scope,kind,status,text) VALUES('$(esc "$agent")','$(esc "$scope")','$(esc "$kind")','$(esc "$status")','$(esc "$text")');"
    echo "stored"
    ;;
  recall)
    agent="$1"; scope="$2"; limit="${3:-12}"
    valid "$agent"; valid "$scope"; printf '%s' "$limit" | grep -Eq '^[0-9]+$' || exit 1
    a="$(esc "$agent")"; s="$(esc "$scope")"
    sqlite3 -batch -separator ' | ' "$DB" "SELECT '[' || id || ' ' || ts || ' ' || agent || ' ' || scope || ' ' || kind || ' ' || status || ']', text FROM memory
      WHERE kind='contract' OR scope='global'
         OR (agent='$a' AND (scope='$s' OR scope LIKE '$s/%' OR '$s' LIKE scope || '/%'))
      ORDER BY id DESC LIMIT $limit;"
    ;;
  *) echo "usage: mem.sh init | add <agent> <scope> <kind> <status> <b64> | recall <agent> <scope> [limit]" >&2; exit 1 ;;
esac
