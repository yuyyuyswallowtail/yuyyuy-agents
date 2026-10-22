-- 001_conversations: ONE migration for agent memory + sprint conversations.
-- Idempotent on purpose: databases created by the old `mem.sh init` already have `memory`;
-- every statement is IF NOT EXISTS, so applying this on top of them changes nothing there.
--
-- Model:  conversations (one thread per sprint)  1---n  messages  n---1  memory (the Ministral line)
-- Every interaction of every role is first compressed by Ministral into one `memory` line,
-- then linked to its conversation by a `messages` row (who, which model, which phase/iteration).
BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memory (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     TEXT NOT NULL DEFAULT (datetime('now')),
  agent  TEXT NOT NULL,
  scope  TEXT NOT NULL,
  kind   TEXT NOT NULL,
  status TEXT NOT NULL,
  text   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory(agent, id);

CREATE TABLE IF NOT EXISTS conversations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  title     TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','planning','approved','executing','review','shipped','blocked','closed')),
  plan_iter INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  memory_id       INTEGER REFERENCES memory(id) ON DELETE SET NULL,
  ts              TEXT NOT NULL DEFAULT (datetime('now')),
  role            TEXT NOT NULL,
  model           TEXT NOT NULL,
  phase           TEXT NOT NULL,
  iter            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_conv   ON messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_memory ON messages(memory_id);

CREATE VIEW IF NOT EXISTS conversation_thread AS
SELECT m.id AS id, c.name AS conversation, m.ts AS ts, m.role AS role, m.model AS model,
       m.phase AS phase, m.iter AS iter, mem.status AS status, mem.kind AS kind, mem.text AS text
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
LEFT JOIN memory mem ON mem.id = m.memory_id;

INSERT OR IGNORE INTO schema_migrations(version) VALUES ('001_conversations');
COMMIT;
