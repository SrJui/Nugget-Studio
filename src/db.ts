import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { dataDir } from './config.ts';

export const db = new DatabaseSync(resolve(dataDir, 'studio.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Ein Auftrag „erzeuge N Facts zu diesen Themen“.
  CREATE TABLE IF NOT EXISTS jobs (
    id         INTEGER PRIMARY KEY,
    count      INTEGER NOT NULL,
    topics     TEXT NOT NULL,               -- JSON-Liste von Themen-IDs
    direction  TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'running', -- running | done | failed | cancelled
    created    INTEGER NOT NULL DEFAULT 0,  -- bisher erzeugte und bestandene Entwürfe
    rejected   INTEGER NOT NULL DEFAULT 0,  -- von den Prüfungen verworfene Facts
    error      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Ein erzeugter Fact. Abgelehnte werden gelöscht, freigegebene behalten ihre Supabase-ID.
  CREATE TABLE IF NOT EXISTS drafts (
    id         INTEGER PRIMARY KEY,
    job_id     INTEGER REFERENCES jobs (id),
    topic_id   TEXT NOT NULL,
    title      TEXT NOT NULL,
    summary    TEXT NOT NULL,
    body       TEXT NOT NULL,
    sources    TEXT NOT NULL,               -- JSON: [{ title, url, ok }]
    issues     TEXT NOT NULL DEFAULT '[]',  -- JSON: Hinweise der automatischen Prüfung
    review     TEXT,                        -- Begründung der Prüf-KI (leer = nicht von KI geprüft)
    status     TEXT NOT NULL DEFAULT 'open', -- open | published
    fact_id    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/** Ergänzt eine Spalte in einer schon bestehenden Datenbank. */
function addColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumn('jobs', 'rejected', 'INTEGER NOT NULL DEFAULT 0');
addColumn('drafts', 'review', 'TEXT');

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value as string | undefined;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function deleteSetting(key: string) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
