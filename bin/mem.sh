#!/usr/bin/env bash
# Agent memory + sprint conversations on SQLite. Only Ministral's normalized lines are stored here.
#   mem.sh init | migrate
#   mem.sh conv-open   <conversation> [base64 title]
#   mem.sh conv-status <conversation> <status> [plan_iter]
#   mem.sh add     <agent> <scope> <kind> <status> <base64 text> [conversation model phase iter]
#   mem.sh recall  <agent> <scope> [limit] [conversation]
#   mem.sh thread  <conversation> [limit]
# DB path: $AGENT_DB or <agents dir>/memory/agent.db. Migrations: <agents dir>/bin/migrations/*.sql (applied once, in order).
set -euo pipefail

BASE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${AGENT_DB:-$BASE/memory/agent.db}"
MIG="${AGENT_MIGRATIONS:-$BASE/bin/migrations}"
mkdir -p "$(dirname "$DB")"

esc() { printf '%s' "$1" | sed "s/'/''/g"; }
valid() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9._/-]+$' || { echo "invalid value: $1" >&2; exit 1; }; }
num() { printf '%s' "$1" | grep -Eq '^[0-9]+$' || { echo "invalid number: $1" >&2; exit 1; }; }

migrate() {
  local f v done
  for f in "$MIG"/*.sql; do
    [ -f "$f" ] || continue
    v="$(basename "$f" .sql)"
    done="$(sqlite3 "$DB" "SELECT 1 FROM schema_migrations WHERE version='$v';" 2>/dev/null || true)"
    [ -n "$done" ] && continue
    sqlite3 "$DB" < "$f"
    echo "migrated: $v"
  done
}

cmd="${1:-}"; shift || true
case "$cmd" in
  init|migrate)
    migrate
    echo "memory ready: $DB"
    ;;
  conv-open)
    conv="$1"; valid "$conv"
    title="$(printf '%s' "${2:-}" | base64 -d 2>/dev/null | tr '\n\r' '  ' | cut -c1-200 || true)"
    migrate >/dev/null
    sqlite3 "$DB" "INSERT OR IGNORE INTO conversations(name,title) VALUES('$(esc "$conv")','$(esc "$title")');
      UPDATE conversations SET status='open', closed_at=NULL WHERE name='$(esc "$conv")' AND status IN ('blocked','closed');
      SELECT id FROM conversations WHERE name='$(esc "$conv")';"
    ;;
  conv-status)
    conv="$1"; st="$2"; it="${3:-}"; valid "$conv"; valid "$st"
    [ -z "$it" ] || num "$it"
    migrate >/dev/null
    sqlite3 "$DB" "UPDATE conversations SET status='$(esc "$st")'${it:+, plan_iter=$it},
      closed_at=CASE WHEN '$(esc "$st")' IN ('shipped','blocked','closed') THEN datetime('now') ELSE closed_at END
      WHERE name='$(esc "$conv")';"
    echo "status: $conv $st"
    ;;
  add)
    agent="$1"; scope="$2"; kind="$3"; status="$4"; text="$(printf '%s' "$5" | base64 -d | tr '\n\r' '  ' | cut -c1-600)"
    conv="${6:-}"; model="${7:-}"; phase="${8:-}"; iter="${9:-0}"
    valid "$agent"; valid "$scope"; valid "$kind"; valid "$status"
    case "$text" in CONTRACT:*) kind="contract" ;; esac
    ins="INSERT INTO memory(agent,scope,kind,status,text) VALUES('$(esc "$agent")','$(esc "$scope")','$(esc "$kind")','$(esc "$status")','$(esc "$text")');"
    if [ -n "$conv" ]; then
      valid "$conv"; valid "${model:-x}"; valid "${phase:-x}"; num "$iter"
      migrate >/dev/null
      ins="$ins INSERT INTO messages(conversation_id,memory_id,role,model,phase,iter)
        SELECT id, last_insert_rowid(), '$(esc "$agent")', '$(esc "${model:-unknown}")', '$(esc "${phase:-unknown}")', $iter
        FROM conversations WHERE name='$(esc "$conv")';"
    fi
    sqlite3 "$DB" "$ins"
    echo "stored"
    ;;
  recall)
    agent="$1"; scope="$2"; limit="${3:-12}"; conv="${4:-}"
    valid "$agent"; valid "$scope"; printf '%s' "$limit" | grep -Eq '^[0-9]+$' || exit 1
    a="$(esc "$agent")"; s="$(esc "$scope")"
    if [ -z "$conv" ]; then
      sqlite3 -batch -separator ' | ' "$DB" "SELECT '[' || id || ' ' || ts || ' ' || agent || ' ' || scope || ' ' || kind || ' ' || status || ']', text FROM memory
        WHERE kind='contract' OR scope='global'
           OR (agent='$a' AND (scope='$s' OR scope LIKE '$s/%' OR '$s' LIKE scope || '/%'))
        ORDER BY id DESC LIMIT $limit;"
    else
      valid "$conv"; c="$(esc "$conv")"
      # contracts + global lessons/facts first (never crowded out), then this role/scope and the sprint thread
      sqlite3 -batch -separator ' | ' "$DB" "SELECT '[' || id || ' ' || ts || ' ' || agent || ' ' || scope || ' ' || kind || ' ' || status || ']', text FROM (
          SELECT * FROM (SELECT * FROM memory WHERE kind='contract' OR scope='global' ORDER BY id DESC LIMIT 6)
          UNION
          SELECT * FROM (SELECT * FROM memory
            WHERE (agent='$a' AND (scope='$s' OR scope LIKE '$s/%' OR '$s' LIKE scope || '/%'))
               OR id IN (SELECT memory_id FROM messages WHERE conversation_id=(SELECT id FROM conversations WHERE name='$c'))
            ORDER BY id DESC LIMIT $limit)
        ) ORDER BY id DESC LIMIT $limit;"
    fi
    ;;
  thread)
    conv="$1"; limit="${2:-30}"; valid "$conv"; num "$limit"
    migrate >/dev/null
    sqlite3 -batch -separator ' | ' "$DB" "SELECT '[' || id || ' ' || role || '/' || model || ' ' || phase || '#' || iter || ' ' || COALESCE(status,'-') || ']', COALESCE(text,'') FROM (
        SELECT * FROM conversation_thread WHERE conversation='$(esc "$conv")' ORDER BY id DESC LIMIT $limit) ORDER BY id ASC;"
    ;;
  *) echo "usage: mem.sh init|migrate | conv-open <c> [b64 title] | conv-status <c> <status> [iter] | add <agent> <scope> <kind> <status> <b64> [conv model phase iter] | recall <agent> <scope> [limit] [conv] | thread <c> [limit]" >&2; exit 1 ;;
esac
